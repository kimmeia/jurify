/**
 * Testes dos helpers puros do relatório de Agenda (router-relatorios).
 *
 * Espelham a agregação que a procedure `agenda` aplica sobre as linhas
 * vindas do SQL (GROUP BY) — validadas sem tocar no banco.
 */

import { describe, expect, it } from "vitest";
import {
  classificarComparecimento,
  calcularTaxaComparecimento,
  resumirComparecimento,
  montarRankingAgenda,
  montarSerieAgenda,
  resolverGranularidadeAgenda,
} from "../escritorio/router-relatorios";
import { gerarAgendaPdf, type AgendaPdfData } from "../escritorio/relatorios-agenda-pdf";

describe("classificarComparecimento", () => {
  it("mapeia cada valor do enum", () => {
    expect(classificarComparecimento("compareceu")).toBe("compareceu");
    expect(classificarComparecimento("nao_compareceu")).toBe("naoCompareceu");
    expect(classificarComparecimento("remarcado")).toBe("remarcado");
  });
  it("NULL ou desconhecido vira pendente", () => {
    expect(classificarComparecimento(null)).toBe("pendente");
    expect(classificarComparecimento("seja_la_o_que_for")).toBe("pendente");
  });
});

describe("calcularTaxaComparecimento", () => {
  it("compareceu ÷ (compareceu + não veio + remarcou), arredondado", () => {
    expect(calcularTaxaComparecimento({ compareceu: 86, naoCompareceu: 23, remarcado: 19 })).toBe(67);
    expect(calcularTaxaComparecimento({ compareceu: 2, naoCompareceu: 1, remarcado: 0 })).toBe(67);
    expect(calcularTaxaComparecimento({ compareceu: 1, naoCompareceu: 1, remarcado: 0 })).toBe(50);
  });
  it("só os 3 com resultado entram (pendentes ficam fora do denominador)", () => {
    expect(calcularTaxaComparecimento({ compareceu: 10, naoCompareceu: 0, remarcado: 0 })).toBe(100);
  });
  it("sem nenhum resultado → null (evita divisão por zero)", () => {
    expect(calcularTaxaComparecimento({ compareceu: 0, naoCompareceu: 0, remarcado: 0 })).toBeNull();
  });
});

describe("resumirComparecimento", () => {
  it("soma por categoria, conta pendente e calcula a taxa", () => {
    const r = resumirComparecimento([
      { comparecimento: "compareceu", total: 5 },
      { comparecimento: "compareceu", total: 3 },
      { comparecimento: "nao_compareceu", total: 2 },
      { comparecimento: "remarcado", total: 1 },
      { comparecimento: null, total: 4 },
    ]);
    expect(r).toEqual({
      total: 15,
      compareceu: 8,
      naoCompareceu: 2,
      remarcado: 1,
      pendente: 4,
      taxaComparecimento: 73, // 8 / (8+2+1) = 0.7272… → 73
    });
  });
  it("lista vazia → tudo zero, taxa null", () => {
    expect(resumirComparecimento([])).toEqual({
      total: 0,
      compareceu: 0,
      naoCompareceu: 0,
      remarcado: 0,
      pendente: 0,
      taxaComparecimento: null,
    });
  });
});

describe("montarRankingAgenda", () => {
  const nomes = new Map<number, string>([
    [1, "Marina"],
    [2, "Carlos"],
  ]);

  it("agrupa por atendente e ordena por total desc", () => {
    const ranking = montarRankingAgenda(
      [
        { colabId: 1, comparecimento: "compareceu", total: 3 },
        { colabId: 1, comparecimento: "nao_compareceu", total: 1 },
        { colabId: 2, comparecimento: "compareceu", total: 10 },
        { colabId: 2, comparecimento: "remarcado", total: 2 },
      ],
      nomes,
    );
    expect(ranking.map((r) => r.colabId)).toEqual([2, 1]); // Carlos 12 > Marina 4
    expect(ranking[0]).toMatchObject({ nome: "Carlos", total: 12, compareceu: 10, remarcado: 2 });
    expect(ranking[1]).toMatchObject({ nome: "Marina", total: 4, compareceu: 3, naoCompareceu: 1 });
  });

  it("ignora linhas sem colabId e usa fallback de nome (#id)", () => {
    const ranking = montarRankingAgenda(
      [
        { colabId: null, comparecimento: "compareceu", total: 99 },
        { colabId: 7, comparecimento: "compareceu", total: 1 },
      ],
      nomes,
    );
    expect(ranking).toHaveLength(1);
    expect(ranking[0]).toMatchObject({ colabId: 7, nome: "#7", total: 1 });
  });
});

