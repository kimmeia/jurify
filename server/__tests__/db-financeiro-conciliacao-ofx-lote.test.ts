/**
 * Testes de regressão — bug #10: `aplicarConciliacaoOFXEmLote`.
 *
 * Bug original (router-financeiro `confirmarConciliacaoOFX`): cada match
 * era processado em transação INDEPENDENTE. Se um falhasse no meio do
 * batch, os anteriores ficavam commitados, gerando estado "meio feito"
 * que confundia o usuário e produzia "ja_importadas" misturadas com
 * sucessos parciais em re-runs.
 *
 * Contrato novo (tudo-ou-nada):
 *  1. Pré-validação em batch (3 SELECTs no máximo) classifica todos
 *     antes de gravar nada.
 *  2. Erros estruturais (entidade ausente, cobrança asaas) abortam o
 *     lote inteiro — `abortado: true`, NADA gravado.
 *  3. `ja_importada` (fitid duplicado) é skip, não erro.
 *  4. Quando tudo está OK, abre UMA transação englobando todos os
 *     inserts/updates. Rollback automático se o banco falha no meio.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Filas de resultado por query (na ordem em que são chamadas).
let selectQueue: unknown[][] = [];
let txOps: string[] = [];
let directOps: string[] = [];
let transactionShouldThrow: Error | null = null;

function makeSelectBuilder() {
  const builder: any = {
    from: () => builder,
    where: () => Promise.resolve(selectQueue.shift() ?? []),
    limit: () => Promise.resolve(selectQueue.shift() ?? []),
  };
  return builder;
}

function buildTx() {
  return {
    insert: vi.fn(() => ({
      values: (vals: any) => {
        txOps.push(`tx.insert:${vals.tipoEntidade}:${vals.entidadeId}`);
        return Promise.resolve();
      },
    })),
    update: vi.fn((tbl: any) => ({
      set: () => ({
        where: () => {
          txOps.push(`tx.update:${tbl?.[Symbol.for("drizzle:Name")] ?? "?"}`);
          return Promise.resolve();
        },
      }),
    })),
  };
}

const mockDb = {
  select: () => makeSelectBuilder(),
  transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => {
    if (transactionShouldThrow) throw transactionShouldThrow;
    const tx = buildTx();
    return cb(tx);
  }),
  insert: vi.fn(() => ({
    values: () => {
      directOps.push("db.insert");
      return Promise.resolve();
    },
  })),
  update: vi.fn(() => ({
    set: () => ({
      where: () => {
        directOps.push("db.update");
        return Promise.resolve();
      },
    }),
  })),
};

vi.mock("../db", () => ({ getDb: vi.fn(async () => mockDb) }));

const { aplicarConciliacaoOFXEmLote } = await import(
  "../escritorio/db-financeiro"
);

beforeEach(() => {
  selectQueue = [];
  txOps = [];
  directOps = [];
  transactionShouldThrow = null;
  vi.clearAllMocks();
});

describe("aplicarConciliacaoOFXEmLote — happy path", () => {
  it("lote de 2 despesas + 1 cobrança manual: todos gravados em UMA transação", async () => {
    // Ordem dos SELECTs: fitids importados, despesas, cobranças (inArray)
    selectQueue.push([]); // nenhum fitid já importado
    selectQueue.push([
      { id: 100, valor: "300.00" },
      { id: 101, valor: "400.00" },
    ]); // despesas existentes
    selectQueue.push([{ id: 200, origem: "manual" }]); // cobrança manual

    const r = await aplicarConciliacaoOFXEmLote({
      escritorioId: 1,
      importadoPorUserId: 10,
      matches: [
        { fitid: "F1", tipo: "despesa", entidadeId: 100, valor: 300, dataPagamento: "2026-05-13" },
        { fitid: "F2", tipo: "despesa", entidadeId: 101, valor: 400, dataPagamento: "2026-05-13" },
        { fitid: "F3", tipo: "cobranca", entidadeId: 200, valor: 500, dataPagamento: "2026-05-13" },
      ],
    });

    expect(r.abortado).toBe(false);
    expect(r.despesasMarcadas).toBe(2);
    expect(r.cobrancasMarcadas).toBe(1);
    expect(r.jaImportadas).toBe(0);
    expect(r.erros).toEqual([]);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    // Cada match gera 1 insert (fitid) + 1 update (entidade) — 6 ops no total
    expect(txOps.filter((o) => o.startsWith("tx.insert")).length).toBe(3);
    expect(txOps.filter((o) => o.startsWith("tx.update")).length).toBe(3);
  });

  it("fitid já importado é SKIP: incrementa jaImportadas, NÃO bloqueia o resto", async () => {
    selectQueue.push([{ fitid: "F1" }]); // F1 já importado
    selectQueue.push([{ id: 101, valor: "400.00" }]); // só F2 vai consultar despesa válida
    // Sem cobranças

    const r = await aplicarConciliacaoOFXEmLote({
      escritorioId: 1,
      importadoPorUserId: 10,
      matches: [
        { fitid: "F1", tipo: "despesa", entidadeId: 100, valor: 300, dataPagamento: "2026-05-13" },
        { fitid: "F2", tipo: "despesa", entidadeId: 101, valor: 400, dataPagamento: "2026-05-13" },
      ],
    });

    expect(r.abortado).toBe(false);
    expect(r.despesasMarcadas).toBe(1);
    expect(r.jaImportadas).toBe(1);
    expect(r.erros).toEqual([]);
    // Transação aberta uma vez pra gravar só o F2
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  it("lote vazio: noop sem abrir transação", async () => {
    const r = await aplicarConciliacaoOFXEmLote({
      escritorioId: 1,
      importadoPorUserId: 10,
      matches: [],
    });

    expect(r).toEqual({
      despesasMarcadas: 0,
      cobrancasMarcadas: 0,
      jaImportadas: 0,
      erros: [],
      abortado: false,
      itens: [],
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("tudo já importado: contadores zerados em marcadas, transação NÃO é aberta", async () => {
    selectQueue.push([{ fitid: "F1" }, { fitid: "F2" }]);
    // despesas/cobranças não são consultadas pq tudo cai como ja_importada

    const r = await aplicarConciliacaoOFXEmLote({
      escritorioId: 1,
      importadoPorUserId: 10,
      matches: [
        { fitid: "F1", tipo: "despesa", entidadeId: 100, valor: 300, dataPagamento: "2026-05-13" },
        { fitid: "F2", tipo: "despesa", entidadeId: 101, valor: 400, dataPagamento: "2026-05-13" },
      ],
    });

    expect(r.abortado).toBe(false);
    expect(r.jaImportadas).toBe(2);
    expect(r.despesasMarcadas).toBe(0);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});

describe("aplicarConciliacaoOFXEmLote — abort por erro estrutural", () => {
  it("despesa não encontrada ABORTA todo o lote: NADA gravado", async () => {
    selectQueue.push([]); // nenhum fitid já importado
    selectQueue.push([{ id: 100, valor: "300.00" }]); // só 100 existe; 999 some
    // Sem cobranças no batch

    const r = await aplicarConciliacaoOFXEmLote({
      escritorioId: 1,
      importadoPorUserId: 10,
      matches: [
        { fitid: "F1", tipo: "despesa", entidadeId: 100, valor: 300, dataPagamento: "2026-05-13" },
        { fitid: "F2", tipo: "despesa", entidadeId: 999, valor: 400, dataPagamento: "2026-05-13" },
      ],
    });

    expect(r.abortado).toBe(true);
    expect(r.despesasMarcadas).toBe(0);
    expect(r.cobrancasMarcadas).toBe(0);
    expect(r.jaImportadas).toBe(0);
    expect(r.erros).toEqual(["Despesa #999 não encontrada"]);
    // CRUCIAL: transaction NUNCA foi aberta
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(txOps).toEqual([]);
  });

  it("cobrança asaas ABORTA o lote inteiro — preserva integridade do batch", async () => {
    selectQueue.push([]); // nada importado
    // Sem despesas no batch — função não consulta tabela `despesas`
    selectQueue.push([{ id: 200, origem: "asaas" }]); // cobrança é asaas → pulada

    const r = await aplicarConciliacaoOFXEmLote({
      escritorioId: 1,
      importadoPorUserId: 10,
      matches: [
        { fitid: "F1", tipo: "cobranca", entidadeId: 200, valor: 500, dataPagamento: "2026-05-13" },
      ],
    });

    expect(r.abortado).toBe(true);
    expect(r.erros[0]).toMatch(/Cobrança #200 é Asaas/);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("erro estrutural em UM match aborta TUDO — não grava nem os matches válidos", async () => {
    selectQueue.push([]); // sem fitids importados
    selectQueue.push([{ id: 100, valor: "300.00" }]); // só uma despesa existe
    selectQueue.push([]); // cobrança 999 some

    const r = await aplicarConciliacaoOFXEmLote({
      escritorioId: 1,
      importadoPorUserId: 10,
      matches: [
        { fitid: "F1", tipo: "despesa", entidadeId: 100, valor: 300, dataPagamento: "2026-05-13" },
        { fitid: "F2", tipo: "cobranca", entidadeId: 999, valor: 200, dataPagamento: "2026-05-13" },
      ],
    });

    expect(r.abortado).toBe(true);
    expect(r.despesasMarcadas).toBe(0); // mesmo válido, não foi gravado
    expect(r.erros).toEqual(["Cobrança #999 não encontrada"]);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(txOps).toEqual([]);
  });

  it("múltiplos erros são todos retornados (não para no primeiro)", async () => {
    selectQueue.push([]);
    selectQueue.push([]); // nenhuma das 2 despesas existe
    // sem cobranças

    const r = await aplicarConciliacaoOFXEmLote({
      escritorioId: 1,
      importadoPorUserId: 10,
      matches: [
        { fitid: "F1", tipo: "despesa", entidadeId: 100, valor: 300, dataPagamento: "2026-05-13" },
        { fitid: "F2", tipo: "despesa", entidadeId: 101, valor: 400, dataPagamento: "2026-05-13" },
      ],
    });

    expect(r.abortado).toBe(true);
    expect(r.erros).toHaveLength(2);
    expect(r.erros).toContain("Despesa #100 não encontrada");
    expect(r.erros).toContain("Despesa #101 não encontrada");
  });
});

describe("aplicarConciliacaoOFXEmLote — rollback em falha de transação", () => {
  it("crash no meio da transação propaga erro: nenhum item fica 'pendente'", async () => {
    selectQueue.push([]); // nenhum importado
    selectQueue.push([
      { id: 100, valor: "300.00" },
      { id: 101, valor: "400.00" },
    ]);

    // Simula DB falhando ao abrir transação
    transactionShouldThrow = new Error("connection lost mid-batch");

    await expect(
      aplicarConciliacaoOFXEmLote({
        escritorioId: 1,
        importadoPorUserId: 10,
        matches: [
          { fitid: "F1", tipo: "despesa", entidadeId: 100, valor: 300, dataPagamento: "2026-05-13" },
          { fitid: "F2", tipo: "despesa", entidadeId: 101, valor: 400, dataPagamento: "2026-05-13" },
        ],
      }),
    ).rejects.toThrow(/connection lost/);

    // Drizzle promete rollback automático em throw dentro da callback —
    // o caller (procedure tRPC) recebe o erro e mostra ao usuário sem
    // estado "meio feito" gravado.
  });
});
