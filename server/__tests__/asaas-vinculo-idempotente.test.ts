/**
 * Testes do helper `inserirVinculoAsaasIdempotente`.
 *
 * Bug original: a UNIQUE (escritorioId, asaasCustomerId) recém criada
 * pela migration 0104 fazia inserts concorrentes (webhook CUSTOMER_CREATED
 * + clique de "Sincronizar" na UI) falharem com ER_DUP_ENTRY. O 1º
 * comportamento (sem UNIQUE) era criar duplicata silenciosa; o 2º
 * comportamento (com UNIQUE sem proteção) era erro 500 ou TRPCError feio.
 * O helper transforma em insert idempotente: race vira "vínculo já existe,
 * bumpa sincronizadoEm e segue".
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

let insertShouldThrow: Error | null = null;
const captured: Array<{ op: "insert" | "update"; values?: unknown }> = [];

const mockDb = {
  insert: vi.fn(() => ({
    values: (v: unknown) => {
      captured.push({ op: "insert", values: v });
      if (insertShouldThrow) return Promise.reject(insertShouldThrow);
      return Promise.resolve();
    },
  })),
  update: vi.fn(() => ({
    set: (v: unknown) => ({
      where: () => {
        captured.push({ op: "update", values: v });
        return Promise.resolve();
      },
    }),
  })),
};

vi.mock("../db", () => ({ getDb: vi.fn(async () => mockDb) }));

const { inserirVinculoAsaasIdempotente } = await import("../integracoes/asaas-sync");

beforeEach(() => {
  insertShouldThrow = null;
  captured.length = 0;
  vi.clearAllMocks();
});

describe("inserirVinculoAsaasIdempotente", () => {
  it("happy path: insert sucede → retorna true", async () => {
    const r = await inserirVinculoAsaasIdempotente({
      escritorioId: 1,
      contatoId: 10,
      asaasCustomerId: "cus_001",
      cpfCnpj: "12345678900",
      nome: "Cliente X",
    });
    expect(r).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].op).toBe("insert");
  });

  it("ER_DUP_ENTRY: cai no update de sincronizadoEm → retorna false (preserva contatoId/primario)", async () => {
    insertShouldThrow = Object.assign(
      new Error("Duplicate entry 'cus_001' for key 'asaas_cli_escr_customer_uq'"),
      { code: "ER_DUP_ENTRY" },
    );
    const r = await inserirVinculoAsaasIdempotente({
      escritorioId: 1,
      contatoId: 10,
      asaasCustomerId: "cus_001",
      cpfCnpj: "12345678900",
      nome: "Cliente X",
    });
    expect(r).toBe(false);
    // Tentou insert, falhou, depois fez update apenas em sincronizadoEm.
    expect(captured.map((c) => c.op)).toEqual(["insert", "update"]);
    const updateValues = captured[1].values as { sincronizadoEm: Date };
    expect(updateValues.sincronizadoEm).toBeInstanceOf(Date);
    // Garante que NÃO mexe em contatoId nem primario (preserva existente)
    expect(updateValues).not.toHaveProperty("contatoId");
    expect(updateValues).not.toHaveProperty("primario");
  });

  it("erro genérico (não dup): propaga sem tentar update", async () => {
    insertShouldThrow = new Error("Connection lost");
    await expect(
      inserirVinculoAsaasIdempotente({
        escritorioId: 1,
        contatoId: 10,
        asaasCustomerId: "cus_001",
        cpfCnpj: "12345678900",
        nome: "Cliente X",
      }),
    ).rejects.toThrow(/Connection lost/);
    // Tentou insert mas NÃO tentou update (erro real precisa bubblar)
    expect(captured.map((c) => c.op)).toEqual(["insert"]);
  });

  it("detecta ER_DUP_ENTRY também via mensagem (drivers que não setam code)", async () => {
    insertShouldThrow = new Error("Duplicate entry 'cus_001' for key");
    // sem .code = ER_DUP_ENTRY — apenas a mensagem
    const r = await inserirVinculoAsaasIdempotente({
      escritorioId: 1,
      contatoId: 10,
      asaasCustomerId: "cus_001",
      cpfCnpj: "12345678900",
      nome: "Cliente X",
    });
    expect(r).toBe(false);
    expect(captured.map((c) => c.op)).toEqual(["insert", "update"]);
  });
});
