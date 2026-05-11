/**
 * Testes — `sincronizarExtratoAsaas` (importação do extrato Asaas como despesas).
 *
 * Cobre:
 *  - Mapeamento type → categoria (PAYMENT_FEE, TRANSFER, NOTIFICATION_FEE, etc)
 *  - Tipo desconhecido cai em "Outras movimentações Asaas" (sem deploy)
 *  - Crédito (value > 0) é ignorado, não vira despesa
 *  - Tipos explicitamente créditos (PAYMENT_RECEIVED) são ignorados mesmo
 *    com value negativo errante
 *  - Idempotência: ER_DUP_ENTRY conta como duplicada, não erro
 *  - Erro de rede aborta com `parcial=true`
 *  - tiposVistos retorna contagem por type pra observabilidade
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type Captured = {
  op: "select" | "insert";
  table: string;
  values?: any;
};

let captured: Captured[] = [];
let selectQueue: unknown[][] = [];
let nextInsertId = 1;
let throwOnInsert: { table?: string; error?: Error } | null = null;

function tableName(t: unknown): string {
  const anyT = t as any;
  return (
    anyT?._?.name ||
    anyT?.[Symbol.for("drizzle:Name")] ||
    "unknown"
  );
}

function nextSelectResult(): unknown[] {
  return selectQueue.shift() ?? [];
}

function makeSelectBuilder(table: unknown) {
  const b: any = {
    from(_t: unknown) { return b; },
    where(_w: unknown) {
      captured.push({ op: "select", table: tableName(table) });
      return b;
    },
    limit: (_n: number) => Promise.resolve(nextSelectResult()),
    then: (r: (v: unknown) => unknown) => r(nextSelectResult()),
  };
  return b;
}

const mockDb = {
  select: (_cols?: unknown) => ({
    from(table: unknown) { return makeSelectBuilder(table); },
  }),
  insert: (table: unknown) => ({
    values(values: unknown) {
      const tn = tableName(table);
      captured.push({ op: "insert", table: tn, values });
      if (throwOnInsert?.table === tn && throwOnInsert.error) {
        const err = throwOnInsert.error;
        throwOnInsert = null;
        return {
          $returningId: () => Promise.reject(err),
          then: (_r: any, rej: any) => rej(err),
        };
      }
      const id = nextInsertId++;
      return {
        $returningId: () => Promise.resolve([{ id }]),
        then: (r: any) => r([{ insertId: id, affectedRows: 1 }]),
      };
    },
  }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

const { sincronizarExtratoAsaas } = await import("../integracoes/asaas-extrato");

function fakeClient(pages: any[]): any {
  let i = 0;
  return {
    listarMovimentacoes: vi.fn(async () => pages[i++] ?? { data: [], hasMore: false, limit: 100, offset: 0 }),
  };
}

function mov(overrides: any): any {
  return {
    object: "financialTransaction",
    id: "fin_" + Math.random().toString(36).slice(2, 10),
    value: -10,
    balance: 100,
    type: "PAYMENT_FEE",
    date: "2026-05-11",
    description: null,
    ...overrides,
  };
}

beforeEach(() => {
  captured = [];
  selectQueue = [];
  nextInsertId = 1;
  throwOnInsert = null;
});

describe("sincronizarExtratoAsaas — mapeamento de categoria", () => {
  it("PAYMENT_FEE → categoria 'Taxas Asaas'", async () => {
    selectQueue.push([]); // categoria não existe — vai inserir
    const client = fakeClient([{
      data: [mov({ id: "fin_1", type: "PAYMENT_FEE", value: -1.99 })],
      hasMore: false, limit: 100, offset: 0,
    }]);

    const r = await sincronizarExtratoAsaas(10, client, { criadoPorUserId: 5 });

    expect(r.novasDespesas).toBe(1);
    expect(r.tiposVistos["PAYMENT_FEE"]).toBe(1);
    const categoriaInsert = captured.find((c) => c.op === "insert" && c.table === "categorias_despesa");
    expect((categoriaInsert?.values as any).nome).toBe("Taxas Asaas");
  });

  it("NOTIFICATION_FEE → categoria 'Notificações Asaas'", async () => {
    selectQueue.push([]); // categoria
    const client = fakeClient([{
      data: [mov({ type: "NOTIFICATION_FEE", value: -0.10 })],
      hasMore: false, limit: 100, offset: 0,
    }]);
    const r = await sincronizarExtratoAsaas(10, client, { criadoPorUserId: 5 });
    expect(r.novasDespesas).toBe(1);
    const cat = captured.find((c) => c.op === "insert" && c.table === "categorias_despesa");
    expect((cat?.values as any).nome).toBe("Notificações Asaas");
  });

  it("WHATSAPP_NOTIFICATION_FEE → 'Notificações Asaas' (mesma categoria)", async () => {
    selectQueue.push([]);
    const client = fakeClient([{
      data: [mov({ type: "WHATSAPP_NOTIFICATION_FEE", value: -0.50 })],
      hasMore: false, limit: 100, offset: 0,
    }]);
    const r = await sincronizarExtratoAsaas(10, client, { criadoPorUserId: 5 });
    expect(r.novasDespesas).toBe(1);
    const cat = captured.find((c) => c.op === "insert" && c.table === "categorias_despesa");
    expect((cat?.values as any).nome).toBe("Notificações Asaas");
  });

  it("TRANSFER → 'Transferências PIX/TED'", async () => {
    selectQueue.push([]);
    const client = fakeClient([{
      data: [mov({ type: "TRANSFER", value: -500 })],
      hasMore: false, limit: 100, offset: 0,
    }]);
    const r = await sincronizarExtratoAsaas(10, client, { criadoPorUserId: 5 });
    const cat = captured.find((c) => c.op === "insert" && c.table === "categorias_despesa");
    expect((cat?.values as any).nome).toBe("Transferências PIX/TED");
    expect(r.novasDespesas).toBe(1);
  });

  it("TYPE_DESCONHECIDO_FUTURO → fallback 'Outras movimentações Asaas'", async () => {
    selectQueue.push([]);
    const client = fakeClient([{
      data: [mov({ type: "ALGO_NOVO_QUE_ASAAS_INVENTOU", value: -42 })],
      hasMore: false, limit: 100, offset: 0,
    }]);
    const r = await sincronizarExtratoAsaas(10, client, { criadoPorUserId: 5 });
    expect(r.novasDespesas).toBe(1);
    const cat = captured.find((c) => c.op === "insert" && c.table === "categorias_despesa");
    expect((cat?.values as any).nome).toBe("Outras movimentações Asaas");
    expect(r.tiposVistos["ALGO_NOVO_QUE_ASAAS_INVENTOU"]).toBe(1);
  });
});

describe("sincronizarExtratoAsaas — créditos e zeros são ignorados", () => {
  it("value > 0 (crédito) → não vira despesa", async () => {
    const client = fakeClient([{
      data: [mov({ type: "PAYMENT_RECEIVED", value: 100, id: "fin_credito" })],
      hasMore: false, limit: 100, offset: 0,
    }]);
    const r = await sincronizarExtratoAsaas(10, client, { criadoPorUserId: 5 });
    expect(r.novasDespesas).toBe(0);
    expect(r.ignoradas).toBe(1);
    expect(captured.find((c) => c.op === "insert" && c.table === "despesas")).toBeUndefined();
  });

  it("value = 0 → ignora", async () => {
    const client = fakeClient([{
      data: [mov({ type: "PAYMENT_FEE", value: 0 })],
      hasMore: false, limit: 100, offset: 0,
    }]);
    const r = await sincronizarExtratoAsaas(10, client, { criadoPorUserId: 5 });
    expect(r.novasDespesas).toBe(0);
    expect(r.ignoradas).toBe(1);
  });

  it("type=PAYMENT_RECEIVED com value negativo errante → ignora (defesa extra)", async () => {
    const client = fakeClient([{
      data: [mov({ type: "PAYMENT_RECEIVED", value: -50 })],
      hasMore: false, limit: 100, offset: 0,
    }]);
    const r = await sincronizarExtratoAsaas(10, client, { criadoPorUserId: 5 });
    expect(r.novasDespesas).toBe(0);
    expect(r.ignoradas).toBe(1);
  });
});

describe("sincronizarExtratoAsaas — idempotência", () => {
  it("ER_DUP_ENTRY no insert de despesa → conta como duplicada, não erro", async () => {
    selectQueue.push([{ id: 7 }]); // categoria já existe
    throwOnInsert = {
      table: "despesas",
      error: Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }),
    };
    const client = fakeClient([{
      data: [mov({ type: "PAYMENT_FEE" })],
      hasMore: false, limit: 100, offset: 0,
    }]);

    const r = await sincronizarExtratoAsaas(10, client, { criadoPorUserId: 5 });
    expect(r.novasDespesas).toBe(0);
    expect(r.duplicadas).toBe(1);
    expect(r.erros).toBe(0);
  });
});

describe("sincronizarExtratoAsaas — paginação + abort", () => {
  it("Itera por todas as páginas hasMore", async () => {
    selectQueue.push([{ id: 1 }]); // categoria
    const client = fakeClient([
      { data: [mov({ id: "fin_a", type: "PAYMENT_FEE" })], hasMore: true, limit: 100, offset: 0 },
      { data: [mov({ id: "fin_b", type: "PAYMENT_FEE" })], hasMore: false, limit: 100, offset: 100 },
    ]);
    const r = await sincronizarExtratoAsaas(10, client, { criadoPorUserId: 5 });
    expect(r.totalProcessadas).toBe(2);
    expect(r.novasDespesas).toBe(2);
    expect(client.listarMovimentacoes).toHaveBeenCalledTimes(2);
  });

  it("Erro de rede → marca parcial=true e retorna o que conseguiu", async () => {
    selectQueue.push([{ id: 1 }]);
    const client = {
      listarMovimentacoes: vi.fn()
        .mockResolvedValueOnce({
          data: [mov({ type: "PAYMENT_FEE" })],
          hasMore: true, limit: 100, offset: 0,
        })
        .mockRejectedValueOnce(Object.assign(new Error("HTTP 429"), { response: { status: 429 } })),
    };
    const r = await sincronizarExtratoAsaas(10, client as any, { criadoPorUserId: 5 });
    expect(r.parcial).toBe(true);
    expect(r.novasDespesas).toBe(1);
  });
});

describe("sincronizarExtratoAsaas — campos da despesa", () => {
  it("valor sempre POSITIVO (Math.abs do value negativo), origem='extrato_asaas'", async () => {
    selectQueue.push([{ id: 1 }]);
    const client = fakeClient([{
      data: [mov({ id: "fin_x", type: "PAYMENT_FEE", value: -7.50 })],
      hasMore: false, limit: 100, offset: 0,
    }]);

    await sincronizarExtratoAsaas(10, client, { criadoPorUserId: 5 });
    const desp = captured.find((c) => c.op === "insert" && c.table === "despesas");
    const v = desp?.values as any;
    expect(v.valor).toBe("7.50");
    expect(v.valorPago).toBe("7.50");
    expect(v.origem).toBe("extrato_asaas");
    expect(v.asaasFinTransId).toBe("fin_x");
    expect(v.asaasFinTransType).toBe("PAYMENT_FEE");
    expect(v.status).toBe("pago");
  });

  it("descrição vazia → usa o type como descrição", async () => {
    selectQueue.push([{ id: 1 }]);
    const client = fakeClient([{
      data: [mov({ type: "NOTIFICATION_FEE", description: null })],
      hasMore: false, limit: 100, offset: 0,
    }]);
    await sincronizarExtratoAsaas(10, client, { criadoPorUserId: 5 });
    const desp = captured.find((c) => c.op === "insert" && c.table === "despesas");
    expect((desp?.values as any).descricao).toBe("NOTIFICATION_FEE");
  });
});
