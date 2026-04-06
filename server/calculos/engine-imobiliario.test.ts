/**
 * Testes do Engine de Cálculo Imobiliário
 *
 * Cobertura:
 * - Utilitários (round, addMonths, conversão de taxas)
 * - MIP e DFI
 * - SAC com e sem correção monetária
 * - PRICE com e sem correção monetária
 * - Análise de abusividade
 * - Resumo comparativo
 * - Validação de datas
 * - Função principal calcularRevisaoImobiliario
 */

import { describe, it, expect } from "vitest";
import {
  round2, round4, round8,
  addMonths,
  anualParaMensal, mensalParaAnual, anualParaMensalLinear,
  obterTaxaMIP, calcularMIP, calcularDFI,
  validarDatasImob,
  calcularSACImob, calcularPRICEImob,
  analisarAbusividade,
  calcularResumo,
  calcularDadosParcelasPagas,
  calcularRevisaoImobiliario,
  gerarProtocolo,
} from "./engine-imobiliario";
import type { ParametrosImobiliario, LinhaImobiliario } from "../../shared/imobiliario-types";
import { TABELA_MIP_REFERENCIA, TAXA_DFI_REFERENCIA } from "../../shared/imobiliario-types";

// ─── Utilitários ─────────────────────────────────────────────────────────────

describe("Utilitários", () => {
  it("round2 arredonda para 2 casas decimais", () => {
    // 1.005 em JS float é 1.00499... por isso round2 dá 1.00 (comportamento correto do toFixed)
    expect(round2(1.005)).toBe(1); // toFixed(2) de 1.005 = "1.00" em JS
    expect(round2(1.006)).toBe(1.01);
    expect(round2(1.004)).toBe(1);
    expect(round2(100.999)).toBe(101);
  });

  it("round4 arredonda para 4 casas decimais", () => {
    expect(round4(0.72073)).toBe(0.7207);
  });

  it("round8 arredonda para 8 casas decimais", () => {
    expect(round8(0.123456789)).toBe(0.12345679);
  });

  it("addMonths calcula datas corretamente", () => {
    expect(addMonths("2024-01-15", 1)).toBe("2024-02-15");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // 2024 é bissexto
    expect(addMonths("2023-01-31", 1)).toBe("2023-02-28"); // 2023 não é bissexto
    expect(addMonths("2024-12-15", 1)).toBe("2025-01-15");
    expect(addMonths("2024-01-15", 12)).toBe("2025-01-15");
    expect(addMonths("2024-01-15", 360)).toBe("2054-01-15");
  });

  it("anualParaMensal converte corretamente (juros compostos)", () => {
    // 12% a.a. → ~0.9489% a.m.
    const mensal = anualParaMensal(12);
    expect(mensal).toBeGreaterThan(0.94);
    expect(mensal).toBeLessThan(0.96);
    // Verificação reversa
    const anual = mensalParaAnual(mensal);
    expect(Math.abs(anual - 12)).toBeLessThan(0.01);
  });

  it("9% a.a. → ~0.7207% a.m.", () => {
    const mensal = anualParaMensal(9);
    expect(mensal).toBeGreaterThan(0.72);
    expect(mensal).toBeLessThan(0.73);
  });

  it("anualParaMensalLinear converte corretamente para indexadores", () => {
    // TR 1.5% a.a. → ~0.1241% a.m. (composto)
    const mensal = anualParaMensalLinear(1.5);
    expect(mensal).toBeGreaterThan(0.12);
    expect(mensal).toBeLessThan(0.13);
  });

  it("gerarProtocolo gera formato correto", () => {
    const p = gerarProtocolo();
    expect(p).toMatch(/^IMOB-\d{14}-[A-Z0-9]{6}$/);
  });
});

// ─── MIP e DFI ───────────────────────────────────────────────────────────────

