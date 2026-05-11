/**
 * Testes de cálculo e exportação do DRE.
 *
 * `gerarDRECSV` é função pura (input → string CSV) — testada diretamente.
 * `calcularDRE` toca DB — testada com mock leve seguindo o padrão dos
 * outros testes do projeto.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DREResultado } from "../escritorio/dre";

// ─── Mock do getDb pra calcularDRE ────────────────────────────────────────────

let selectQueueByCall: unknown[][] = [];
let callIdx = 0;

function makeSelectBuilder() {
  const builder: any = {
    from() {
      return builder;
    },
    leftJoin() {
      return builder;
    },
    where() {
      return builder;
    },
    then: (r: (v: unknown) => unknown) =>
      r(selectQueueByCall[callIdx++] ?? []),
  };
  return builder;
}

const mockDb = {
  select: () => ({ from: () => makeSelectBuilder() }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

import { calcularDRE, gerarDRECSV } from "../escritorio/dre";

beforeEach(() => {
  selectQueueByCall = [];
  callIdx = 0;
});

// ─── gerarDRECSV — função pura ────────────────────────────────────────────────

describe("gerarDRECSV", () => {
  const dreBase: DREResultado = {
    periodo: { inicio: "2026-05-01", fim: "2026-05-31" },
    receitas: {
      total: 10000.0,
      porCategoria: [
        {
          categoriaId: 1,
          categoriaNome: "Honorários",
          total: 8000.0,
          count: 4,
          percentual: 80,
        },
        {
          categoriaId: 2,
          categoriaNome: "Consultoria",
          total: 2000.0,
          count: 2,
          percentual: 20,
        },
      ],
    },
    despesas: {
      total: 4500.0,
      porCategoria: [
        {
          categoriaId: 10,
          categoriaNome: "Aluguel",
          total: 3000.0,
          count: 1,
          percentual: 66.67,
        },
        {
          categoriaId: null,
          categoriaNome: "(sem categoria)",
          total: 1500.0,
          count: 3,
          percentual: 33.33,
        },
      ],
    },
    resultadoLiquido: 5500.0,
    margemPercent: 55.0,
  };

  it("inclui BOM UTF-8 no começo (Excel reconhece acentos)", () => {
    const csv = gerarDRECSV(dreBase, "Meu Escritório");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("usa ; como separador e vírgula decimal (padrão BR)", () => {
    const csv = gerarDRECSV(dreBase, "Meu Escritório");
    expect(csv).toContain("8000,00");
    expect(csv).toContain("3000,00");
    // Não deve haver vírgula como separador de coluna
    const linhasComValor = csv
      .split("\r\n")
      .filter((l) => /\d/.test(l) && !l.startsWith('"DRE'));
    for (const linha of linhasComValor) {
      // Cada linha de dado tem ; (não ,)
      if (linha.includes("Honorários") || linha.includes("Aluguel")) {
        expect(linha).toContain(";");
      }
    }
  });

  it("exibe período formatado em DD/MM/YYYY", () => {
    const csv = gerarDRECSV(dreBase, "Meu Escritório");
    expect(csv).toContain("01/05/2026 a 31/05/2026");
  });

  it("escapa aspas duplas em nomes de escritório/categoria", () => {
    const dre = {
      ...dreBase,
      receitas: {
        ...dreBase.receitas,
        porCategoria: [
          {
            categoriaId: 99,
            categoriaNome: 'Honorário "Premium"',
            total: 100,
            count: 1,
            percentual: 100,
          },
        ],
      },
    };
    const csv = gerarDRECSV(dre, 'Escritório "Top"');
    expect(csv).toContain('Honorário ""Premium""');
  });

  it("inclui linhas TOTAL RECEITAS e TOTAL DESPESAS", () => {
    const csv = gerarDRECSV(dreBase, "Meu Escritório");
    expect(csv).toContain('"TOTAL RECEITAS";10000,00');
    expect(csv).toContain('"TOTAL DESPESAS";4500,00');
  });

  it("inclui Resultado Líquido e Margem", () => {
    const csv = gerarDRECSV(dreBase, "Meu Escritório");
    expect(csv).toContain('"RESULTADO LÍQUIDO";5500,00');
    expect(csv).toContain('"MARGEM";55,00%');
  });

  it("Margem='—' quando NaN (receita zero)", () => {
    const dre: DREResultado = {
      ...dreBase,
      receitas: { total: 0, porCategoria: [] },
      resultadoLiquido: -1000,
      margemPercent: NaN,
    };
    const csv = gerarDRECSV(dre, "Meu Escritório");
    expect(csv).toContain('"MARGEM";—');
  });

  it("seções vazias renderizam totais zerados sem quebrar", () => {
    const dre: DREResultado = {
      periodo: { inicio: "2026-05-01", fim: "2026-05-31" },
      receitas: { total: 0, porCategoria: [] },
      despesas: { total: 0, porCategoria: [] },
      resultadoLiquido: 0,
      margemPercent: NaN,
    };
    const csv = gerarDRECSV(dre, "Vazio");
    expect(csv).toContain('"TOTAL RECEITAS";0,00');
    expect(csv).toContain('"TOTAL DESPESAS";0,00');
  });
});

// ─── calcularDRE — agregação com DB mockado ──────────────────────────────────

describe("calcularDRE — agregação", () => {
  it("agrupa cobranças pagas por categoria e calcula percentuais", async () => {
    // 1ª chamada (cobranças):
    selectQueueByCall.push([
      { categoriaId: 1, categoriaNome: "Honorários", valor: "5000.00" },
      { categoriaId: 1, categoriaNome: "Honorários", valor: "3000.00" },
      { categoriaId: 2, categoriaNome: "Consultoria", valor: "2000.00" },
    ]);
    // 2ª chamada (despesas):
    selectQueueByCall.push([]);

    const dre = await calcularDRE(1, "2026-05-01", "2026-05-31");

    expect(dre.receitas.total).toBe(10000);
    expect(dre.receitas.porCategoria).toHaveLength(2);

    const honorarios = dre.receitas.porCategoria.find(
      (c) => c.categoriaNome === "Honorários",
    );
    expect(honorarios?.total).toBe(8000);
    expect(honorarios?.count).toBe(2);
    expect(honorarios?.percentual).toBe(80);

    const consultoria = dre.receitas.porCategoria.find(
      (c) => c.categoriaNome === "Consultoria",
    );
    expect(consultoria?.total).toBe(2000);
    expect(consultoria?.percentual).toBe(20);
  });

  it("categoria null vira '(sem categoria)'", async () => {
    selectQueueByCall.push([
      { categoriaId: null, categoriaNome: null, valor: "500.00" },
    ]);
    selectQueueByCall.push([]);

    const dre = await calcularDRE(1, "2026-05-01", "2026-05-31");
    expect(dre.receitas.porCategoria[0].categoriaNome).toBe("(sem categoria)");
    expect(dre.receitas.porCategoria[0].categoriaId).toBeNull();
  });

  it("ordena categorias por total desc", async () => {
    selectQueueByCall.push([
      { categoriaId: 1, categoriaNome: "Pequeno", valor: "100.00" },
      { categoriaId: 2, categoriaNome: "Grande", valor: "1000.00" },
      { categoriaId: 3, categoriaNome: "Médio", valor: "500.00" },
    ]);
    selectQueueByCall.push([]);

    const dre = await calcularDRE(1, "2026-05-01", "2026-05-31");
    expect(dre.receitas.porCategoria.map((c) => c.categoriaNome)).toEqual([
      "Grande",
      "Médio",
      "Pequeno",
    ]);
  });

  it("despesas filtradas por status (pago/parcial) e período (dataPagamento|vencimento)", async () => {
    selectQueueByCall.push([]); // sem receitas
    selectQueueByCall.push([
      // pago com dataPagamento DENTRO do período
      {
        categoriaId: 10,
        categoriaNome: "Aluguel",
        valor: "3000.00",
        status: "pago",
        dataPagamento: "2026-05-10",
        vencimento: "2026-05-05",
      },
      // pago mas dataPagamento FORA do período → excluído
      {
        categoriaId: 10,
        categoriaNome: "Aluguel",
        valor: "3000.00",
        status: "pago",
        dataPagamento: "2026-04-30",
        vencimento: "2026-05-05",
      },
      // parcial com vencimento DENTRO do período → incluído
      {
        categoriaId: 11,
        categoriaNome: "Internet",
        valor: "200.00",
        status: "parcial",
        dataPagamento: null,
        vencimento: "2026-05-15",
      },
      // parcial com vencimento FORA → excluído
      {
        categoriaId: 11,
        categoriaNome: "Internet",
        valor: "200.00",
        status: "parcial",
        dataPagamento: null,
        vencimento: "2026-06-15",
      },
    ]);

    const dre = await calcularDRE(1, "2026-05-01", "2026-05-31");
    expect(dre.despesas.total).toBe(3200);
    expect(dre.despesas.porCategoria.find((c) => c.categoriaNome === "Aluguel")?.total).toBe(3000);
    expect(dre.despesas.porCategoria.find((c) => c.categoriaNome === "Internet")?.total).toBe(200);
  });

  it("resultado e margem calculados corretamente", async () => {
    selectQueueByCall.push([
      { categoriaId: 1, categoriaNome: "Honorários", valor: "10000.00" },
    ]);
    selectQueueByCall.push([
      {
        categoriaId: 10,
        categoriaNome: "Aluguel",
        valor: "4000.00",
        status: "pago",
        dataPagamento: "2026-05-10",
        vencimento: "2026-05-05",
      },
    ]);

    const dre = await calcularDRE(1, "2026-05-01", "2026-05-31");
    expect(dre.resultadoLiquido).toBe(6000);
    expect(dre.margemPercent).toBe(60);
  });

  it("margemPercent é NaN quando receita=0", async () => {
    selectQueueByCall.push([]); // sem receitas
    selectQueueByCall.push([
      {
        categoriaId: 10,
        categoriaNome: "Aluguel",
        valor: "1000.00",
        status: "pago",
        dataPagamento: "2026-05-10",
        vencimento: "2026-05-05",
      },
    ]);

    const dre = await calcularDRE(1, "2026-05-01", "2026-05-31");
    expect(dre.resultadoLiquido).toBe(-1000);
    expect(Number.isNaN(dre.margemPercent)).toBe(true);
  });
});
