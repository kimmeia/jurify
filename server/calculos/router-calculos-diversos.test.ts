/**
 * Testes do Router de Cálculos Diversos
 */
import { describe, it, expect } from "vitest";
import {
  converterTaxa,
  calcularTaxaReal,
  calcularJuros,
  calcularPrazoPrescricional,
  PRAZOS_PRESCRICIONAIS,
} from "./engine-calculos-diversos";

describe("Router Cálculos Diversos - Conversão de Taxas", () => {
  it("converte taxa efetiva mensal para anual corretamente", () => {
    const resultado = converterTaxa({
      taxaOriginal: 1,
      periodoOrigem: "mensal",
      periodoDestino: "anual",
      tipoOrigem: "efetiva",
      tipoDestino: "efetiva",
      baseDias: "corridos",
    });
    expect(resultado.taxaConvertida).toBeCloseTo(12.6825, 3);
    expect(resultado.periodoOrigem).toBe("mensal");
    expect(resultado.periodoDestino).toBe("anual");
  });

  it("converte taxa nominal anual para efetiva mensal", () => {
    const resultado = converterTaxa({
      taxaOriginal: 12,
      periodoOrigem: "anual",
      periodoDestino: "mensal",
      tipoOrigem: "nominal",
      tipoDestino: "efetiva",
      baseDias: "corridos",
      capitalizacaoNominal: "mensal",
    });
    expect(resultado.taxaConvertida).toBeCloseTo(1, 2);
  });

  it("retorna detalhamento com passos do cálculo", () => {
    const resultado = converterTaxa({
      taxaOriginal: 2,
      periodoOrigem: "mensal",
      periodoDestino: "anual",
      tipoOrigem: "efetiva",
      tipoDestino: "efetiva",
      baseDias: "corridos",
    });
    expect(resultado.detalhamento).toContain("Taxa original");
    expect(resultado.detalhamento).toContain("Taxa convertida");
    expect(resultado.detalhamento).toContain("Passos do cálculo");
  });
});

describe("Router Cálculos Diversos - Taxa Real (Fisher)", () => {
  it("calcula taxa real com inflação positiva", () => {
    const resultado = calcularTaxaReal({ taxaNominal: 13.75, inflacao: 4.62 });
    // (1.1375 / 1.0462) - 1 ≈ 8.73%
    expect(resultado.taxaReal).toBeCloseTo(8.73, 1);
    expect(resultado.taxaReal).toBeGreaterThan(0);
  });

  it("taxa real negativa quando inflação supera nominal", () => {
    const resultado = calcularTaxaReal({ taxaNominal: 3, inflacao: 8 });
    expect(resultado.taxaReal).toBeLessThan(0);
  });
});

describe("Router Cálculos Diversos - Juros", () => {
  it("juros simples: C=10000, i=1% a.m., n=12", () => {
    const resultado = calcularJuros({
      capital: 10000,
      taxa: 1,
      periodoTaxa: "mensal",
      prazo: 12,
      periodoPrazo: "mensal",
      tipo: "simples",
    });
    expect(resultado.juros).toBe(1200);
    expect(resultado.montante).toBe(11200);
    expect(resultado.evolucaoMensal).toHaveLength(12);
  });

  it("juros compostos: C=10000, i=1% a.m., n=12", () => {
    const resultado = calcularJuros({
      capital: 10000,
      taxa: 1,
      periodoTaxa: "mensal",
      prazo: 12,
      periodoPrazo: "mensal",
      tipo: "composto",
    });
    expect(resultado.montante).toBeCloseTo(11268.25, 0);
    expect(resultado.juros).toBeCloseTo(1268.25, 0);
  });

  it("fórmula é incluída no resultado", () => {
    const resultado = calcularJuros({
      capital: 5000,
      taxa: 2,
      periodoTaxa: "mensal",
      prazo: 6,
      periodoPrazo: "mensal",
      tipo: "composto",
    });
    expect(resultado.formulaAplicada).toContain("M = C");
  });
});

describe("Router Cálculos Diversos - Prazos Prescricionais", () => {
  it("lista prazos por área", () => {
    const civis = PRAZOS_PRESCRICIONAIS.filter(p => p.area === "civil");
    expect(civis.length).toBeGreaterThan(5);
    civis.forEach(p => {
      expect(p.fundamentacao).toBeTruthy();
      expect(p.descricao).toBeTruthy();
    });
  });

  it("calcula prescrição não prescrita", () => {
    const umAnoAtras = new Date();
    umAnoAtras.setFullYear(umAnoAtras.getFullYear() - 1);
    const resultado = calcularPrazoPrescricional({
      area: "civil",
      tipoAcao: "civil_10_geral",
      dataFatoGerador: umAnoAtras.toISOString().split("T")[0],
    });
    expect(resultado.prescrito).toBe(false);
    expect(resultado.diasRestantes).toBeGreaterThan(0);
  });

  it("calcula prescrição prescrita", () => {
    const resultado = calcularPrazoPrescricional({
      area: "trabalhista",
      tipoAcao: "trab_2_bienal",
      dataFatoGerador: "2020-01-01",
    });
    expect(resultado.prescrito).toBe(true);
    expect(resultado.diasRestantes).toBeLessThan(0);
  });

  it("suspensão adia a data de prescrição", () => {
    const tresAnosAtras = new Date();
    tresAnosAtras.setFullYear(tresAnosAtras.getFullYear() - 3);
    const dataFato = tresAnosAtras.toISOString().split("T")[0];

    const sem = calcularPrazoPrescricional({
      area: "civil",
      tipoAcao: "civil_3_reparacao",
      dataFatoGerador: dataFato,
    });

    const com = calcularPrazoPrescricional({
      area: "civil",
      tipoAcao: "civil_3_reparacao",
      dataFatoGerador: dataFato,
      suspensoes: [{ inicio: "2024-01-01", fim: "2025-01-01" }],
    });

    expect(com.diasRestantes).toBeGreaterThan(sem.diasRestantes);
  });
});
