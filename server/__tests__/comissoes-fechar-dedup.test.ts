/**
 * Testes do dedup cross-origem em `fecharComissao`.
 *
 * Por default, `fecharComissao` rejeita criar fechamento duplicado pro
 * mesmo `(escritorioId, atendenteId, periodoInicio, periodoFim)` —
 * lança `FechamentoJaExisteError` com o id existente. Caller decide:
 *  - Cron pula silencioso (catch + marcarConcluida)
 *  - UI manual mostra dialog "criar mesmo assim?" e re-tenta com
 *    `forcarDuplicado:true`
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

let selectQueue: unknown[][] = [];

function makeSelectBuilder() {
  const next = () => Promise.resolve(selectQueue.shift() ?? []);
  const builder: any = {
    from: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => next(),
    then: (resolve: (v: unknown) => unknown) =>
      resolve(selectQueue.shift() ?? []),
  };
  return builder;
}

const mockDb = {
  select: () => ({ from: () => makeSelectBuilder() }),
  insert: () => ({
    values: () => ({
      $returningId: () => Promise.resolve([{ id: 42 }]),
      then: (r: (v: unknown) => unknown) =>
        r([{ insertId: 42, affectedRows: 1 }]),
    }),
  }),
  update: () => ({
    set: () => ({ where: () => Promise.resolve() }),
  }),
};

vi.mock("../db", () => ({ getDb: vi.fn(async () => mockDb) }));

// Mock simularComissao via mock de ./db-financeiro deps — mais limpo
// importar fecharComissao e mockar internamente. Aqui mockamos o que
// `simularComissao` precisa do DB: regraComissao + cobranças.
vi.mock("../escritorio/db-financeiro", () => ({
  obterRegraComissao: vi.fn(async () => ({
    aliquotaPercent: "10.00",
    valorMinimoCobranca: "0.00",
    modo: "flat",
    baseFaixa: "comissionavel",
  })),
  listarFaixasComissao: vi.fn(async () => []),
  criarCategoriaDespesa: vi.fn(async () => 1),
}));

const { fecharComissao, FechamentoJaExisteError } = await import(
  "../escritorio/db-comissoes"
);

beforeEach(() => {
  selectQueue = [];
});

describe("fecharComissao — dedup cross-origem", () => {
  it("rejeita criar duplicado quando já existe (default forcarDuplicado=false)", async () => {
    // 1ª SELECT em comissoes_fechadas — retorna fechamento existente
    selectQueue.push([{ id: 999, origem: "manual" }]);

    await expect(
      fecharComissao({
        escritorioId: 100,
        atendenteId: 10,
        periodoInicio: "2026-03-01",
        periodoFim: "2026-03-31",
        fechadoPorUserId: 1,
      }),
    ).rejects.toBeInstanceOf(FechamentoJaExisteError);
  });

  it("FechamentoJaExisteError carrega id e origem do existente", async () => {
    selectQueue.push([{ id: 999, origem: "automatico" }]);

    try {
      await fecharComissao({
        escritorioId: 100,
        atendenteId: 10,
        periodoInicio: "2026-03-01",
        periodoFim: "2026-03-31",
        fechadoPorUserId: 1,
      });
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FechamentoJaExisteError);
      const e = err as InstanceType<typeof FechamentoJaExisteError>;
      expect(e.comissaoFechadaId).toBe(999);
      expect(e.origem).toBe("automatico");
    }
  });

  it("permite criar duplicado quando forcarDuplicado=true (skip da check)", async () => {
    // SELECT em comissoes_fechadas — NÃO é chamada porque forcar=true
    // Precisamos preparar selects pra simularComissao (cobranças=[])
    // SELECT cobranças → vazio
    selectQueue.push([]);

    const r = await fecharComissao({
      escritorioId: 100,
      atendenteId: 10,
      periodoInicio: "2026-03-01",
      periodoFim: "2026-03-31",
      fechadoPorUserId: 1,
      forcarDuplicado: true,
    });

    // Conseguiu criar — id mockado (42)
    expect(r.id).toBe(42);
  });
});
