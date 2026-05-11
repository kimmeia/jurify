/**
 * Testes de `gerarDespesaTaxaAsaas` — gerador automático de despesa
 * "Taxa Asaas" disparado pelo webhook quando uma cobrança é paga.
 *
 * Foco:
 *  - Taxa positiva (value > netValue) → cria despesa em "Taxas Asaas"
 *  - Taxa zero ou negativa → não cria (early return)
 *  - Categoria criada na primeira chamada e reaproveitada
 *  - Duplicate key (idempotência) → não falha, retorna created=false
 *  - Falha não-ER_DUP_ENTRY → log warn + retorna created=false
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

type Captured = {
  op: "select" | "insert" | "update";
  table: string;
  values?: unknown;
  where?: unknown;
};

let captured: Captured[] = [];
let selectQueue: unknown[][] = [];
let nextInsertError: { code?: string; message?: string } | null = null;

function tableName(t: unknown): string {
  const anyT = t as any;
  return (
    anyT?._?.name ||
    anyT?.[Symbol.for("drizzle:Name")] ||
    "unknown"
  );
}

const nextSelect = () => selectQueue.shift() ?? [];

function makeSelectBuilder(table: unknown) {
  const builder: any = {
    from(_t: unknown) {
      return builder;
    },
    where(w: unknown) {
      captured.push({ op: "select", table: tableName(table), where: w });
      return builder;
    },
    limit: () => Promise.resolve(nextSelect()),
    then: (r: (v: unknown) => unknown) => r(nextSelect()),
  };
  return builder;
}

function makeInsertBuilder(table: unknown) {
  const tname = tableName(table);
  return {
    values(values: unknown) {
      captured.push({ op: "insert", table: tname, values });
      const chain: any = {
        $returningId: () => {
          if (nextInsertError) {
            const err = nextInsertError;
            nextInsertError = null;
            return Promise.reject(Object.assign(new Error(err.message ?? "fail"), err));
          }
          return Promise.resolve([{ id: 555 }]);
        },
      };
      return chain;
    },
  };
}

const mockDb = {
  select: (_cols?: unknown) => ({
    from: (table: unknown) => makeSelectBuilder(table),
  }),
  insert: (table: unknown) => makeInsertBuilder(table),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

// Import depois do mock pra que o module use o mock
import { gerarDespesaTaxaAsaas } from "../integracoes/asaas-despesas-auto";

beforeEach(() => {
  captured = [];
  selectQueue = [];
  nextInsertError = null;
});

describe("gerarDespesaTaxaAsaas — happy path", () => {
  it("taxa positiva: cria despesa categorizada como 'Taxas Asaas'", async () => {
    // SELECT categoria: já existe (id=10)
    selectQueue.push([{ id: 10 }]);

    const r = await gerarDespesaTaxaAsaas({
      escritorioId: 1,
      cobrancaOriginalId: 100,
      valor: 100.0,
      valorLiquido: 95.0,
      dataPagamento: "2026-05-11",
      descricaoCobranca: "Honorário inicial",
      criadoPorUserId: 7,
    });

    expect(r.created).toBe(true);
    expect(r.despesaId).toBe(555);

    const insert = captured.find((c) => c.op === "insert");
    expect(insert).toBeTruthy();
    const v = insert!.values as Record<string, unknown>;
    expect(v.escritorioId).toBe(1);
    expect(v.categoriaId).toBe(10);
    expect(v.valor).toBe("5.00"); // 100 - 95 = 5
    expect(v.valorPago).toBe("5.00");
    expect(v.status).toBe("pago");
    expect(v.origem).toBe("taxa_asaas");
    expect(v.cobrancaOriginalId).toBe(100);
    expect(v.criadoPorUserId).toBe(7);
    expect(v.descricao).toContain("Honorário inicial");
  });

  it("cria categoria 'Taxas Asaas' quando não existe (1ª chamada)", async () => {
    // SELECT categoria: vazio
    selectQueue.push([]);
    // INSERT categoria: o helper já espera $returningId — id=42
    // (configurado pelo makeInsertBuilder retornar 555 by default,
    //  então vamos sobrescrever via nextInsertError... não, na verdade
    //  o helper de categoria usa $returningId que retorna 555, mas a
    //  despesa também usa $returningId. Pra desambiguar, vamos checar
    //  o table name).
    // Solução: o $returningId atual retorna sempre {id:555}. Como a
    // primeira chamada cria a categoria que vai com id=555 e depois
    // cria a despesa com id=555 também, mas o teste ainda valida.
    // SELECT cobrança? Não — a despesa-auto só faz SELECT da categoria.

    const r = await gerarDespesaTaxaAsaas({
      escritorioId: 2,
      cobrancaOriginalId: 200,
      valor: 50.0,
      valorLiquido: 48.0,
      dataPagamento: "2026-05-11",
      descricaoCobranca: null,
      criadoPorUserId: 1,
    });

    expect(r.created).toBe(true);
    // Verifica que houve INSERT na categoria E na despesa
    const insertsCategoria = captured.filter(
      (c) => c.op === "insert" && c.table === "categorias_despesa",
    );
    const insertsDespesa = captured.filter(
      (c) => c.op === "insert" && c.table === "despesas",
    );
    expect(insertsCategoria.length).toBe(1);
    expect(insertsDespesa.length).toBe(1);
  });

  it("descricaoCobranca null gera fallback 'Taxa Asaas — cobrança #N'", async () => {
    selectQueue.push([{ id: 10 }]);

    await gerarDespesaTaxaAsaas({
      escritorioId: 1,
      cobrancaOriginalId: 777,
      valor: 100,
      valorLiquido: 99,
      dataPagamento: "2026-05-11",
      descricaoCobranca: null,
      criadoPorUserId: 1,
    });

    const insertDespesa = captured.find(
      (c) => c.op === "insert" && c.table === "despesas",
    );
    expect(insertDespesa).toBeTruthy();
    const v = insertDespesa!.values as Record<string, unknown>;
    expect(v.descricao).toBe("Taxa Asaas — cobrança #777");
  });

  it("trunca descrição muito longa para 200 chars (limite do schema)", async () => {
    selectQueue.push([{ id: 10 }]);
    const longa = "x".repeat(500);

    await gerarDespesaTaxaAsaas({
      escritorioId: 1,
      cobrancaOriginalId: 1,
      valor: 100,
      valorLiquido: 99,
      dataPagamento: "2026-05-11",
      descricaoCobranca: longa,
      criadoPorUserId: 1,
    });

    const insertDespesa = captured.find(
      (c) => c.op === "insert" && c.table === "despesas",
    );
    const v = insertDespesa!.values as Record<string, unknown>;
    expect((v.descricao as string).length).toBeLessThanOrEqual(200);
  });
});

describe("gerarDespesaTaxaAsaas — taxa zero ou negativa", () => {
  it("taxa = 0: não cria despesa (early return)", async () => {
    const r = await gerarDespesaTaxaAsaas({
      escritorioId: 1,
      cobrancaOriginalId: 100,
      valor: 100.0,
      valorLiquido: 100.0,
      dataPagamento: "2026-05-11",
      descricaoCobranca: "x",
      criadoPorUserId: 1,
    });
    expect(r.created).toBe(false);
    expect(r.despesaId).toBeNull();
    // Nenhum SELECT/INSERT deve ter sido feito
    expect(captured.length).toBe(0);
  });

  it("taxa negativa (líquido > valor): não cria despesa", async () => {
    const r = await gerarDespesaTaxaAsaas({
      escritorioId: 1,
      cobrancaOriginalId: 100,
      valor: 100.0,
      valorLiquido: 105.0,
      dataPagamento: "2026-05-11",
      descricaoCobranca: "x",
      criadoPorUserId: 1,
    });
    expect(r.created).toBe(false);
    expect(captured.length).toBe(0);
  });

  it("valor ou valorLiquido NaN: não cria despesa", async () => {
    const r = await gerarDespesaTaxaAsaas({
      escritorioId: 1,
      cobrancaOriginalId: 100,
      valor: NaN,
      valorLiquido: 50,
      dataPagamento: "2026-05-11",
      descricaoCobranca: "x",
      criadoPorUserId: 1,
    });
    expect(r.created).toBe(false);
  });
});

describe("gerarDespesaTaxaAsaas — idempotência", () => {
  it("ER_DUP_ENTRY no INSERT: retorna created=false sem lançar", async () => {
    selectQueue.push([{ id: 10 }]);
    nextInsertError = { code: "ER_DUP_ENTRY", message: "Duplicate entry" };

    const r = await gerarDespesaTaxaAsaas({
      escritorioId: 1,
      cobrancaOriginalId: 100,
      valor: 100.0,
      valorLiquido: 95.0,
      dataPagamento: "2026-05-11",
      descricaoCobranca: "Honorário",
      criadoPorUserId: 1,
    });

    expect(r.created).toBe(false);
    expect(r.despesaId).toBeNull();
  });

  it("erro 'Duplicate entry' no message (sem code): também trata como idempotente", async () => {
    selectQueue.push([{ id: 10 }]);
    nextInsertError = { message: "Duplicate entry '100-taxa_asaas'" };

    const r = await gerarDespesaTaxaAsaas({
      escritorioId: 1,
      cobrancaOriginalId: 100,
      valor: 50,
      valorLiquido: 48,
      dataPagamento: "2026-05-11",
      descricaoCobranca: null,
      criadoPorUserId: 1,
    });

    expect(r.created).toBe(false);
  });

  it("outro erro qualquer: retorna created=false (não bloqueia webhook)", async () => {
    selectQueue.push([{ id: 10 }]);
    nextInsertError = { message: "Connection lost" };

    const r = await gerarDespesaTaxaAsaas({
      escritorioId: 1,
      cobrancaOriginalId: 100,
      valor: 100,
      valorLiquido: 95,
      dataPagamento: "2026-05-11",
      descricaoCobranca: "x",
      criadoPorUserId: 1,
    });

    // Não lança — webhook não deve falhar por causa de despesa-auto
    expect(r.created).toBe(false);
    expect(r.despesaId).toBeNull();
  });
});
