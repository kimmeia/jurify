/**
 * Testes do Router Imobiliário e Gerador de Parecer
 */
import { describe, it, expect } from "vitest";
import { gerarParecerImobiliario } from "./parecer-imobiliario";
import { calcularRevisaoImobiliario, round2 } from "./engine-imobiliario";
import type { ParametrosImobiliario, AnaliseAbusividadeImob, ResumoComparativoImob } from "../../shared/imobiliario-types";

// ─── Parecer Técnico ─────────────────────────────────────────────────────────

describe("Parecer Técnico Imobiliário", () => {
  const baseParams: ParametrosImobiliario = {
    valorImovel: 400000,
    valorFinanciado: 300000,
    taxaJurosAnual: 9.0,
    prazoMeses: 360,
    dataContrato: "2020-01-15",
    dataPrimeiroVencimento: "2020-02-15",
    sistemaAmortizacao: "SAC",
    indexador: "TR",
    taxaIndexadorAnual: 1.0,
    idadeComprador: 35,
  };

  it("gera parecer com todas as seções obrigatórias", () => {
    const resultado = calcularRevisaoImobiliario(baseParams, 7.5);
    const parecer = gerarParecerImobiliario(
      baseParams,
      resultado.analiseAbusividade,
      resultado.resumo,
      resultado.taxaRecalculoAplicada,
      resultado.criterioRecalculo,
      resultado.protocoloCalculo,
      resultado.dadosParcelasPagas,
    );

    expect(parecer).toContain("PARECER TÉCNICO");
    expect(parecer).toContain("DADOS DO CONTRATO");
    expect(parecer).toContain("SEGUROS OBRIGATÓRIOS");
    expect(parecer).toContain("ANÁLISE DE TAXAS");
    expect(parecer).toContain("RESUMO COMPARATIVO");
    expect(parecer).toContain("CONCLUSÃO");
    expect(parecer).toContain("R$");
    expect(parecer).toContain("SAC");
    expect(parecer).toContain("TR");
  });

  it("inclui protocolo quando fornecido", () => {
    const resultado = calcularRevisaoImobiliario(baseParams, 7.5);
    const parecer = gerarParecerImobiliario(
      baseParams,
      resultado.analiseAbusividade,
      resultado.resumo,
      resultado.taxaRecalculoAplicada,
      resultado.criterioRecalculo,
      "IMOB-2020-001",
    );
    expect(parecer).toContain("IMOB-2020-001");
  });

  it("inclui seção de parcelas pagas quando dados fornecidos", () => {
    const paramsComPagas = { ...baseParams, parcelasJaPagas: 24 };
    const resultado = calcularRevisaoImobiliario(paramsComPagas, 7.5);
    const parecer = gerarParecerImobiliario(
      paramsComPagas,
      resultado.analiseAbusividade,
      resultado.resumo,
      resultado.taxaRecalculoAplicada,
      resultado.criterioRecalculo,
      resultado.protocoloCalculo,
      resultado.dadosParcelasPagas,
    );
    expect(parecer).toContain("PARCELAS PAGAS");
    expect(parecer).toContain("24");
  });

  it("gera parecer para PRICE com IPCA", () => {
    const priceParams = {
      ...baseParams,
      sistemaAmortizacao: "PRICE" as const,
      indexador: "IPCA" as const,
      taxaIndexadorAnual: 4.5,
    };
    const resultado = calcularRevisaoImobiliario(priceParams, 7.5);
    const parecer = gerarParecerImobiliario(
      priceParams,
      resultado.analiseAbusividade,
      resultado.resumo,
      resultado.taxaRecalculoAplicada,
      resultado.criterioRecalculo,
    );
    expect(parecer).toContain("Price");
    expect(parecer).toContain("IPCA");
  });

  it("detecta irregularidades quando taxa é abusiva", () => {
    const abusivoParams = { ...baseParams, taxaJurosAnual: 18.0 };
    const resultado = calcularRevisaoImobiliario(abusivoParams, 7.5);
    const parecer = gerarParecerImobiliario(
      abusivoParams,
      resultado.analiseAbusividade,
      resultado.resumo,
      resultado.taxaRecalculoAplicada,
      resultado.criterioRecalculo,
    );
    expect(parecer).toContain("IRREGULARIDADES");
    expect(resultado.analiseAbusividade.taxaAbusiva).toBe(true);
  });

  it("formata valores monetários corretamente", () => {
    const resultado = calcularRevisaoImobiliario(baseParams, 7.5);
    const parecer = gerarParecerImobiliario(
      baseParams,
      resultado.analiseAbusividade,
      resultado.resumo,
      resultado.taxaRecalculoAplicada,
      resultado.criterioRecalculo,
    );
    // Deve conter valores formatados em BRL
    expect(parecer).toMatch(/R\$\s*[\d.,]+/);
  });
});

// ─── Integração Engine + Parecer ─────────────────────────────────────────────