describe("montarSerieAgenda", () => {
  it("pivota por bucket, ordena asc e ignora bucket nulo", () => {
    const serie = montarSerieAgenda([
      { bucket: "2026-05-08", comparecimento: "compareceu", total: 4 },
      { bucket: "2026-05-01", comparecimento: "compareceu", total: 2 },
      { bucket: "2026-05-01", comparecimento: "nao_compareceu", total: 1 },
      { bucket: null, comparecimento: "compareceu", total: 99 },
    ]);
    expect(serie).toHaveLength(2);
    expect(serie[0]).toEqual({
      bucket: "2026-05-01", compareceu: 2, naoCompareceu: 1, remarcado: 0, pendente: 0, total: 3,
    });
    expect(serie[1]).toEqual({
      bucket: "2026-05-08", compareceu: 4, naoCompareceu: 0, remarcado: 0, pendente: 0, total: 4,
    });
  });

  it("aceita bucket como Date (normaliza p/ YYYY-MM-DD)", () => {
    const serie = montarSerieAgenda([
      { bucket: new Date("2026-05-01T00:00:00.000Z"), comparecimento: "remarcado", total: 2 },
    ]);
    expect(serie[0].bucket).toBe("2026-05-01");
    expect(serie[0].remarcado).toBe(2);
  });
});

describe("resolverGranularidadeAgenda", () => {
  const d = (s: string) => new Date(s + "T00:00:00.000Z");
  it("≤ 14 dias → dia", () => {
    expect(resolverGranularidadeAgenda(d("2026-05-01"), d("2026-05-07"))).toBe("dia");
    expect(resolverGranularidadeAgenda(d("2026-05-01"), d("2026-05-14"))).toBe("dia");
  });
  it("15–92 dias → semana", () => {
    expect(resolverGranularidadeAgenda(d("2026-05-01"), d("2026-05-30"))).toBe("semana");
    expect(resolverGranularidadeAgenda(d("2026-05-01"), d("2026-07-31"))).toBe("semana");
  });
  it("> 92 dias → mes", () => {
    expect(resolverGranularidadeAgenda(d("2026-01-01"), d("2026-12-31"))).toBe("mes");
  });
});

describe("gerarAgendaPdf", () => {
  const sample: AgendaPdfData = {
    periodo: { inicio: "2026-05-01", fim: "2026-05-31" },
    granularidade: "semana",
    totais: { total: 12, compareceu: 7, naoCompareceu: 2, remarcado: 1, pendente: 2, taxaComparecimento: 70 },
    porTipo: [
      { tipo: "reuniao_comercial", total: 8 },
      { tipo: "audiencia", total: 4 },
    ],
    serie: [
      { bucket: "2026-05-04", compareceu: 3, naoCompareceu: 1, remarcado: 0, pendente: 1, total: 5 },
      { bucket: "2026-05-11", compareceu: 4, naoCompareceu: 1, remarcado: 1, pendente: 1, total: 7 },
    ],
    porAtendente: [
      { colabId: 1, nome: "Marina", total: 7, compareceu: 5, naoCompareceu: 1, remarcado: 1, pendente: 0, taxaComparecimento: 71 },
      { colabId: 2, nome: "Carlos", total: 5, compareceu: 2, naoCompareceu: 1, remarcado: 0, pendente: 2, taxaComparecimento: 67 },
    ],
  };

  it("gera um PDF não-vazio (assinatura %PDF) com dados completos", async () => {
    const buf = await gerarAgendaPdf({
      data: sample,
      nomeEscritorio: "Escritório Teste",
      tipoLabel: "Todos os tipos",
      atendenteLabel: "Todos",
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(800);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("não quebra com série / tipos / ranking vazios e taxa null", async () => {
    const buf = await gerarAgendaPdf({
      data: {
        ...sample,
        serie: [],
        porTipo: [],
        porAtendente: [],
        totais: { total: 0, compareceu: 0, naoCompareceu: 0, remarcado: 0, pendente: 0, taxaComparecimento: null },
      },
      nomeEscritorio: "Escritório Vazio",
      tipoLabel: "Todos os tipos",
      atendenteLabel: "Todos",
    });
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