describe("MIP e DFI", () => {
  it("obterTaxaMIP retorna taxa correta por faixa etária", () => {
    expect(obterTaxaMIP(20)).toBe(TABELA_MIP_REFERENCIA[0].taxa); // 18-25
    expect(obterTaxaMIP(30)).toBe(TABELA_MIP_REFERENCIA[1].taxa); // 26-30
    expect(obterTaxaMIP(35)).toBe(TABELA_MIP_REFERENCIA[2].taxa); // 31-35
    expect(obterTaxaMIP(40)).toBe(TABELA_MIP_REFERENCIA[3].taxa); // 36-40
    expect(obterTaxaMIP(50)).toBe(TABELA_MIP_REFERENCIA[5].taxa); // 46-50
    expect(obterTaxaMIP(65)).toBe(TABELA_MIP_REFERENCIA[8].taxa); // 61-65
    expect(obterTaxaMIP(70)).toBe(TABELA_MIP_REFERENCIA[9].taxa); // 66-80
  });

  it("obterTaxaMIP retorna faixa mais próxima para idades fora da tabela", () => {
    expect(obterTaxaMIP(15)).toBe(TABELA_MIP_REFERENCIA[0].taxa);
    expect(obterTaxaMIP(85)).toBe(TABELA_MIP_REFERENCIA[TABELA_MIP_REFERENCIA.length - 1].taxa);
  });

  it("calcularMIP calcula corretamente", () => {
    // Saldo de R$ 300.000, taxa 0.022866%
    const mip = calcularMIP(300000, 0.022866);
    expect(mip).toBe(round2(300000 * 0.022866 / 100));
    expect(mip).toBeGreaterThan(60);
    expect(mip).toBeLessThan(70);
  });

  it("calcularDFI calcula corretamente", () => {
    // Valor imóvel R$ 400.000, taxa 0.004684%
    const dfi = calcularDFI(400000, TAXA_DFI_REFERENCIA);
    expect(dfi).toBe(round2(400000 * TAXA_DFI_REFERENCIA / 100));
    expect(dfi).toBeGreaterThan(15);
    expect(dfi).toBeLessThan(25);
  });
});

// ─── Validação de Datas ──────────────────────────────────────────────────────

describe("Validação de Datas", () => {
  const baseParams: ParametrosImobiliario = {
    valorImovel: 400000,
    valorFinanciado: 300000,
    taxaJurosAnual: 9,
    prazoMeses: 360,
    dataContrato: "2020-01-15",
    dataPrimeiroVencimento: "2020-02-15",
    sistemaAmortizacao: "SAC",
    indexador: "TR",
    taxaIndexadorAnual: 1.5,
    idadeComprador: 35,
  };

  it("aceita parâmetros válidos", () => {
    const erros = validarDatasImob(baseParams);
    expect(erros).toHaveLength(0);
  });

  it("rejeita data do contrato futura", () => {
    const erros = validarDatasImob({ ...baseParams, dataContrato: "2030-01-15" });
    expect(erros.length).toBeGreaterThan(0);
    expect(erros[0]).toContain("futura");
  });

  it("rejeita primeiro vencimento anterior ao contrato", () => {
    const erros = validarDatasImob({ ...baseParams, dataPrimeiroVencimento: "2019-12-15" });
    expect(erros.length).toBeGreaterThan(0);
    expect(erros[0]).toContain("anterior");
  });

  it("rejeita prazo fora do intervalo", () => {
    const erros = validarDatasImob({ ...baseParams, prazoMeses: 0 });
    expect(erros.length).toBeGreaterThan(0);
  });

  it("rejeita valor financiado maior que valor do imóvel", () => {
    const erros = validarDatasImob({ ...baseParams, valorFinanciado: 500000 });
    expect(erros.length).toBeGreaterThan(0);
    expect(erros[0]).toContain("superior");
  });

  it("rejeita idade fora do intervalo", () => {
    const erros = validarDatasImob({ ...baseParams, idadeComprador: 15 });
    expect(erros.length).toBeGreaterThan(0);
  });
});

// ─── SAC sem correção monetária ──────────────────────────────────────────────

