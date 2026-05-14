/**
 * Testes de regressão do helper `aplicarConciliacaoOFXMatch`.
 *
 * O bug original (router-financeiro.ts) gravava o FITID ANTES de validar
 * a entidade-pai. Quatro consequências:
 *   1. Entidade não encontrada → FITID ficava "preso" + reimport pulava
 *   2. Cobrança Asaas (origem != "manual") → idem
 *   3. UPDATE falhava após INSERT do FITID → estado inconsistente
 *   4. Reimport de match-com-erro caía em "jaImportadas" pra sempre
 *
 * Esses testes travam o contrato novo:
 *   - FITID SÓ é gravado quando a entidade existe e é elegível
 *   - INSERT FITID + UPDATE rodam em UMA transação (rollback se falha)
 *   - Status retornado descreve o que aconteceu (sem mutar `erros`/`contadores` diretamente)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

let selectQueue: unknown[][] = [];
let txOps: string[] = [];
let directOps: string[] = [];
let insertShouldThrow: Error | null = null;

function makeSelectBuilder() {
  const builder: any = {
    from: () => builder,
    where: () => builder,
    limit: () => Promise.resolve(selectQueue.shift() ?? []),
  };
  return builder;
}

function buildTx() {
  return {
    insert: vi.fn(() => ({
      values: () => {
        txOps.push("tx.insert");
        if (insertShouldThrow) return Promise.reject(insertShouldThrow);
        return Promise.resolve();
      },
    })),
    update: vi.fn(() => ({
      set: () => ({
        where: () => {
          txOps.push("tx.update");
          return Promise.resolve();
        },
      }),
    })),
  };
}

const mockDb = {
  select: () => makeSelectBuilder(),
  transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => {
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

const { aplicarConciliacaoOFXMatch } = await import(
  "../escritorio/db-financeiro"
);

beforeEach(() => {
  selectQueue = [];
  txOps = [];
  directOps = [];
  insertShouldThrow = null;
  vi.clearAllMocks();
});

describe("aplicarConciliacaoOFXMatch", () => {
  it("happy path despesa: SELECT acha + INSERT fitid + UPDATE em transaction", async () => {
    selectQueue.push([{ valor: "300.00" }]);

    const r = await aplicarConciliacaoOFXMatch({
      escritorioId: 1,
      importadoPorUserId: 10,
      fitid: "ABC123",
      tipo: "despesa",
      entidadeId: 100,
      valor: 300,
      dataPagamento: "2026-05-13",
    });

    expect(r).toEqual({ status: "aplicado_despesa" });
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(txOps).toEqual(["tx.insert", "tx.update"]);
    expect(directOps).toEqual([]);
  });

  it("happy path cobrança manual: SELECT acha origem=manual + INSERT fitid + UPDATE", async () => {
    selectQueue.push([{ origem: "manual" }]);

    const r = await aplicarConciliacaoOFXMatch({
      escritorioId: 1,
      importadoPorUserId: 10,
      fitid: "DEF456",
      tipo: "cobranca",
      entidadeId: 200,
      valor: 500,
      dataPagamento: "2026-05-13",
    });

    expect(r).toEqual({ status: "aplicado_cobranca" });
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(txOps).toEqual(["tx.insert", "tx.update"]);
    expect(directOps).toEqual([]);
  });

  it("despesa não encontrada: NÃO grava FITID, retorna status apropriado", async () => {
    selectQueue.push([]); // SELECT volta vazio

    const r = await aplicarConciliacaoOFXMatch({
      escritorioId: 1,
      importadoPorUserId: 10,
      fitid: "GHI789",
      tipo: "despesa",
      entidadeId: 999,
      valor: 100,
      dataPagamento: "2026-05-13",
    });

    expect(r).toEqual({ status: "entidade_nao_encontrada", tipo: "despesa" });
    // Crucial: nenhuma transação foi iniciada, nenhum FITID gravado
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(txOps).toEqual([]);
    expect(directOps).toEqual([]);
  });

  it("cobrança não encontrada: NÃO grava FITID", async () => {
    selectQueue.push([]);

    const r = await aplicarConciliacaoOFXMatch({
      escritorioId: 1,
      importadoPorUserId: 10,
      fitid: "JKL012",
      tipo: "cobranca",
      entidadeId: 999,
      valor: 100,
      dataPagamento: "2026-05-13",
    });

    expect(r).toEqual({ status: "entidade_nao_encontrada", tipo: "cobranca" });
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(txOps).toEqual([]);
  });

  it("cobrança Asaas (origem='asaas'): NÃO grava FITID — bug original deixava preso", async () => {
    selectQueue.push([{ origem: "asaas" }]);

    const r = await aplicarConciliacaoOFXMatch({
      escritorioId: 1,
      importadoPorUserId: 10,
      fitid: "MNO345",
      tipo: "cobranca",
      entidadeId: 300,
      valor: 250,
      dataPagamento: "2026-05-13",
    });

    expect(r).toEqual({ status: "cobranca_asaas_pulada" });
    // Crucial pro bug #3: o FITID NÃO pode ser gravado, senão reimport
    // do mesmo OFX pula como "jaImportadas" pra sempre.
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(txOps).toEqual([]);
  });

  it("FITID duplicado (ER_DUP_ENTRY): retorna ja_importada, transação faz rollback do UPDATE", async () => {
    selectQueue.push([{ valor: "300.00" }]);
    insertShouldThrow = Object.assign(new Error("Duplicate entry 'ABC123' for key 'fitid'"), {
      code: "ER_DUP_ENTRY",
    });

    const r = await aplicarConciliacaoOFXMatch({
      escritorioId: 1,
      importadoPorUserId: 10,
      fitid: "ABC123",
      tipo: "despesa",
      entidadeId: 100,
      valor: 300,
      dataPagamento: "2026-05-13",
    });

    expect(r).toEqual({ status: "ja_importada" });
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    // Insert tentou, UPDATE não chegou a ser executado (transaction abortou)
    expect(txOps).toEqual(["tx.insert"]);
  });

  it("erro inesperado no insert (não-ER_DUP_ENTRY): propaga e NÃO retorna ja_importada", async () => {
    selectQueue.push([{ valor: "300.00" }]);
    insertShouldThrow = new Error("connection lost mid-transaction");

    await expect(
      aplicarConciliacaoOFXMatch({
        escritorioId: 1,
        importadoPorUserId: 10,
        fitid: "ABC123",
        tipo: "despesa",
        entidadeId: 100,
        valor: 300,
        dataPagamento: "2026-05-13",
      }),
    ).rejects.toThrow(/connection lost/);

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  it("operação sempre via tx (nunca via db.insert/update direto)", async () => {
    selectQueue.push([{ valor: "100.00" }]);

    await aplicarConciliacaoOFXMatch({
      escritorioId: 1,
      importadoPorUserId: 10,
      fitid: "XPTO",
      tipo: "despesa",
      entidadeId: 1,
      valor: 100,
      dataPagamento: "2026-05-13",
    });

    // Travamento contra regressão: se alguém quebrar a transação e usar
    // db.insert/db.update diretos, esse expect quebra imediatamente.
    expect(directOps).toEqual([]);
  });
});
