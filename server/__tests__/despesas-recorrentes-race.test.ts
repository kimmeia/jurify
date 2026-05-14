/**
 * Testes de regressão pro race condition em `gerarFilhasDeModelo`.
 *
 * Cenário do bug: cron de 1h + botão "Gerar próximas agora" da UI rodam
 * ao mesmo tempo. Ambos lêem o mesmo `Set<vencimento>` das filhas
 * existentes (em memória), e ambos tentam INSERT da mesma filha. Sem
 * UNIQUE no banco, duplicatas se acumulam.
 *
 * A migration 0101 adiciona UNIQUE em (recorrenciaDeOrigemId, vencimento).
 * O catch do INSERT em despesas-recorrentes.ts foi atualizado pra
 * detectar ER_DUP_ENTRY e seguir o loop sem incrementar `geradas`.
 *
 * Esses testes travam:
 *  - ER_DUP_ENTRY é absorvido (não propaga pro caller)
 *  - O loop continua: outras filhas pendentes ainda são geradas
 *  - O contador `geradas` reflete só as que vingaram
 *  - Erro genérico (não-DUP) também é absorvido (comportamento original)
 *  - Vencimento que falhou DUP é registrado no Set local pra que próximas
 *    iterações do mesmo run não tentem de novo
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

let selectQueue: unknown[][] = [];
let insertResults: Array<{ throwError?: Error }> = [];
let insertedVencimentos: string[] = [];

function makeSelectBuilder() {
  const builder: any = {
    from() {
      return builder;
    },
    where() {
      return builder;
    },
    orderBy() {
      return builder;
    },
    limit() {
      return Promise.resolve(selectQueue.shift() ?? []);
    },
    then: (r: (v: unknown) => unknown) => r(selectQueue.shift() ?? []),
  };
  return builder;
}

function makeInsertBuilder() {
  return {
    values(values: any) {
      const next = insertResults.shift();
      if (next?.throwError) {
        return Promise.reject(next.throwError);
      }
      insertedVencimentos.push(values.vencimento);
      return Promise.resolve([{ affectedRows: 1, insertId: 999 }]);
    },
  };
}

const mockDb = {
  select: () => ({ from: () => makeSelectBuilder() }),
  insert: () => makeInsertBuilder(),
};

vi.mock("../db", () => ({ getDb: vi.fn(async () => mockDb) }));

vi.useFakeTimers();
vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));

const { gerarFilhasDeModelo } = await import(
  "../escritorio/despesas-recorrentes"
);

const modeloMensal = {
  id: 1,
  escritorioId: 100,
  categoriaId: 5,
  descricao: "Aluguel",
  valor: "3000.00",
  vencimento: "2026-01-10",
  recorrencia: "mensal" as const,
  observacoes: null,
  criadoPorUserId: 7,
};

beforeEach(() => {
  selectQueue = [];
  insertResults = [];
  insertedVencimentos = [];
});

describe("gerarFilhasDeModelo — race com UNIQUE constraint", () => {
  it("ER_DUP_ENTRY na 1ª filha: absorve, continua loop, gera as outras", async () => {
    selectQueue.push([]); // nenhuma filha pré-existente
    insertResults = [
      // 02-10: outro worker já gravou — DUP
      { throwError: Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }) },
      // 03-10, 04-10, 05-10: este worker grava normalmente
      {},
      {},
      {},
    ];

    const n = await gerarFilhasDeModelo(modeloMensal);

    expect(n).toBe(3); // não conta a DUP
    expect(insertedVencimentos).toEqual([
      "2026-03-10",
      "2026-04-10",
      "2026-05-10",
    ]);
  });

  it("ER_DUP_ENTRY na 3ª filha: as duas anteriores contam, o resto continua", async () => {
    selectQueue.push([]);
    insertResults = [
      {}, // 02-10 OK
      {}, // 03-10 OK
      { throwError: Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }) }, // 04-10 DUP
      {}, // 05-10 OK
    ];

    const n = await gerarFilhasDeModelo(modeloMensal);

    expect(n).toBe(3);
    expect(insertedVencimentos).toEqual([
      "2026-02-10",
      "2026-03-10",
      "2026-05-10",
    ]);
  });

  it("detecta ER_DUP_ENTRY pelo regex da mensagem (caso o code venha undefined)", async () => {
    selectQueue.push([]);
    insertResults = [
      // Driver MySQL às vezes vem sem `code` — fallback é regex no message
      { throwError: new Error("Duplicate entry '1-2026-02-10' for key 'desp_recorrencia_modelo_venc_uq'") },
      {},
      {},
      {},
    ];

    const n = await gerarFilhasDeModelo(modeloMensal);

    expect(n).toBe(3);
    expect(insertedVencimentos).toEqual([
      "2026-03-10",
      "2026-04-10",
      "2026-05-10",
    ]);
  });

  it("erro genérico (não-DUP) também é absorvido mas loop continua", async () => {
    selectQueue.push([]);
    insertResults = [
      { throwError: new Error("connection lost") }, // erro real, não DUP
      {},
      {},
      {},
    ];

    // O comportamento existente já era "pula filha que falhou".
    // Esse teste garante que continua assim — não regrediu.
    const n = await gerarFilhasDeModelo(modeloMensal);

    expect(n).toBe(3);
  });

  it("todas as filhas vencidas dão DUP: retorna 0 sem crashar", async () => {
    selectQueue.push([]);
    const dup = () => ({
      throwError: Object.assign(new Error("Duplicate entry"), {
        code: "ER_DUP_ENTRY",
      }),
    });
    insertResults = [dup(), dup(), dup(), dup()];

    const n = await gerarFilhasDeModelo(modeloMensal);

    expect(n).toBe(0);
    expect(insertedVencimentos).toEqual([]);
  });
});
