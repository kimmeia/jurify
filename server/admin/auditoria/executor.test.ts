/**
 * Comportamento do executor da varredura.
 *
 * O que importa aqui não é o SQL das regras (isso só o banco responde) e
 * sim o contrato do executor: uma regra quebrada não pode derrubar a
 * varredura nem se disfarçar de invariante saudável, e o resumo precisa
 * contar o que o painel vai mostrar.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinhaAchado, Regra } from "./tipos";

const dbFalso = { marcador: "db" };

vi.mock("../../db", () => ({
  getDb: async () => dbFalso,
}));

const regrasFalsas: Regra[] = [];

vi.mock("./regras", () => ({
  get REGRAS() {
    return regrasFalsas;
  },
  listarRegras: () => regrasFalsas.map(({ detectar: _d, ...meta }) => meta),
}));

const { varrer, LIMITE_LINHAS_PADRAO } = await import("./executor");

function linha(alvoId: number): LinhaAchado {
  return { escritorioId: 1, alvoId, descricao: `linha ${alvoId}`, valores: {} };
}

function regra(over: Partial<Regra> & Pick<Regra, "id">): Regra {
  return {
    titulo: "Regra de teste",
    severidade: "medio",
    dominio: "financeiro",
    nivel: "C",
    tabela: "tabela_teste",
    invariante: "invariante de teste com texto suficiente pra passar",
    correcaoPrevista: "correção prevista de teste com texto suficiente",
    shadow: true,
    detectar: async () => [],
    ...over,
  } as Regra;
}

beforeEach(() => {
  regrasFalsas.length = 0;
});

describe("varredura", () => {
  it("marca ok quando a invariante não encontra violação", async () => {
    regrasFalsas.push(regra({ id: "AAA-01" }));

    const r = await varrer();

    expect(r.achados).toHaveLength(1);
    expect(r.achados[0].ok).toBe(true);
    expect(r.resumo.achados).toBe(0);
    expect(r.resumo.linhasAfetadas).toBe(0);
  });

  it("isola a regra que falha e continua as outras", async () => {
    regrasFalsas.push(
      regra({
        id: "AAA-01",
        detectar: async () => {
          throw new Error("Unknown column 'saldoJCredd'");
        },
      }),
      regra({ id: "BBB-02", detectar: async () => [linha(7)] }),
    );

    const r = await varrer();

    const quebrada = r.achados.find((a) => a.regra.id === "AAA-01")!;
    expect(quebrada.erro).toContain("Unknown column");
    // Regra quebrada nunca pode passar por invariante respeitada.
    expect(quebrada.ok).toBe(false);

    const outra = r.achados.find((a) => a.regra.id === "BBB-02")!;
    expect(outra.total).toBe(1);
    expect(r.resumo.regrasComErro).toBe(1);
    expect(r.resumo.regrasExecutadas).toBe(2);
  });

  it("conta o resumo por severidade e contabiliza shadow", async () => {
    regrasFalsas.push(
      regra({ id: "AAA-01", severidade: "critico", detectar: async () => [linha(1), linha(2)] }),
      regra({ id: "BBB-02", severidade: "baixo", shadow: false, detectar: async () => [linha(3)] }),
      regra({ id: "CCC-03", severidade: "alto" }),
    );

    const r = await varrer();

    expect(r.resumo.achados).toBe(2);
    expect(r.resumo.linhasAfetadas).toBe(3);
    expect(r.resumo.porSeveridade.critico).toBe(1);
    expect(r.resumo.porSeveridade.baixo).toBe(1);
    expect(r.resumo.porSeveridade.alto).toBe(0);
    expect(r.resumo.emShadow).toBe(1);
  });

  it("ordena violações antes das regras saudáveis, por severidade", async () => {
    regrasFalsas.push(
      regra({ id: "AAA-01", severidade: "critico" }),
      regra({ id: "BBB-02", severidade: "baixo", detectar: async () => [linha(1)] }),
      regra({ id: "CCC-03", severidade: "alto", detectar: async () => [linha(2)] }),
    );

    const r = await varrer();

    expect(r.achados.map((a) => a.regra.id)).toEqual(["CCC-03", "BBB-02", "AAA-01"]);
  });

  it("avisa truncamento quando a regra bate no limite de linhas", async () => {
    regrasFalsas.push(
      regra({ id: "AAA-01", detectar: async (_db, limite) => Array.from({ length: limite }, (_v, i) => linha(i)) }),
    );

    const r = await varrer({ limiteLinhas: 3 });

    expect(r.achados[0].total).toBe(3);
    expect(r.achados[0].truncado).toBe(true);
  });

  it("repassa o limite padrão pra regra quando não é informado", async () => {
    let limiteRecebido = 0;
    regrasFalsas.push(
      regra({
        id: "AAA-01",
        detectar: async (_db, limite) => {
          limiteRecebido = limite;
          return [];
        },
      }),
    );

    await varrer();

    expect(limiteRecebido).toBe(LIMITE_LINHAS_PADRAO);
  });

  it("roda apenas as regras pedidas por id", async () => {
    regrasFalsas.push(regra({ id: "AAA-01" }), regra({ id: "BBB-02" }));

    const r = await varrer({ ids: ["BBB-02"] });

    expect(r.achados.map((a) => a.regra.id)).toEqual(["BBB-02"]);
  });

  it("entrega a instância do banco pra regra", async () => {
    let recebido: unknown = null;
    regrasFalsas.push(
      regra({
        id: "AAA-01",
        detectar: async (db) => {
          recebido = db;
          return [];
        },
      }),
    );

    await varrer();

    expect(recebido).toBe(dbFalso);
  });
});
