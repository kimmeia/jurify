/**
 * Testes do dedup cross-origem em `fecharComissao`.
 *
 * Por default, `fecharComissao` rejeita criar fechamento duplicado pro
 * mesmo `(escritorioId, atendenteId, periodoInicio, periodoFim, versao=0)` —
 * lança `FechamentoJaExisteError` com o id existente. Caller decide:
 *  - Cron pula silencioso (catch + marcarConcluida)
 *  - UI manual mostra dialog "criar mesmo assim?" e re-tenta com
 *    `forcarDuplicado:true` (incrementa versão)
 *
 * Proteção em 2 camadas:
 *  (1) SELECT pré-INSERT — UX-first, retorna erro estruturado.
 *  (2) UNIQUE no DB (migration 0105) — fecha janela de race entre
 *      o check e o INSERT. Quando o INSERT cai em ER_DUP_ENTRY,
 *      re-fetch retorna o vencedor da race.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

let selectQueue: unknown[][] = [];
let insertImpl: () => Promise<unknown> = () =>
  Promise.resolve([{ id: 42 }]);
let lastInsertValues: unknown = null;

function makeSelectBuilder() {
  const next = () => Promise.resolve(selectQueue.shift() ?? []);
  const builder: any = {
    from: () => builder,
    leftJoin: () => builder,
    innerJoin: () => builder,
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
    values: (vals: unknown) => {
      lastInsertValues = vals;
      return {
        $returningId: () => insertImpl(),
        then: (r: (v: unknown) => unknown) =>
          r([{ insertId: 42, affectedRows: 1 }]),
      };
    },
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
  lastInsertValues = null;
  insertImpl = () => Promise.resolve([{ id: 42 }]);
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
    // Com `forcarDuplicado=true`:
    //   1. SELECT MAX(versao) — sem rows prévias = MAX=null → versao=0
    //   2. SELECT cobranças do período (NOT EXISTS embutido no SQL) → vazio
    //
    // Antes havia um SELECT extra do `carregarMapaCobrancasJaFechadas`
    // (carregava lista de IDs pra memória + NOT IN). Substituído por
    // subquery NOT EXISTS direto no WHERE — uma query a menos.
    selectQueue.push([{ max: -1 }]); // MAX(versao) coalesce(null, -1) = -1 → versao=0
    selectQueue.push([]); // cobranças vazio

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

describe("fecharComissao — race condition cron + manual (UNIQUE)", () => {
  it("captura ER_DUP_ENTRY do INSERT e refetch o vencedor da race", async () => {
    // Cenário: cron e manual disparados no mesmo segundo. Ambos passam
    // pelo check inicial (não veem o do outro). O primeiro INSERT vence
    // e cria; o segundo cai em ER_DUP_ENTRY na UNIQUE do DB. Esperado:
    // segundo refetch o vencedor e lança FechamentoJaExisteError com o id.
    //
    // Queue de selects:
    //  1. check pré-INSERT → vazio (ainda não vê o do outro)
    //  2. simularComissao (cobranças) → vazio
    //  3. refetch após ER_DUP_ENTRY → vencedor
    selectQueue.push([]);
    selectQueue.push([]);
    selectQueue.push([{ id: 777, origem: "automatico" }]);

    // INSERT lança ER_DUP_ENTRY simulando colisão na UNIQUE.
    // Drizzle envolve mysql2; código de erro real fica em `cause`.
    insertImpl = () => {
      const err = new Error("Duplicate entry") as Error & {
        cause?: { code?: string; errno?: number };
      };
      err.cause = { code: "ER_DUP_ENTRY", errno: 1062 };
      return Promise.reject(err);
    };

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
      // Refetch achou o vencedor (id=777, criado pelo cron)
      expect(e.comissaoFechadaId).toBe(777);
      expect(e.origem).toBe("automatico");
    }
  });

  it("propaga erro não-dedup do INSERT (não confunde com race)", async () => {
    // Garantia: se o INSERT falhar por outro motivo (FK constraint,
    // disk full, etc.), NÃO devolve FechamentoJaExisteError silencioso.
    selectQueue.push([]); // check pré-INSERT vazio
    selectQueue.push([]); // simularComissao cobranças vazio

    insertImpl = () => Promise.reject(new Error("Some random DB error"));

    await expect(
      fecharComissao({
        escritorioId: 100,
        atendenteId: 10,
        periodoInicio: "2026-03-01",
        periodoFim: "2026-03-31",
        fechadoPorUserId: 1,
      }),
    ).rejects.toThrow(/some random db error/i);
  });

  it("forcarDuplicado calcula versao = MAX + 1 (não recicla 0)", async () => {
    // Já existe fechamento primário (versao=0) e um re-fechamento (versao=1)
    // do operador. Novo forcarDuplicado deve gerar versao=2.
    selectQueue.push([{ max: 1 }]); // MAX(versao) atual = 1
    selectQueue.push([]); // simularComissao cobranças vazio

    await fecharComissao({
      escritorioId: 100,
      atendenteId: 10,
      periodoInicio: "2026-03-01",
      periodoFim: "2026-03-31",
      fechadoPorUserId: 1,
      forcarDuplicado: true,
    });

    expect((lastInsertValues as { versao: number }).versao).toBe(2);
  });

  it("fechamento primário (default) sempre insere com versao=0", async () => {
    // Operador clica "Fechar período" sem forcarDuplicado. Versao=0 fixa
    // pra entrar no slot único protegido pela UNIQUE.
    selectQueue.push([]); // check pré-INSERT vazio
    selectQueue.push([]); // simularComissao cobranças vazio

    await fecharComissao({
      escritorioId: 100,
      atendenteId: 10,
      periodoInicio: "2026-03-01",
      periodoFim: "2026-03-31",
      fechadoPorUserId: 1,
    });

    expect((lastInsertValues as { versao: number }).versao).toBe(0);
  });
});
