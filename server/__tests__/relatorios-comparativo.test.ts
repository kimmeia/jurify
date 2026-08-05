/**
 * Comparativo com período anterior — a mesma regra alimenta os cards da tela
 * e do PDF, então um arredondamento diferente aqui faz o papel divergir do
 * painel.
 */

import { describe, it, expect } from "vitest";
import {
  calcularDelta,
  calcularDeltaPontos,
  formatarDelta,
  periodoAnterior,
} from "../../shared/relatorios-comparativo";

describe("calcularDelta", () => {
  it("calcula a variação relativa arredondada", () => {
    expect(calcularDelta(1284, 1147)).toEqual({ valor: 12, bom: true, unidade: "%" });
    expect(calcularDelta(7902, 8140)).toEqual({ valor: -3, bom: false, unidade: "%" });
  });

  it("inverte o julgamento quando menor é melhor", () => {
    expect(calcularDelta(840, 1080, true)).toEqual({ valor: -22, bom: true, unidade: "%" });
    expect(calcularDelta(1080, 840, true)).toEqual({ valor: 29, bom: false, unidade: "%" });
  });

  it("devolve null sem base de comparação", () => {
    expect(calcularDelta(100, 0)).toBeNull();
    expect(calcularDelta(100, null)).toBeNull();
    expect(calcularDelta(100, undefined)).toBeNull();
    expect(calcularDelta(null, 100)).toBeNull();
  });

  it("devolve null pra NaN — margem sem receita chega assim", () => {
    expect(calcularDelta(NaN, 35)).toBeNull();
    expect(calcularDelta(41, NaN)).toBeNull();
    expect(calcularDelta(Infinity, 35)).toBeNull();
  });

  it("devolve null quando não houve variação", () => {
    expect(calcularDelta(50, 50)).toBeNull();
    // Variação abaixo de meio ponto percentual arredonda pra zero.
    expect(calcularDelta(1002, 1000)).toBeNull();
  });
});

describe("calcularDeltaPontos", () => {
  it("compara percentuais em pontos, não em variação relativa", () => {
    expect(calcularDeltaPontos(27, 23)).toEqual({ valor: 4, bom: true, unidade: "p.p." });
    // A variação relativa diria +17% — exagero de quem leu 4 pontos.
    expect(calcularDelta(27, 23)?.valor).toBe(17);
  });

  it("mantém uma casa decimal", () => {
    expect(calcularDeltaPontos(41.3, 35)).toEqual({ valor: 6.3, bom: true, unidade: "p.p." });
  });

  it("aceita anterior zerado — zero por cento é uma base válida em pontos", () => {
    expect(calcularDeltaPontos(12, 0)).toEqual({ valor: 12, bom: true, unidade: "p.p." });
  });

  it("devolve null pra NaN e pra ausência de dado", () => {
    expect(calcularDeltaPontos(NaN, 35)).toBeNull();
    expect(calcularDeltaPontos(41, null)).toBeNull();
    expect(calcularDeltaPontos(null, null)).toBeNull();
  });
});

describe("formatarDelta", () => {
  it("formata com sinal e unidade", () => {
    expect(formatarDelta({ valor: 12, bom: true, unidade: "%" })).toBe("+12%");
    expect(formatarDelta({ valor: -22, bom: true, unidade: "%" })).toBe("-22%");
    expect(formatarDelta({ valor: 6.3, bom: true, unidade: "p.p." })).toBe("+6,3 p.p.");
  });
});

describe("periodoAnterior", () => {
  it("devolve o mesmo número de dias imediatamente antes", () => {
    // 01–30/07 são 30 dias; o anterior vai de 01/06 a 30/06.
    expect(periodoAnterior("2026-07-01", "2026-07-30")).toEqual({
      inicio: "2026-06-01",
      fim: "2026-06-30",
    });
  });

  it("trata range de um dia só", () => {
    expect(periodoAnterior("2026-07-15", "2026-07-15")).toEqual({
      inicio: "2026-07-14",
      fim: "2026-07-14",
    });
  });

  it("atravessa a virada do ano", () => {
    expect(periodoAnterior("2026-01-01", "2026-01-07")).toEqual({
      inicio: "2025-12-25",
      fim: "2025-12-31",
    });
  });

  it("conta dias, não meses — março de 31 dias volta pra dentro de janeiro", () => {
    // 31 dias terminando em 29/02 (bissexto) puxam 30 e 31 de janeiro junto.
    expect(periodoAnterior("2028-03-01", "2028-03-31")).toEqual({
      inicio: "2028-01-30",
      fim: "2028-02-29",
    });
  });

  it("devolve o próprio range quando a data é inválida", () => {
    expect(periodoAnterior("nao-e-data", "2026-07-30")).toEqual({
      inicio: "nao-e-data",
      fim: "2026-07-30",
    });
  });
});
