/**
 * Teste de regressão de `salvarRegraComissao` — garante que TODAS as 3
 * escritas (upsert do cabeçalho + delete das faixas antigas + insert das
 * novas) ficam dentro de UMA transação MySQL.
 *
 * Sem isso, se o INSERT das novas faixas falhar depois do DELETE, o
 * escritório fica com `modo='faixas'` mas zero faixas e toda comissão
 * futura vira R$ 0,00 silenciosamente (fallback flat com alíquota 0%).
 *
 * O teste NÃO valida o BEGIN/COMMIT/ROLLBACK do driver (responsabilidade
 * do drizzle/mysql2); valida só o contrato de que NENHUMA escrita
 * acontece fora do `db.transaction()`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

let txOps: string[] = [];
let directOps: string[] = [];
let insertShouldThrow = false;

function buildTx() {
  return {
    execute: vi.fn(async () => {
      txOps.push("tx.execute");
    }),
    delete: vi.fn(() => ({
      where: () => {
        txOps.push("tx.delete");
        return Promise.resolve();
      },
    })),
    insert: vi.fn(() => ({
      values: () => {
        txOps.push("tx.insert");
        if (insertShouldThrow) {
          return Promise.reject(new Error("simulated insert failure"));
        }
        return Promise.resolve();
      },
    })),
  };
}

const mockDb = {
  transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => {
    const tx = buildTx();
    return cb(tx);
  }),
  // Se a função (erroneamente) bypassar a transaction, registra aqui.
  // O teste falha quando isso ocorre, expondo o bug original.
  execute: vi.fn(async () => {
    directOps.push("db.execute");
  }),
  delete: vi.fn(() => ({
    where: () => {
      directOps.push("db.delete");
      return Promise.resolve();
    },
  })),
  insert: vi.fn(() => ({
    values: () => {
      directOps.push("db.insert");
      return Promise.resolve();
    },
  })),
};

vi.mock("../db", () => ({ getDb: vi.fn(async () => mockDb) }));

const { salvarRegraComissao } = await import("../escritorio/db-financeiro");

beforeEach(() => {
  txOps = [];
  directOps = [];
  insertShouldThrow = false;
  vi.clearAllMocks();
});

describe("salvarRegraComissao — atomicidade via transaction", () => {
  it("modo flat sem faixas: upsert + delete (sem insert) — TUDO dentro da transaction", async () => {
    await salvarRegraComissao(100, {
      modo: "flat",
      aliquotaPercent: 10,
      valorMinimoCobranca: 0,
      baseFaixa: "comissionavel",
      faixas: [],
    });

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(txOps).toEqual(["tx.execute", "tx.delete"]);
    expect(directOps).toEqual([]);
  });

  it("modo faixas com 3 faixas: upsert + delete + insert — TUDO dentro da transaction", async () => {
    await salvarRegraComissao(100, {
      modo: "faixas",
      aliquotaPercent: 0,
      valorMinimoCobranca: 0,
      baseFaixa: "comissionavel",
      faixas: [
        { limiteAte: 5000, aliquotaPercent: 5 },
        { limiteAte: 20000, aliquotaPercent: 10 },
        { limiteAte: null, aliquotaPercent: 15 },
      ],
    });

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(txOps).toEqual(["tx.execute", "tx.delete", "tx.insert"]);
    expect(directOps).toEqual([]);
  });

  it("se o insert das faixas falha, o erro propaga (driver faz ROLLBACK do DELETE anterior)", async () => {
    insertShouldThrow = true;

    await expect(
      salvarRegraComissao(100, {
        modo: "faixas",
        aliquotaPercent: 0,
        valorMinimoCobranca: 0,
        baseFaixa: "comissionavel",
        faixas: [{ limiteAte: null, aliquotaPercent: 10 }],
      }),
    ).rejects.toThrow(/simulated insert failure/);

    // Confirma que delete + insert ambos foram tentados dentro da mesma transaction
    // — o driver vai abortar e fazer ROLLBACK (não testado aqui; é responsabilidade
    // do drizzle/mysql2).
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(txOps).toEqual(["tx.execute", "tx.delete", "tx.insert"]);
    expect(directOps).toEqual([]);
  });
});