describe("SAC sem correção monetária", () => {
  const linhas = calcularSACImob(
    300000,   // valor financiado
    0.7207,   // taxa juros mensal (~9% a.a.)
    360,      // prazo
    "2020-02-15",
    0,        // sem correção
    0.022866, // MIP
    TAXA_DFI_REFERENCIA,
    400000,   // valor imóvel
    25,       // tx admin
  );

  it("gera 360 linhas", () => {
    expect(linhas).toHaveLength(360);
  });

  it("primeira parcela tem saldo devedor anterior = valor financiado", () => {
    expect(linhas[0].saldoDevedorAnterior).toBe(300000);
  });

  it("sem correção monetária, correcaoMonetaria é 0", () => {
    expect(linhas[0].correcaoMonetaria).toBe(0);
    expect(linhas[0].saldoDevedorCorrigido).toBe(300000);
  });

  it("amortização é constante (SAC)", () => {
    const amortBase = round2(300000 / 360);
    expect(linhas[0].amortizacao).toBe(amortBase);
    expect(linhas[1].amortizacao).toBe(amortBase);
    expect(linhas[100].amortizacao).toBe(amortBase);
  });

  it("juros decrescem ao longo do tempo", () => {
    expect(linhas[0].juros).toBeGreaterThan(linhas[100].juros);
    expect(linhas[100].juros).toBeGreaterThan(linhas[300].juros);
  });

  it("prestação total decresce ao longo do tempo (SAC)", () => {
    expect(linhas[0].prestacaoTotal).toBeGreaterThan(linhas[100].prestacaoTotal);
  });

  it("última parcela zera o saldo devedor", () => {
    expect(linhas[359].saldoDevedorAtual).toBe(0);
  });

  it("MIP decresce com o saldo devedor", () => {
    expect(linhas[0].mip).toBeGreaterThan(linhas[300].mip);
  });

  it("DFI é constante (baseado no valor do imóvel)", () => {
    expect(linhas[0].dfi).toBe(linhas[100].dfi);
    expect(linhas[0].dfi).toBe(linhas[359].dfi);
  });

  it("taxa de administração é constante", () => {
    expect(linhas[0].taxaAdministracao).toBe(25);
    expect(linhas[359].taxaAdministracao).toBe(25);
  });

  it("prestação = amort + juros + mip + dfi + txAdmin", () => {
    for (const l of [linhas[0], linhas[50], linhas[200], linhas[359]]) {
      const soma = round2(l.amortizacao + l.juros + l.mip + l.dfi + l.taxaAdministracao);
      expect(Math.abs(l.prestacaoTotal - soma)).toBeLessThan(0.02);
    }
  });

  it("saldo devedor nunca fica negativo", () => {
    for (const l of linhas) {
      expect(l.saldoDevedorAtual).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── SAC com correção monetária (TR) ─────────────────────────────────────────

describe("SAC com correção monetária (TR)", () => {
  const taxaTRMensal = anualParaMensalLinear(1.5); // ~0.1241%
  const linhas = calcularSACImob(
    300000, 0.7207, 360, "2020-02-15",
    taxaTRMensal, 0.022866, TAXA_DFI_REFERENCIA, 400000, 25,
  );

  it("gera 360 linhas", () => {
    expect(linhas).toHaveLength(360);
  });

  it("correção monetária é positiva", () => {
    expect(linhas[0].correcaoMonetaria).toBeGreaterThan(0);
  });

  it("saldo corrigido = anterior + correção", () => {
    for (const l of [linhas[0], linhas[50], linhas[200]]) {
      expect(Math.abs(l.saldoDevedorCorrigido - (l.saldoDevedorAnterior + l.correcaoMonetaria))).toBeLessThan(0.02);
    }
  });

  it("com correção, prestação inicial é maior que sem correção", () => {
    const semCorrecao = calcularSACImob(300000, 0.7207, 360, "2020-02-15", 0, 0.022866, TAXA_DFI_REFERENCIA, 400000, 25);
    expect(linhas[0].prestacaoTotal).toBeGreaterThan(semCorrecao[0].prestacaoTotal);
  });

  it("última parcela zera o saldo devedor", () => {
    expect(linhas[359].saldoDevedorAtual).toBe(0);
  });
});

// ─── PRICE sem correção monetária ────────────────────────────────────────────

describe("PRICE sem correção monetária", () => {
  const linhas = calcularPRICEImob(
    300000, 0.7207, 360, "2020-02-15",
    0, 0.022866, TAXA_DFI_REFERENCIA, 400000, 25,
  );

  it("gera 360 linhas", () => {
    expect(linhas).toHaveLength(360);
  });

  it("PMT (amort+juros) é constante na PRICE sem correção", () => {
    const pmt1 = round2(linhas[0].amortizacao + linhas[0].juros);
    const pmt50 = round2(linhas[49].amortizacao + linhas[49].juros);
    const pmt200 = round2(linhas[199].amortizacao + linhas[199].juros);
    // Tolerância de R$ 1 por arredondamentos
    expect(Math.abs(pmt1 - pmt50)).toBeLessThan(1);
    expect(Math.abs(pmt1 - pmt200)).toBeLessThan(1);
  });

  it("amortização cresce ao longo do tempo (PRICE)", () => {
    expect(linhas[100].amortizacao).toBeGreaterThan(linhas[0].amortizacao);
    expect(linhas[300].amortizacao).toBeGreaterThan(linhas[100].amortizacao);
  });

  it("juros decrescem ao longo do tempo", () => {
    expect(linhas[0].juros).toBeGreaterThan(linhas[100].juros);
  });

  it("última parcela zera o saldo devedor", () => {
    expect(linhas[359].saldoDevedorAtual).toBe(0);
  });

  it("total pago PRICE > total pago SAC (mesmo prazo e taxa)", () => {
    const linhasSAC = calcularSACImob(300000, 0.7207, 360, "2020-02-15", 0, 0.022866, TAXA_DFI_REFERENCIA, 400000, 25);
    const totalPrice = linhas.reduce((s, l) => s + l.prestacaoTotal, 0);
    const totalSAC = linhasSAC.reduce((s, l) => s + l.prestacaoTotal, 0);
    expect(totalPrice).toBeGreaterThan(totalSAC);
  });
});

// ─── PRICE com correção monetária ────────────────────────────────────────────

describe("PRICE com correção monetária (IPCA)", () => {
  const taxaIPCAMensal = anualParaMensalLinear(4.5); // ~0.367%
  const linhas = calcularPRICEImob(
    300000, 0.7207, 360, "2020-02-15",
    taxaIPCAMensal, 0.022866, TAXA_DFI_REFERENCIA, 400000, 25,
  );

  it("gera 360 linhas", () => {
    expect(linhas).toHaveLength(360);
  });

  it("correção monetária é positiva", () => {
    expect(linhas[0].correcaoMonetaria).toBeGreaterThan(0);
  });

  it("com IPCA, total pago é maior que sem correção", () => {
    const semCorrecao = calcularPRICEImob(300000, 0.7207, 360, "2020-02-15", 0, 0.022866, TAXA_DFI_REFERENCIA, 400000, 25);
    const totalComIPCA = linhas.reduce((s, l) => s + l.prestacaoTotal, 0);
    const totalSem = semCorrecao.reduce((s, l) => s + l.prestacaoTotal, 0);
    expect(totalComIPCA).toBeGreaterThan(totalSem);
  });

  it("última parcela zera o saldo devedor", () => {
    expect(linhas[359].saldoDevedorAtual).toBe(0);
  });
});

// ─── Análise de Abusividade ──────────────────────────────────────────────────

describe("Análise de Abusividade", () => {
  const baseParams: ParametrosImobiliario = {
    valorImovel: 400000,
    valorFinanciado: 300000,
    taxaJurosAnual: 9,
    prazoMeses: 360,
    dataContrato: "2020-01-15",
    dataPrimeiroVencimento: "2020-02-15",
    sistemaAmortizacao: "SAC",
    indexador: "TR",
    taxaIndexadorAnual: 1.5,
    idadeComprador: 35,
  };

  it("taxa não abusiva quando próxima da média BACEN", () => {
    const analise = analisarAbusividade(baseParams, 8.5);
    expect(analise.taxaAbusiva).toBe(false);
    expect(analise.irregularidades).toHaveLength(0);
  });

  it("taxa abusiva quando muito acima da média BACEN", () => {
    const analise = analisarAbusividade({ ...baseParams, taxaJurosAnual: 18 }, 8.5);
    expect(analise.taxaAbusiva).toBe(true);
    expect(analise.percentualAcimaDaMedia).toBeGreaterThan(50);
    expect(analise.irregularidades.length).toBeGreaterThan(0);
  });

  it("detecta anatocismo na PRICE", () => {
    const analise = analisarAbusividade({ ...baseParams, sistemaAmortizacao: "PRICE" }, 8.5);
    expect(analise.anatocismoDetectado).toBe(true);
    expect(analise.anatocismoDetalhes).toContain("capitalização composta");
  });

  it("não detecta anatocismo no SAC", () => {
    const analise = analisarAbusividade(baseParams, 8.5);
    expect(analise.anatocismoDetectado).toBe(false);
  });

  it("detecta MIP abusivo quando taxa é muito alta", () => {
    const analise = analisarAbusividade({ ...baseParams, taxaMIP: 0.1 }, 8.5);
    expect(analise.mipAbusivo).toBe(true);
  });

  it("detecta DFI abusivo quando taxa é muito alta", () => {
    const analise = analisarAbusividade({ ...baseParams, taxaDFI: 0.05 }, 8.5);
    expect(analise.dfiAbusivo).toBe(true);
  });

  it("detecta taxa de administração abusiva", () => {
    const analise = analisarAbusividade({ ...baseParams, taxaAdministracao: 100 }, 8.5);
    expect(analise.taxaAdminAbusiva).toBe(true);
  });

  it("detecta indexador irregular (IGPM alto)", () => {
    const analise = analisarAbusividade({ ...baseParams, indexador: "IGPM", taxaIndexadorAnual: 20 }, 8.5);
    expect(analise.indexadorIrregular).toBe(true);
  });
});

// ─── Resumo Comparativo ──────────────────────────────────────────────────────

describe("Resumo Comparativo", () => {
  const params: ParametrosImobiliario = {
    valorImovel: 400000,
    valorFinanciado: 300000,
    taxaJurosAnual: 9,
    prazoMeses: 12,
    dataContrato: "2020-01-15",
    dataPrimeiroVencimento: "2020-02-15",
    sistemaAmortizacao: "SAC",
    indexador: "NENHUM",
    taxaIndexadorAnual: 0,
    idadeComprador: 35,
  };

  const original = calcularSACImob(300000, anualParaMensal(9), 12, "2020-02-15", 0, 0.022866, TAXA_DFI_REFERENCIA, 400000, 25);
  const recalculado = calcularSACImob(300000, anualParaMensal(7), 12, "2020-02-15", 0, 0.022866, TAXA_DFI_REFERENCIA, 400000, 25);

  it("calcula diferença total positiva quando original é mais caro", () => {
    const resumo = calcularResumo(original, recalculado, params);
    expect(resumo.diferencaTotal).toBeGreaterThan(0);
    expect(resumo.diferencaJuros).toBeGreaterThan(0);
  });

  it("repetição de indébito é o dobro da diferença", () => {
    const resumo = calcularResumo(original, recalculado, params);
    expect(resumo.repeticaoIndebito).toBe(round2(resumo.diferencaTotal * 2));
  });

  it("valores do resumo são coerentes", () => {
    const resumo = calcularResumo(original, recalculado, params);
    expect(resumo.valorFinanciado).toBe(300000);
    expect(resumo.valorImovel).toBe(400000);
    expect(resumo.totalPagoOriginal).toBeGreaterThan(0);
    expect(resumo.totalPagoRecalculado).toBeGreaterThan(0);
  });
});

// ─── Dados de Parcelas Pagas ─────────────────────────────────────────────────

describe("Dados de Parcelas Pagas", () => {
  const original = calcularSACImob(300000, anualParaMensal(9), 12, "2020-02-15", 0, 0.022866, TAXA_DFI_REFERENCIA, 400000, 25);
  const recalculado = calcularSACImob(300000, anualParaMensal(7), 12, "2020-02-15", 0, 0.022866, TAXA_DFI_REFERENCIA, 400000, 25);

  it("calcula corretamente com 6 parcelas pagas", () => {
    const dados = calcularDadosParcelasPagas(original, recalculado, 6);
    expect(dados.parcelasPagas).toBe(6);
    expect(dados.parcelasRestantes).toBe(6);
    expect(dados.valorPagoTotal).toBeGreaterThan(0);
    expect(dados.valorDevidoRecalculado).toBeGreaterThan(0);
    expect(dados.valorPagoAMais).toBeGreaterThan(0); // pagou mais no original
  });
});

// ─── Função Principal ────────────────────────────────────────────────────────

describe("calcularRevisaoImobiliario", () => {
  const params: ParametrosImobiliario = {
    valorImovel: 400000,
    valorFinanciado: 300000,
    taxaJurosAnual: 9,
    prazoMeses: 360,
    dataContrato: "2020-01-15",
    dataPrimeiroVencimento: "2020-02-15",
    sistemaAmortizacao: "SAC",
    indexador: "TR",
    taxaIndexadorAnual: 1.5,
    idadeComprador: 35,
  };

  it("retorna resultado completo com SAC + TR", () => {
    const resultado = calcularRevisaoImobiliario(params, 8.5);
    expect(resultado.demonstrativoOriginal).toHaveLength(360);
    expect(resultado.demonstrativoRecalculado).toHaveLength(360);
    expect(resultado.protocoloCalculo).toMatch(/^IMOB-/);
    expect(resultado.resumo.diferencaTotal).toBeGreaterThan(0);
    expect(resultado.analiseAbusividade).toBeDefined();
  });

  it("retorna resultado com PRICE + IPCA", () => {
    const resultado = calcularRevisaoImobiliario({
      ...params,
      sistemaAmortizacao: "PRICE",
      indexador: "IPCA",
      taxaIndexadorAnual: 4.5,
    }, 8.5);
    expect(resultado.demonstrativoOriginal).toHaveLength(360);
    expect(resultado.demonstrativoRecalculado).toHaveLength(360);
  });

  it("aceita taxa manual de recálculo", () => {
    const resultado = calcularRevisaoImobiliario({
      ...params,
      taxaRecalculo: "manual",
      taxaManualAnual: 7,
    }, 8.5);
    expect(resultado.taxaRecalculoAplicada).toBe(7);
    expect(resultado.criterioRecalculo).toContain("manual");
  });

  it("calcula dados de parcelas pagas quando informado", () => {
    const resultado = calcularRevisaoImobiliario({
      ...params,
      parcelasJaPagas: 60,
    }, 8.5);
    expect(resultado.dadosParcelasPagas).toBeDefined();
    expect(resultado.dadosParcelasPagas!.parcelasPagas).toBe(60);
    expect(resultado.dadosParcelasPagas!.parcelasRestantes).toBe(300);
  });

  it("lança erro para parâmetros inválidos", () => {
    expect(() => calcularRevisaoImobiliario({
      ...params,
      dataContrato: "2030-01-15",
    }, 8.5)).toThrow("Erros de validação");
  });

  it("funciona sem correção monetária", () => {
    const resultado = calcularRevisaoImobiliario({
      ...params,
      indexador: "NENHUM",
      taxaIndexadorAnual: 0,
    }, 8.5);
    expect(resultado.demonstrativoOriginal[0].correcaoMonetaria).toBe(0);
  });

  it("usa indexador de recálculo diferente quando informado", () => {
    const resultado = calcularRevisaoImobiliario({
      ...params,
      indexadorRecalculo: "NENHUM",
      taxaIndexadorRecalculoAnual: 0,
    }, 8.5);
    // Recálculo sem correção deve ter diferença maior
    expect(resultado.demonstrativoRecalculado[0].correcaoMonetaria).toBe(0);
    expect(resultado.demonstrativoOriginal[0].correcaoMonetaria).toBeGreaterThan(0);
  });

  it("saldo devedor zera na última parcela (SAC)", () => {
    const resultado = calcularRevisaoImobiliario(params, 8.5);
    const ultimaOrig = resultado.demonstrativoOriginal[359];
    const ultimaRecalc = resultado.demonstrativoRecalculado[359];
    expect(ultimaOrig.saldoDevedorAtual).toBe(0);
    expect(ultimaRecalc.saldoDevedorAtual).toBe(0);
  });

  it("saldo devedor zera na última parcela (PRICE)", () => {
    const resultado = calcularRevisaoImobiliario({
      ...params,
      sistemaAmortizacao: "PRICE",
    }, 8.5);
    const ultimaOrig = resultado.demonstrativoOriginal[359];
    const ultimaRecalc = resultado.demonstrativoRecalculado[359];
    expect(ultimaOrig.saldoDevedorAtual).toBe(0);
    expect(ultimaRecalc.saldoDevedorAtual).toBe(0);
  });
});

// ─── Cenários Reais ──────────────────────────────────────────────────────────

describe("Cenários Reais de Mercado", () => {
  it("Cenário Caixa: SAC, R$ 250k, 9.17% a.a., TR 0%, 360 meses, 30 anos", () => {
    const resultado = calcularRevisaoImobiliario({
      valorImovel: 350000,
      valorFinanciado: 250000,
      taxaJurosAnual: 9.17,
      prazoMeses: 360,
      dataContrato: "2022-06-15",
      dataPrimeiroVencimento: "2022-07-15",
      sistemaAmortizacao: "SAC",
      indexador: "TR",
      taxaIndexadorAnual: 0, // TR zerada
      idadeComprador: 35,
    }, 8.5);

    // Primeira parcela SAC: amort ~694.44 + juros ~1838.xx + seguros
    expect(resultado.demonstrativoOriginal[0].amortizacao).toBeCloseTo(694.44, 0);
    expect(resultado.demonstrativoOriginal[0].juros).toBeGreaterThan(1800);
    expect(resultado.demonstrativoOriginal[0].juros).toBeLessThan(1900);
    expect(resultado.demonstrativoOriginal[359].saldoDevedorAtual).toBe(0);
  });

  it("Cenário Itaú: PRICE, R$ 400k, 10.5% a.a., IPCA 4%, 240 meses", () => {
    const resultado = calcularRevisaoImobiliario({
      valorImovel: 500000,
      valorFinanciado: 400000,
      taxaJurosAnual: 10.5,
      prazoMeses: 240,
      dataContrato: "2023-01-10",
      dataPrimeiroVencimento: "2023-02-10",
      sistemaAmortizacao: "PRICE",
      indexador: "IPCA",
      taxaIndexadorAnual: 4.5,
      idadeComprador: 40,
    }, 8.5);

    // PRICE: PMT base deve estar entre R$ 3.500 e R$ 4.500 (amort+juros)
    const pmt1 = resultado.demonstrativoOriginal[0].amortizacao + resultado.demonstrativoOriginal[0].juros;
    expect(pmt1).toBeGreaterThan(3500);
    expect(pmt1).toBeLessThan(4500);
    expect(resultado.demonstrativoOriginal[239].saldoDevedorAtual).toBe(0);
  });

  it("Cenário curto: SAC, R$ 100k, 8% a.a., sem correção, 60 meses", () => {
    const resultado = calcularRevisaoImobiliario({
      valorImovel: 150000,
      valorFinanciado: 100000,
      taxaJurosAnual: 8,
      prazoMeses: 60,
      dataContrato: "2024-01-15",
      dataPrimeiroVencimento: "2024-02-15",
      sistemaAmortizacao: "SAC",
      indexador: "NENHUM",
      taxaIndexadorAnual: 0,
      idadeComprador: 30,
    }, 8.5);

    // Amortização constante = 100000/60 = ~1666.67
    expect(resultado.demonstrativoOriginal[0].amortizacao).toBeCloseTo(1666.67, 0);
    expect(resultado.demonstrativoOriginal[59].saldoDevedorAtual).toBe(0);
  });
});