describe("Integração Engine + Parecer", () => {
  it("SAC com TR gera resultado e parecer consistentes", () => {
    const params: ParametrosImobiliario = {
      valorImovel: 500000,
      valorFinanciado: 350000,
      taxaJurosAnual: 8.5,
      prazoMeses: 300,
      dataContrato: "2021-06-01",
      dataPrimeiroVencimento: "2021-07-01",
      sistemaAmortizacao: "SAC",
      indexador: "TR",
      taxaIndexadorAnual: 0.5,
      idadeComprador: 40,
    };
    const resultado = calcularRevisaoImobiliario(params, 7.0);
    expect(resultado.demonstrativoOriginal).toHaveLength(300);
    expect(resultado.demonstrativoRecalculado).toHaveLength(300);
    expect(resultado.resumo.totalPagoOriginal).toBeGreaterThan(0);
    expect(resultado.resumo.totalPagoRecalculado).toBeGreaterThan(0);
    // Taxa original > recálculo, então diferença deve ser positiva
    expect(resultado.resumo.diferencaTotal).toBeGreaterThan(0);

    const parecer = gerarParecerImobiliario(
      params,
      resultado.analiseAbusividade,
      resultado.resumo,
      resultado.taxaRecalculoAplicada,
      resultado.criterioRecalculo,
    );
    expect(parecer.length).toBeGreaterThan(500);
  });

  it("PRICE com IGPM gera resultado e parecer consistentes", () => {
    const params: ParametrosImobiliario = {
      valorImovel: 300000,
      valorFinanciado: 240000,
      taxaJurosAnual: 10.0,
      prazoMeses: 240,
      dataContrato: "2019-03-01",
      dataPrimeiroVencimento: "2019-04-01",
      sistemaAmortizacao: "PRICE",
      indexador: "IGPM",
      taxaIndexadorAnual: 6.0,
      idadeComprador: 45,
    };
    const resultado = calcularRevisaoImobiliario(params, 7.0);
    expect(resultado.demonstrativoOriginal).toHaveLength(240);
    expect(resultado.demonstrativoRecalculado).toHaveLength(240);
    expect(resultado.analiseAbusividade).toBeDefined();
    expect(resultado.analiseAbusividade.indexadorDetalhes).toContain("IGPM");

    const parecer = gerarParecerImobiliario(
      params,
      resultado.analiseAbusividade,
      resultado.resumo,
      resultado.taxaRecalculoAplicada,
      resultado.criterioRecalculo,
    );
    expect(parecer).toContain("IGPM");
  });

  it("resultado com parcelas pagas inclui dados de recálculo", () => {
    const params: ParametrosImobiliario = {
      valorImovel: 400000,
      valorFinanciado: 300000,
      taxaJurosAnual: 9.0,
      prazoMeses: 360,
      dataContrato: "2020-01-15",
      dataPrimeiroVencimento: "2020-02-15",
      sistemaAmortizacao: "SAC",
      indexador: "TR",
      taxaIndexadorAnual: 1.0,
      idadeComprador: 35,
      parcelasJaPagas: 48,
    };
    const resultado = calcularRevisaoImobiliario(params, 7.5);
    expect(resultado.dadosParcelasPagas).toBeDefined();
    expect(resultado.dadosParcelasPagas!.parcelasPagas).toBe(48);
    expect(resultado.dadosParcelasPagas!.parcelasRestantes).toBe(312);
    expect(resultado.dadosParcelasPagas!.valorPagoAMais).toBeGreaterThanOrEqual(0);
  });

  it("taxa manual de recálculo é aplicada corretamente", () => {
    const params: ParametrosImobiliario = {
      valorImovel: 400000,
      valorFinanciado: 300000,
      taxaJurosAnual: 9.0,
      prazoMeses: 360,
      dataContrato: "2020-01-15",
      dataPrimeiroVencimento: "2020-02-15",
      sistemaAmortizacao: "SAC",
      indexador: "TR",
      taxaIndexadorAnual: 1.0,
      idadeComprador: 35,
      taxaRecalculo: "manual",
      taxaManualAnual: 6.0,
    };
    const resultado = calcularRevisaoImobiliario(params, 7.5);
    expect(resultado.taxaRecalculoAplicada).toBe(6.0);
    expect(resultado.criterioRecalculo).toContain("manual");
  });

  it("sem correção (NENHUM) gera resultado válido", () => {
    const params: ParametrosImobiliario = {
      valorImovel: 200000,
      valorFinanciado: 150000,
      taxaJurosAnual: 7.5,
      prazoMeses: 180,
      dataContrato: "2022-01-01",
      dataPrimeiroVencimento: "2022-02-01",
      sistemaAmortizacao: "PRICE",
      indexador: "NENHUM",
      taxaIndexadorAnual: 0,
      idadeComprador: 30,
    };
    const resultado = calcularRevisaoImobiliario(params, 7.0);
    expect(resultado.demonstrativoOriginal).toHaveLength(180);
    // Sem correção, total de correção deve ser 0
    expect(resultado.resumo.totalCorrecaoOriginal).toBe(0);
  });
});
