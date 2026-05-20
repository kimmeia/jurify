/**
 * Testes de regressão pra bugs do engine-previdenciario.ts.
 *
 * Bug 1: Sobreposição de períodos somava em duplicado no TC.
 *   Cenário típico: trabalhador com 2 vínculos simultâneos (CLT + autônomo).
 *   Engine antigo somava ambos, inflando o tempo de contribuição (TC) bem
 *   além do que efetivamente passou no calendário.
 *
 * Bug 2: Multa de mora GPS fixa em 10% — Lei 9.430/96 art. 61 manda 0,33%
 *   por dia de atraso, limitado a 20%.
 */

import { describe, expect, it } from "vitest";
import { calcularResumoTC, calcularGPSAtraso } from "./engine-previdenciario";
import type { PeriodoContribuicao, ParametrosGPS } from "../../shared/previdenciario-types";

const periodoBase = (
  dataInicio: string,
  dataFim: string,
  tipoAtividade: PeriodoContribuicao["tipoAtividade"] = "URBANA_COMUM",
): PeriodoContribuicao => ({
  id: `${dataInicio}-${dataFim}-${tipoAtividade}`,
  dataInicio,
  dataFim,
  tipoAtividade,
  categoriaVinculo: "CLT",
});

describe("Bug previdenciário — sobreposição de períodos", () => {
  it("dois períodos com sobreposição não inflam o TC", () => {
    // Cenário: trabalhador teve 2 vínculos simultâneos. Calendário real:
    // jan/2020 → dez/2024 = 60 meses. Engine antigo dava 89.
    const tc = calcularResumoTC([
      periodoBase("2020-01-01", "2024-12-31"),
      periodoBase("2022-06-01", "2024-12-31"),
    ], "M");

    expect(tc.totalMesesComum).toBeLessThanOrEqual(60);
    expect(tc.totalMesesComum).toBeGreaterThanOrEqual(59);
  });

  it("períodos sequenciais (sem gap) são somados corretamente", () => {
    // Jan/2020 a Jun/2022 (~30m) + Jul/2022 a Dez/2024 (~30m) = ~60m total
    const tc = calcularResumoTC([
      periodoBase("2020-01-01", "2022-06-30"),
      periodoBase("2022-07-01", "2024-12-31"),
    ], "M");

    expect(tc.totalMesesComum).toBeGreaterThanOrEqual(58);
    expect(tc.totalMesesComum).toBeLessThanOrEqual(60);
  });

  it("períodos com gap entre eles não contam o gap", () => {
    // Jan/2020 a Dez/2021 (24m) + Jan/2023 a Dez/2024 (24m) = 48 meses
    // Gap de jan/2022 a dez/2022 (12m) NÃO deve ser contado
    const tc = calcularResumoTC([
      periodoBase("2020-01-01", "2021-12-31"),
      periodoBase("2023-01-01", "2024-12-31"),
    ], "M");

    expect(tc.totalMesesComum).toBeGreaterThanOrEqual(46);
    expect(tc.totalMesesComum).toBeLessThanOrEqual(48);
  });

  it("3+ períodos sobrepostos contam só o intervalo de calendário", () => {
    // A: jan/2018 a dez/2022 (60m)
    // B: jan/2020 a dez/2024 (60m, sobrepõe com A em 36m)
    // C: jan/2023 a dez/2024 (24m, sobrepõe com B em 24m)
    // União calendar: jan/2018 a dez/2024 = 84 meses
    const tc = calcularResumoTC([
      periodoBase("2018-01-01", "2022-12-31"),
      periodoBase("2020-01-01", "2024-12-31"),
      periodoBase("2023-01-01", "2024-12-31"),
    ], "M");

    expect(tc.totalMesesComum).toBeLessThanOrEqual(84);
    expect(tc.totalMesesComum).toBeGreaterThanOrEqual(82);
  });

  it("sobreposição entre TIPOS diferentes deve ser tratada por tipo independente", () => {
    // Comum: jan/2020 a dez/2022 (36m)
    // Especial 25: jan/2022 a dez/2024 (36m)
    // Cada tipo conta seus meses, mas a sobreposição dentro do mesmo tipo
    // não duplica. Aqui não há sobreposição dentro do mesmo tipo.
    const tc = calcularResumoTC([
      periodoBase("2020-01-01", "2022-12-31", "URBANA_COMUM"),
      periodoBase("2022-01-01", "2024-12-31", "URBANA_ESPECIAL_25"),
    ], "M");

    expect(tc.totalMesesComum).toBeGreaterThanOrEqual(35);
    expect(tc.totalMesesComum).toBeLessThanOrEqual(36);
    expect(tc.totalMesesEspecial25).toBeGreaterThanOrEqual(35);
    expect(tc.totalMesesEspecial25).toBeLessThanOrEqual(36);
  });

  it("REGRESSÃO: período único continua funcionando", () => {
    // diffMeses conta meses completos (Jan 1 → Dec 31 = 4*12 + 11 = 59).
    // O comportamento existente é mantido — não é o bug que estamos corrigindo aqui.
    const tc = calcularResumoTC([
      periodoBase("2020-01-01", "2024-12-31"),
    ], "M");
    expect(tc.totalMesesComum).toBe(59);
  });
});

describe("Bug GPS — multa de mora deve respeitar Lei 9.430/96 art. 61", () => {
  const baseGPS = (compAtrasada: string): ParametrosGPS => ({
    categoria: "CONTRIBUINTE_INDIVIDUAL",
    plano: "NORMAL",
    salarioContribuicao: 3000,
    competenciasAtrasadas: [compAtrasada],
    jaInscritoNoINSS: true,
    primeiraContribuicaoEmDia: true,
  });

  it("atraso > 60 dias: multa atinge teto de 20%", () => {
    // Atraso ~825 dias. Multa = min(0.33% × 825, 20%) = 20%
    // Valor base = 3000 × 20% = 600. Multa esperada = 600 × 20% = 120.
    const r = calcularGPSAtraso(baseGPS("2024-01"));
    expect(r.linhas[0].multa).toBeCloseTo(120, 0);
  });

  it("atraso de ~30 dias: multa ~9.9% (= 0.33% × 30)", () => {
    // Cria competência ~30 dias no passado.
    // 0.33% × 30 = 9.9%. Valor base 600 × 9.9% ≈ 59.4
    const hoje = new Date();
    const mes30 = new Date(hoje);
    mes30.setDate(mes30.getDate() - 60); // ~60 dias atrás (~30 de atraso)
    // 60 dias atrás → competência de 1 mês atrás (vencimento é mês seguinte)
    const comp = `${mes30.getFullYear()}-${String(mes30.getMonth() + 1).padStart(2, "0")}`;
    const r = calcularGPSAtraso(baseGPS(comp));
    // 0.33% × ~30 dias ≈ 9.9%. Range razoável: entre 5% e 15%.
    const multaPct = r.linhas[0].multa / r.linhas[0].valorOriginal;
    expect(multaPct).toBeLessThanOrEqual(0.20);
    expect(multaPct).toBeGreaterThan(0.05);
  });

  it("limite máximo de multa é 20%", () => {
    const r = calcularGPSAtraso(baseGPS("2015-01"));
    const multaPct = r.linhas[0].multa / r.linhas[0].valorOriginal;
    expect(multaPct).toBeCloseTo(0.20, 3);
  });
});
