/**
 * Testes da integração financeira do fechamento de comissão (PR B):
 *  - `calcularVencimentoComissao`: dia 5 do mês seguinte
 *  - `garantirCategoriaComissoes`: idempotente (cria se não existe,
 *     reusa se existe)
 *
 * O fluxo completo de `fecharComissao` (criar despesa + atualizar FK)
 * é coberto por testes manuais — montar o mock de `simularComissao`
 * exige reproduzir asaas_cobrancas + categorias_cobranca, fora do
 * escopo de um teste unitário leve.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

let selectQueue: unknown[][] = [];
const captured: Array<{
  op: "select" | "insert";
  table: string;
  values?: unknown;
}> = [];

function tableName(t: unknown): string {
  const anyT = t as any;
  return anyT?._?.name || anyT?.[Symbol.for("drizzle:Name")] || "unknown";
}

function makeSelectBuilder(table: unknown) {
  const next = () => Promise.resolve(selectQueue.shift() ?? []);
  const builder: any = {
    from(_t: unknown) {
      captured.push({ op: "select", table: tableName(_t) });
      return builder;
    },
    where: (_w: unknown) => builder,
    limit: (_n: number) => next(),
    then: (resolve: (v: unknown) => unknown) =>
      resolve(selectQueue.shift() ?? []),
  };
  void table;
  return builder;
}

const mockDb = {
  select: () => ({ from: (t: unknown) => makeSelectBuilder(t) }),
  insert: (table: unknown) => ({
    values(values: unknown) {
      captured.push({ op: "insert", table: tableName(table), values });
      return {
        $returningId: () => Promise.resolve([{ id: 42 }]),
        then: (r: (v: unknown) => unknown) =>
          r([{ insertId: 42, affectedRows: 1 }]),
      };
    },
  }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

const { calcularVencimentoComissao, garantirCategoriaComissoes } = await import(
  "../escritorio/db-comissoes"
);

beforeEach(() => {
  selectQueue = [];
  captured.length = 0;
});

describe("calcularVencimentoComissao", () => {
  it("março → dia 5 de abril", () => {
    expect(calcularVencimentoComissao("2026-03-31")).toBe("2026-04-05");
  });

  it("dezembro → dia 5 de janeiro do ano seguinte", () => {
    expect(calcularVencimentoComissao("2026-12-31")).toBe("2027-01-05");
  });

  it("fevereiro bissexto → dia 5 de março", () => {
    expect(calcularVencimentoComissao("2024-02-29")).toBe("2024-03-05");
  });

  it("janeiro → dia 5 de fevereiro (mês de transição entre extremos)", () => {
    expect(calcularVencimentoComissao("2026-01-31")).toBe("2026-02-05");
  });

  it("rejeita formato inválido", () => {
    expect(() => calcularVencimentoComissao("inválido")).toThrow();
  });
});

describe("garantirCategoriaComissoes", () => {
  it("retorna ID existente quando categoria já cadastrada", async () => {
    selectQueue.push([{ id: 7 }]);

    const id = await garantirCategoriaComissoes(100);

    expect(id).toBe(7);
    // Não deve ter inserido nada
    const inserts = captured.filter((c) => c.op === "insert");
    expect(inserts).toHaveLength(0);
  });

  it("cria categoria 'Comissões' quando não existe e retorna novo ID", async () => {
    // 1ª select: existente (vazio)
    selectQueue.push([]);

    const id = await garantirCategoriaComissoes(100);

    expect(id).toBe(42); // mockDb retorna 42 em todo $returningId
    const inserts = captured.filter(
      (c) => c.op === "insert" && c.table === "categorias_despesa",
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({
      escritorioId: 100,
      nome: "Comissões",
    });
  });
});
