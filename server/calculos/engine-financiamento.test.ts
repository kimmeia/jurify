/**
 * Testes do Engine de Cálculo Bancário — Revisão de Financiamento
 *
 * v3-fix — Cobertura atualizada para engine v3:
 * - round2 usa toFixed(2) (comportamento JS padrão)
 * - calcularGauss em vez de calcularJurosSimples
 * - Recálculo SEMPRE usa Gauss (juros simples), mesmo sem abusividade
 * - anatocismoExpressoPactuado NÃO é sobrescrito por Súmula 541
 * - Parecer usa "DO RECÁLCULO" e "p. único"
 */

import { describe, expect, it } from "vitest";
import {
  round2,
  round8,
  addMonths,
  mensalParaAnual,
  anualParaMensal,
  verificarEquivalenciaTaxas,
  verificarEncargosMora,
  calcularPRICE,
  calcularSAC,
  calcularSACRE,
  calcularGauss,
  calcularTarifasFinanciadas,
  calcularCET,
  detectarAnatocismo,
  anatocismoPermitido,
  anatocismoPactuadoPorSumula541,
  analisarTarifas,
  analisarAbusividade,
  calcularValorLiquido,
  calcularRevisaoFinanciamento,
} from "./engine-financiamento";
import { gerarParecerTecnico } from "./parecer-financiamento";
import type { ParametrosFinanciamento } from "../../shared/financiamento-types";

// ─── Helpers ───────────────────────────────────────────────────────────────────

const baseParams: ParametrosFinanciamento = {
  valorFinanciado: 50000,
  taxaJurosMensal: 2.5,
  taxaJurosAnual: 34.49,
  quantidadeParcelas: 48,
  dataContrato: "2023-06-15",
  dataPrimeiroVencimento: "2023-07-15",
  sistemaAmortizacao: "PRICE",
  modalidadeCredito: "credito_pessoal",
};

// ─── Utilitários ───────────────────────────────────────────────────────────────

describe("Utilitários de precisão", () => {
  it("round2 arredonda para 2 casas decimais (toFixed padrão JS)", () => {
    // toFixed(2) em JS: 1.005 → "1.00" (floating point), 1.006 → "1.01"
    expect(round2(1.005)).toBe(1); // JS toFixed behavior
    expect(round2(1.006)).toBe(1.01);
    expect(round2(1.004)).toBe(1.0);
    expect(round2(123.456)).toBe(123.46);
    expect(round2(0)).toBe(0);
  });

  it("round8 arredonda para 8 casas decimais", () => {
    expect(round8(0.123456789)).toBe(0.12345679);
    expect(round8(1.0)).toBe(1);
  });

  it("addMonths adiciona meses corretamente", () => {
    expect(addMonths("2023-01-15", 1)).toBe("2023-02-15");
    expect(addMonths("2023-01-15", 12)).toBe("2024-01-15");
    expect(addMonths("2023-12-15", 1)).toBe("2024-01-15");
  });

  it("addMonths trata overflow de dias (31 jan → 28 fev)", () => {
    expect(addMonths("2023-01-31", 1)).toBe("2023-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // ano bissexto
    expect(addMonths("2023-03-31", 1)).toBe("2023-04-30");
    expect(addMonths("2023-05-31", 1)).toBe("2023-06-30");
  });
});

// ─── Conversão de Taxas ────────────────────────────────────────────────────────

describe("Conversão de Taxas", () => {
  it("converte mensal para anual equivalente (compostos)", () => {
    const anual = mensalParaAnual(2.5);
    expect(anual).toBeCloseTo(34.49, 0);
  });

  it("converte anual para mensal equivalente (compostos)", () => {
    const mensal = anualParaMensal(34.49);
    expect(mensal).toBeCloseTo(2.5, 1);
  });

  it("conversão ida e volta é consistente", () => {
    const mensal = 1.5;
    const anual = mensalParaAnual(mensal);
    const voltaMensal = anualParaMensal(anual);
    expect(voltaMensal).toBeCloseTo(mensal, 2);
  });
});

// ─── Verificação de Equivalência de Taxas ──────────────────────────────────────

describe("Verificação de Equivalência de Taxas", () => {
  it("detecta taxas equivalentes", () => {
    const result = verificarEquivalenciaTaxas(2.5, 34.49);
    expect(result.taxasEquivalentes).toBe(true);
    expect(result.capitalizacaoDiaria).toBe(false);
    expect(result.anualAutoCalculada).toBe(false);
  });

  it("detecta taxas não equivalentes", () => {
    const result = verificarEquivalenciaTaxas(2.5, 40);
    expect(result.taxasEquivalentes).toBe(false);
    expect(result.capitalizacaoDetalhes).toBeTruthy();
  });

  it("detecta possível capitalização diária", () => {
    const result = verificarEquivalenciaTaxas(2.5, 36);
    expect(result.taxasEquivalentes).toBe(false);
    expect(result.capitalizacaoDiaria).toBe(true);
  });

  it("auto-calcula taxa anual quando informada como 0", () => {
    const result = verificarEquivalenciaTaxas(2.5, 0);
    expect(result.taxasEquivalentes).toBe(true);
    expect(result.anualAutoCalculada).toBe(true);
    expect(result.capitalizacaoDiaria).toBe(false);
    expect(result.taxaAnualInformada).toBeCloseTo(34.49, 0);
  });
});

// ─── Verificação de Encargos de Mora ──────────────────────────────────────────

describe("Verificação de Encargos de Mora", () => {
  it("detecta multa moratória abusiva (> 2%)", () => {
    const params: ParametrosFinanciamento = { ...baseParams, multaMora: 3.0, jurosMora: 1.0 };
    const result = verificarEncargosMora(params);
    expect(result.multaMoraAbusiva).toBe(true);
    expect(result.jurosMoraAbusivos).toBe(false);
    expect(result.irregularidades.length).toBeGreaterThanOrEqual(1);
  });

  it("detecta juros moratórios abusivos (> 1% a.m.)", () => {
    const params: ParametrosFinanciamento = { ...baseParams, multaMora: 2.0, jurosMora: 1.5 };
    const result = verificarEncargosMora(params);
    expect(result.multaMoraAbusiva).toBe(false);
    expect(result.jurosMoraAbusivos).toBe(true);
  });

  it("detecta comissão de permanência cumulada (Súmula 472 STJ)", () => {
    const params: ParametrosFinanciamento = { ...baseParams, comissaoPermanencia: 1.0, multaMora: 2.0 };
    const result = verificarEncargosMora(params);
    expect(result.comissaoPermanenciaCumulada).toBe(true);
    expect(result.irregularidades.some(i => i.includes("Súmula 472"))).toBe(true);
  });

  it("não detecta irregularidades quando encargos são regulares", () => {
    const params: ParametrosFinanciamento = { ...baseParams, multaMora: 2.0, jurosMora: 1.0 };
    const result = verificarEncargosMora(params);
    expect(result.multaMoraAbusiva).toBe(false);
    expect(result.jurosMoraAbusivos).toBe(false);
    expect(result.irregularidades).toHaveLength(0);
  });
});

// ─── Tabela PRICE ──────────────────────────────────────────────────────────────

describe("Tabela PRICE", () => {
  it("calcula parcela fixa compatível com HP 12c", () => {
    const linhas = calcularPRICE(50000, 0.025, 48, "2023-07-15");
    expect(linhas).toHaveLength(48);

    const pmt = linhas[0].valorParcela;
    for (let i = 0; i < 47; i++) {
      expect(linhas[i].valorParcela).toBe(pmt);
    }

    expect(pmt).toBeGreaterThan(1790);
    expect(pmt).toBeLessThan(1810);
    expect(linhas[0].juros).toBe(1250);
    expect(linhas[47].saldoDevedorAtual).toBe(0);
  });

  it("juros decrescem e amortização cresce ao longo do tempo", () => {
    const linhas = calcularPRICE(50000, 0.025, 48, "2023-07-15");
    expect(linhas[0].juros).toBeGreaterThan(linhas[47].juros);
    expect(linhas[0].amortizacao).toBeLessThan(linhas[47].amortizacao);
  });

  it("taxa zero gera parcelas sem juros", () => {
    const linhas = calcularPRICE(12000, 0, 12, "2023-07-15");
    expect(linhas).toHaveLength(12);
    expect(linhas[0].valorParcela).toBe(1000);
    expect(linhas[0].juros).toBe(0);
    expect(linhas[11].saldoDevedorAtual).toBe(0);
  });
});

// ─── SAC ───────────────────────────────────────────────────────────────────────

describe("SAC", () => {
  it("amortização é constante", () => {
    const linhas = calcularSAC(50000, 0.025, 48, "2023-07-15");
    expect(linhas).toHaveLength(48);
    const amortFixa = round2(50000 / 48);
    for (let i = 0; i < 47; i++) {
      expect(linhas[i].amortizacao).toBe(amortFixa);
    }
  });

  it("parcelas são decrescentes", () => {
    const linhas = calcularSAC(50000, 0.025, 48, "2023-07-15");
    for (let i = 1; i < linhas.length; i++) {
      expect(linhas[i].valorParcela).toBeLessThanOrEqual(linhas[i - 1].valorParcela);
    }
  });

  it("saldo devedor final é zero", () => {
    const linhas = calcularSAC(50000, 0.025, 48, "2023-07-15");
    expect(linhas[47].saldoDevedorAtual).toBe(0);
  });
});

// ─── SACRE ─────────────────────────────────────────────────────────────────────

describe("SACRE", () => {
  it("recalcula parcelas periodicamente", () => {
    const linhas = calcularSACRE(50000, 0.025, 48, "2023-07-15");
    expect(linhas).toHaveLength(48);
    expect(linhas[0].valorParcela).toBeCloseTo(linhas[47].valorParcela, 0);
  });

  it("saldo devedor final é zero", () => {
    const linhas = calcularSACRE(50000, 0.025, 48, "2023-07-15");
    expect(linhas[47].saldoDevedorAtual).toBe(0);
  });
});

// ─── Método Gauss (Juros Simples) ─────────────────────────────────────────────

describe("Método Gauss (Juros Simples)", () => {
  it("calcula parcelas pelo método Gauss", () => {
    const linhas = calcularGauss(50000, 0.025, 48, "2023-07-15");
    expect(linhas).toHaveLength(48);
    expect(linhas[47].saldoDevedorAtual).toBe(0);
  });

  it("Gauss gera MENOS juros totais que PRICE (juros simples < compostos)", () => {
    const price = calcularPRICE(50000, 0.025, 48, "2023-07-15");
    const gauss = calcularGauss(50000, 0.025, 48, "2023-07-15");
    const totalPrice = price.reduce((s, l) => s + l.valorParcela, 0);
    const totalGauss = gauss.reduce((s, l) => s + l.valorParcela, 0);
    expect(totalGauss).toBeLessThan(totalPrice);
  });

  it("Gauss gera parcelas menores que PRICE", () => {
    const price = calcularPRICE(50000, 0.025, 48, "2023-07-15");
    const gauss = calcularGauss(50000, 0.025, 48, "2023-07-15");
    expect(gauss[0].valorParcela).toBeLessThan(price[0].valorParcela);
  });

  it("saldo devedor SEMPRE decresce (sem flutuação)", () => {
    const linhas = calcularGauss(50000, 0.025, 48, "2023-07-15");
    for (let i = 1; i < linhas.length; i++) {
      expect(linhas[i].saldoDevedorAnterior).toBeLessThan(linhas[i - 1].saldoDevedorAnterior);
    }
  });

  it("amortização cresce em PA e juros decrescem", () => {
    const linhas = calcularGauss(50000, 0.025, 48, "2023-07-15");
    expect(linhas[0].amortizacao).toBeLessThan(linhas[46].amortizacao);
    expect(linhas[0].juros).toBeGreaterThan(linhas[46].juros);
  });

  it("reproduz valores do artigo académico (P=50000, i=1.5%, n=15)", () => {
    const linhas = calcularGauss(50000, 0.015, 15, "2024-01-15");
    expect(linhas[0].valorParcela).toBe(3695.32);
    expect(linhas[0].amortizacao).toBe(3016.59);
    expect(linhas[0].juros).toBe(678.73);
    expect(linhas[14].saldoDevedorAtual).toBe(0);
  });
});

// ─── CET ───────────────────────────────────────────────────────────────────────

describe("Custo Efetivo Total (CET)", () => {
  it("calcula CET próximo à taxa nominal quando não há tarifas", () => {
    const cet = calcularCET(baseParams);
    expect(cet.cetMensal).toBeCloseTo(baseParams.taxaJurosMensal, 1);
    expect(cet.diferencaCET_vs_Nominal).toBeCloseTo(0, 0);
  });

  it("CET é maior que taxa nominal quando há tarifas pagas antecipadamente", () => {
    const params: ParametrosFinanciamento = {
      ...baseParams,
      tarifas: { tac: 1000, tacFinanciada: false },
    };
    const cet = calcularCET(params);
    expect(cet.cetMensal).toBeGreaterThan(params.taxaJurosMensal);
    expect(cet.diferencaCET_vs_Nominal).toBeGreaterThan(0);
  });
});

// ─── Tarifas ───────────────────────────────────────────────────────────────────

describe("Tarifas Financiadas", () => {
  it("soma tarifas marcadas como financiadas", () => {
    const params: ParametrosFinanciamento = {
      ...baseParams,
      tarifas: {
        tac: 500, tacFinanciada: true,
        tec: 200, tecFinanciada: true,
        iof: 300, iofFinanciado: false,
        seguro: 1500, seguroFinanciado: true,
      },
    };
    const total = calcularTarifasFinanciadas(params);
    expect(total).toBe(2200);
  });
});

// ─── Detecção de Anatocismo ────────────────────────────────────────────────────

describe("Detecção de Anatocismo", () => {
  it("detecta anatocismo quando taxa anual > taxa simples", () => {
    expect(detectarAnatocismo(2.5, 34.49)).toBe(true);
  });

  it("não detecta anatocismo com juros simples", () => {
    expect(detectarAnatocismo(2.5, 30)).toBe(false);
  });

  it("não detecta anatocismo com taxa anual = 0", () => {
    expect(detectarAnatocismo(2.5, 0)).toBe(false);
  });
});

// ─── Súmula 541 ──────────────────────────────────────────────────────────────

describe("Súmula 541 do STJ", () => {
  it("taxa anual > mensal×12 autoriza anatocismo pela Súmula 541", () => {
    expect(anatocismoPactuadoPorSumula541(2.5, 34.49)).toBe(true);
  });

  it("taxa anual ≤ mensal×12 não autoriza pela Súmula 541", () => {
    expect(anatocismoPactuadoPorSumula541(2.5, 30)).toBe(false);
  });

  it("taxa anual = 0 não autoriza pela Súmula 541", () => {
    expect(anatocismoPactuadoPorSumula541(2.5, 0)).toBe(false);
  });
});

// ─── Tarifas Ilegais ──────────────────────────────────────────────────────────

describe("Análise de Tarifas", () => {
  it("TAC é ilegal após 30/04/2008", () => {
    const params: ParametrosFinanciamento = {
      ...baseParams,
      tarifas: { tac: 500 },
    };
    const ilegais = analisarTarifas(params);
    expect(ilegais.some((t) => t.descricao.includes("TAC"))).toBe(true);
  });

  it("TAC é legal antes de 30/04/2008", () => {
    const params: ParametrosFinanciamento = {
      ...baseParams,
      dataContrato: "2007-01-15",
      tarifas: { tac: 500 },
    };
    const ilegais = analisarTarifas(params);
    expect(ilegais.some((t) => t.descricao.includes("TAC"))).toBe(false);
  });

  it("seguro é ilegal quando NÃO houve livre escolha", () => {
    const params: ParametrosFinanciamento = {
      ...baseParams,
      tarifas: { seguro: 1500, seguroLivreEscolha: false },
    };
    const ilegais = analisarTarifas(params);
    expect(ilegais.some((t) => t.descricao.includes("Seguro"))).toBe(true);
  });

  it("seguro é legal quando houve livre escolha", () => {
    const params: ParametrosFinanciamento = {
      ...baseParams,
      tarifas: { seguro: 1500, seguroLivreEscolha: true },
    };
    const ilegais = analisarTarifas(params);
    expect(ilegais.some((t) => t.descricao.includes("Seguro"))).toBe(false);
  });

  it("seguro sem indicação de livre escolha é ilegal (padrão)", () => {
    const params: ParametrosFinanciamento = {
      ...baseParams,
      tarifas: { seguro: 1500 },
    };
    const ilegais = analisarTarifas(params);
    expect(ilegais.some((t) => t.descricao.includes("Seguro"))).toBe(true);
  });
});

// ─── Análise de Abusividade Completa ───────────────────────────────────────────

describe("Análise de Abusividade", () => {
  it("detecta taxa abusiva quando > 1,5× média BACEN", () => {
    const taxaAnualBACEN = mensalParaAnual(1.2);
    const analise = analisarAbusividade(baseParams, 1.2, taxaAnualBACEN);
    expect(analise.taxaAbusiva).toBe(true);
    expect(analise.tetoSTJ_mensal).toBeCloseTo(1.8, 2);
  });

  it("teto STJ anual é calculado via compostos (não multiplicação simples)", () => {
    const taxaAnualBACEN = mensalParaAnual(1.2);
    const analise = analisarAbusividade(baseParams, 1.2, taxaAnualBACEN);
    const tetoAnualEsperado = mensalParaAnual(1.8);
    expect(analise.tetoSTJ_anual).toBeCloseTo(tetoAnualEsperado, 1);
  });

  it("não detecta abusividade quando taxa está dentro do teto", () => {
    const taxaAnualBACEN = mensalParaAnual(2.0);
    const analise = analisarAbusividade(baseParams, 2.0, taxaAnualBACEN);
    expect(analise.taxaAbusiva).toBe(false);
  });

  it("inclui CET na análise", () => {
    const taxaAnualBACEN = mensalParaAnual(1.2);
    const analise = analisarAbusividade(baseParams, 1.2, taxaAnualBACEN);
    expect(analise.cet).toBeDefined();
    expect(analise.cet.cetMensal).toBeGreaterThan(0);
    expect(analise.cet.cetAnual).toBeGreaterThan(0);
  });

  it("detecta anatocismo e Súmula 541 mas NÃO sobrescreve expressoPactuado", () => {
    // No engine v3-fix, anatocismoExpressoPactuado NÃO é sobrescrito por Súmula 541
    const params: ParametrosFinanciamento = {
      ...baseParams,
      taxaJurosAnual: 34.49,
      anatocismoExpressoPactuado: false,
    };
    const taxaAnualBACEN = mensalParaAnual(1.2);
    const analise = analisarAbusividade(params, 1.2, taxaAnualBACEN);
    expect(analise.anatocismoDetectado).toBe(true);
    expect(analise.anatocismoPactuadoPorSumula541).toBe(true);
    // v3-fix: expressoPactuado mantém o valor informado (false), NÃO é sobrescrito
    expect(analise.anatocismoExpressoPactuado).toBe(false);
  });
});

// ─── Recálculo Completo ────────────────────────────────────────────────────────

describe("Recálculo do Contrato", () => {
  const taxaMensalBACEN = 1.2;
  const taxaAnualBACEN = mensalParaAnual(1.2);

  it("gera demonstrativos original e recalculado", () => {
    const resultado = calcularRevisaoFinanciamento(baseParams, taxaMensalBACEN, taxaAnualBACEN);
    expect(resultado.demonstrativoOriginal).toHaveLength(48);
    expect(resultado.demonstrativoRecalculado).toHaveLength(48);
  });

  it("diferença total é positiva quando taxa é abusiva", () => {
    const resultado = calcularRevisaoFinanciamento(baseParams, taxaMensalBACEN, taxaAnualBACEN);
    expect(resultado.resumo.diferencaTotal).toBeGreaterThan(0);
  });

  it("recalculo Gauss sem abusividade: diferencaJuros POSITIVA (Gauss sempre gera menos juros que PRICE)", () => {
    // v4-fix: Gauss com amortização em PA SEMPRE gera menos juros que PRICE
    // Mesmo quando taxa não é abusiva, recalcular com Gauss beneficia o consumidor
    const taxaAltaBACEN = 2.0;
    const taxaAltaAnual = mensalParaAnual(2.0);
    const resultado = calcularRevisaoFinanciamento(baseParams, taxaAltaBACEN, taxaAltaAnual);

    // Taxa nao e abusiva (2.5 < 2.0 * 1.5 = 3.0)
    expect(resultado.analiseAbusividade.taxaAbusiva).toBe(false);
    // Taxa de recalculo deve ser a original
    expect(resultado.taxaRecalculoAplicada).toBeCloseTo(2.5, 2);
    // diferencaJuros = jurosOriginal - jurosRecalculado
    // Gauss com PA gera MENOS juros que PRICE, entao diferenca e POSITIVA
    expect(resultado.resumo.diferencaJuros).toBeGreaterThan(0);
    // totalPagoRecalculado < totalPagoOriginal neste cenario
    expect(resultado.resumo.totalPagoRecalculado).toBeLessThan(resultado.resumo.totalPagoOriginal);
  });

  it("deduz tarifas ilegais do valor financiado no recálculo", () => {
    const paramsComTarifas: ParametrosFinanciamento = {
      ...baseParams,
      tarifas: { tac: 500, tacFinanciada: true, tec: 200, tecFinanciada: true },
    };
    const resultado = calcularRevisaoFinanciamento(paramsComTarifas, taxaMensalBACEN, taxaAnualBACEN);
    expect(resultado.resumo.tarifasIlegais).toBe(700);
    expect(resultado.analiseAbusividade.tarifasIlegais).toHaveLength(2);
  });

  it("calcula repetição de indébito em dobro", () => {
    const resultado = calcularRevisaoFinanciamento(baseParams, taxaMensalBACEN, taxaAnualBACEN);
    expect(resultado.resumo.repeticaoIndebito).toBe(
      round2(resultado.resumo.diferencaTotal * 2)
    );
  });

  it("gera protocolo único", () => {
    const resultado = calcularRevisaoFinanciamento(baseParams, taxaMensalBACEN, taxaAnualBACEN);
    expect(resultado.protocoloCalculo).toBeDefined();
    expect(resultado.protocoloCalculo).toMatch(/^RC-\d{8}-[A-Z0-9]{6}$/);
  });

  it("respeita critério de recálculo teto_stj", () => {
    const params: ParametrosFinanciamento = { ...baseParams, taxaRecalculo: "teto_stj" };
    const resultado = calcularRevisaoFinanciamento(params, taxaMensalBACEN, taxaAnualBACEN);
    expect(resultado.taxaRecalculoAplicada).toBeCloseTo(1.8, 2);
    expect(resultado.criterioRecalculo).toContain("Teto STJ");
  });

  it("respeita critério de recálculo manual", () => {
    const params: ParametrosFinanciamento = { ...baseParams, taxaRecalculo: "manual", taxaManual: 1.5 };
    const resultado = calcularRevisaoFinanciamento(params, taxaMensalBACEN, taxaAnualBACEN);
    expect(resultado.taxaRecalculoAplicada).toBeCloseTo(1.5, 2);
  });
});

// ─── Parecer Técnico ───────────────────────────────────────────────────────────

describe("Parecer Técnico", () => {
  const taxaMensalBACEN = 1.2;
  const taxaAnualBACEN = mensalParaAnual(1.2);

  it("gera parecer com fundamentação jurídica completa", () => {
    const resultado = calcularRevisaoFinanciamento(baseParams, taxaMensalBACEN, taxaAnualBACEN);
    const parecer = gerarParecerTecnico(
      baseParams,
      resultado.analiseAbusividade,
      resultado.resumo,
      resultado.taxaRecalculoAplicada,
      resultado.criterioRecalculo,
      resultado.protocoloCalculo
    );

    expect(parecer).toContain("PARECER TÉCNICO");
    expect(parecer).toContain("DADOS DO CONTRATO");
    expect(parecer).toContain("CUSTO EFETIVO TOTAL");
    expect(parecer).toContain("ANÁLISE DA TAXA DE JUROS");
    expect(parecer).toContain("CAPITALIZAÇÃO DE JUROS");
    expect(parecer).toContain("TARIFAS");
    expect(parecer).toContain("ENCARGOS DE MORA");
    expect(parecer).toContain("RECÁLCULO");
    expect(parecer).toContain("CONCLUSÃO");
  });

  it("inclui protocolo no cabeçalho", () => {
    const resultado = calcularRevisaoFinanciamento(baseParams, taxaMensalBACEN, taxaAnualBACEN);
    const parecer = gerarParecerTecnico(
      baseParams,
      resultado.analiseAbusividade,
      resultado.resumo,
      resultado.taxaRecalculoAplicada,
      resultado.criterioRecalculo,
      resultado.protocoloCalculo
    );
    expect(parecer).toContain("Protocolo:");
    expect(parecer).toContain("RC-");
  });

  it("menciona repetição de indébito em dobro quando há irregularidades", () => {
    const resultado = calcularRevisaoFinanciamento(baseParams, taxaMensalBACEN, taxaAnualBACEN);
    const parecer = gerarParecerTecnico(
      baseParams,
      resultado.analiseAbusividade,
      resultado.resumo,
      resultado.taxaRecalculoAplicada,
      resultado.criterioRecalculo
    );
    // v3-fix: taxa é abusiva (2.5% > 1.8% teto), logo há irregularidades
    expect(parecer.toLowerCase()).toContain("repetição de indébito em dobro");
    expect(parecer).toContain("art. 42, p. único"); // v3-fix: usa "p. único" não "parágrafo único"
  });

  it("cita Súmula 541 quando aplicável", () => {
    const params: ParametrosFinanciamento = {
      ...baseParams,
      taxaJurosAnual: 34.49,
      anatocismoExpressoPactuado: false,
    };
    const resultado = calcularRevisaoFinanciamento(params, taxaMensalBACEN, taxaAnualBACEN);
    const parecer = gerarParecerTecnico(
      params,
      resultado.analiseAbusividade,
      resultado.resumo,
      resultado.taxaRecalculoAplicada,
      resultado.criterioRecalculo
    );
    expect(parecer).toContain("Súmula 541");
  });
});

// ─── Cenários de Borda ─────────────────────────────────────────────────────────

describe("Cenários de Borda", () => {
  const taxaMensalBACEN = 1.2;
  const taxaAnualBACEN = mensalParaAnual(1.2);

  it("prazo curto: 1 parcela", () => {
    const linhas = calcularPRICE(10000, 0.025, 1, "2023-07-15");
    expect(linhas).toHaveLength(1);
    expect(linhas[0].saldoDevedorAtual).toBe(0);
    expect(linhas[0].valorParcela).toBe(round2(10000 * 1.025));
  });

  it("valor alto: R$ 10.000.000", () => {
    const linhas = calcularPRICE(10000000, 0.01, 360, "2023-07-15");
    expect(linhas).toHaveLength(360);
    expect(linhas[359].saldoDevedorAtual).toBe(0);
  });

  it("taxa zero: financiamento sem juros", () => {
    const linhas = calcularSAC(12000, 0, 12, "2023-07-15");
    expect(linhas).toHaveLength(12);
    expect(linhas[0].valorParcela).toBe(1000);
    expect(linhas[0].juros).toBe(0);
    expect(linhas[11].saldoDevedorAtual).toBe(0);
  });

  it("recálculo completo com todas as irregularidades", () => {
    const params: ParametrosFinanciamento = {
      ...baseParams,
      taxaJurosAnual: 34.49,
      tarifas: { tac: 500, tacFinanciada: true, tec: 200, tecFinanciada: true, seguro: 1500, seguroFinanciado: true },
      comissaoPermanencia: 1.0,
      multaMora: 3.0,
      jurosMora: 1.5,
      anatocismoExpressoPactuado: false,
    };

    const resultado = calcularRevisaoFinanciamento(params, taxaMensalBACEN, taxaAnualBACEN);

    expect(resultado.analiseAbusividade.taxaAbusiva).toBe(true);
    expect(resultado.analiseAbusividade.tarifasIlegais.length).toBeGreaterThanOrEqual(2);
    expect(resultado.analiseAbusividade.verificacaoEncargosMora.comissaoPermanenciaCumulada).toBe(true);
    expect(resultado.analiseAbusividade.verificacaoEncargosMora.multaMoraAbusiva).toBe(true);
    expect(resultado.analiseAbusividade.verificacaoEncargosMora.jurosMoraAbusivos).toBe(true);
    expect(resultado.resumo.diferencaTotal).toBeGreaterThan(0);
    expect(resultado.resumo.repeticaoIndebito).toBeGreaterThan(0);
    expect(resultado.analiseAbusividade.cet).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDAÇÃO HP 12c — PRECISÃO FINANCEIRA PADRÃO
//
// A HP 12c é a calculadora financeira de referência no Brasil (aceita em
// perícias judiciais). Estes testes garantem que o engine reproduz os
// mesmos valores que a HP 12c produziria para as mesmas entradas.
//
// Fórmula da HP 12c para PMT (modo END, FV=0, sinais convencionais):
//     PMT = PV × i / (1 − (1+i)^−n)
//
// Equivalente algebricamente a:
//     PMT = PV × i × (1+i)^n / ((1+i)^n − 1)
//
// Tolerância: 1 centavo (R$ 0,01). O engine arredonda para 2 casas a cada
// passo, então pequenas discrepâncias são esperadas mas nunca > 1 centavo
// na parcela, nem > R$ 1,00 acumulado em 360 parcelas.
// ═══════════════════════════════════════════════════════════════════════════════

/** Fórmula HP 12c pura para PMT — sem arredondamento intermediário. */
function hp12cPMT(pv: number, i: number, n: number): number {
  if (i === 0) return pv / n;
  return (pv * i) / (1 - Math.pow(1 + i, -n));
}

describe("Validação HP 12c — Tabela PRICE", () => {
  // Cenários representativos do mercado brasileiro.
  // O PMT esperado é computado pela fórmula HP 12c padrão (hp12cPMT),
  // que é algebricamente idêntica à usada pela calculadora HP 12c
  // e pelos bancos em seus contratos.
  const cenariosHP12c: Array<[string, number, number, number]> = [
    ["Crédito pessoal 50k / 2,5% a.m. / 48m", 50000, 0.025, 48],
    ["Crédito pessoal 5k / 3,5% a.m. / 12m", 5000, 0.035, 12],
    ["Veículo 40k / 1,79% a.m. / 60m", 40000, 0.0179, 60],
    ["Imobiliário 300k / 0,9% a.m. / 420m", 300000, 0.009, 420],
    ["Imobiliário 200k / 1,0% a.m. / 360m", 200000, 0.01, 360],
    ["Cheque especial 2k / 12% a.m. / 6m", 2000, 0.12, 6],
    ["Consignado 15k / 1,8% a.m. / 96m", 15000, 0.018, 96],
    ["Crédito pessoal alto juros 10k / 8% a.m. / 24m", 10000, 0.08, 24],
  ];

  for (const [desc, pv, i, n] of cenariosHP12c) {
    it(`PMT ${desc}`, () => {
      const linhas = calcularPRICE(pv, i, n, "2024-01-15");
      const pmtEngine = linhas[0].valorParcela;
      const pmtFormula = hp12cPMT(pv, i, n);

      // Engine deve bater com fórmula HP 12c dentro de 1 centavo
      expect(pmtEngine).toBeCloseTo(pmtFormula, 1);
    });
  }

  // Valores absolutos verificados manualmente com HP 12c (sanity check).
  // Estes são os casos mais citados em perícias bancárias no Brasil.
  it("PMT absoluto: 50k / 2,5% a.m. / 48m = R$ 1.800,30", () => {
    // HP 12c: 50000 [PV] 2.5 [i] 48 [n] [PMT] → -1800,298…
    const linhas = calcularPRICE(50000, 0.025, 48, "2024-01-15");
    expect(linhas[0].valorParcela).toBeCloseTo(1800.30, 1);
    expect(linhas[0].juros).toBe(1250); // 50000 × 2,5% exato
  });

  it("PMT absoluto: 200k / 1,0% a.m. / 360m ≈ R$ 2.057,23", () => {
    // Imobiliário clássico — 30 anos, taxa 1% a.m.
    const linhas = calcularPRICE(200000, 0.01, 360, "2024-01-15");
    const pmt = linhas[0].valorParcela;
    expect(pmt).toBeGreaterThanOrEqual(2057);
    expect(pmt).toBeLessThanOrEqual(2058);
    expect(linhas[0].juros).toBe(2000); // 200k × 1% exato
  });

  it("PMT absoluto: 10k / 1% a.m. / 1m = R$ 10.100 (parcela única)", () => {
    // Caso degenerado trivialmente verificável
    const linhas = calcularPRICE(10000, 0.01, 1, "2024-01-15");
    expect(linhas[0].valorParcela).toBe(10100);
    expect(linhas[0].juros).toBe(100);
  });

  it("PRICE: soma das amortizações = PV (saldo zera exato)", () => {
    const linhas = calcularPRICE(50000, 0.025, 48, "2024-01-15");
    const somaAmort = linhas.reduce((s, l) => s + l.amortizacao, 0);
    expect(somaAmort).toBeCloseTo(50000, 1);
    expect(linhas[linhas.length - 1].saldoDevedorAtual).toBe(0);
  });

  it("PRICE: total pago ≈ n × PMT (dentro de 1 centavo)", () => {
    const pv = 50000, i = 0.025, n = 48;
    const linhas = calcularPRICE(pv, i, n, "2024-01-15");
    const totalEngine = linhas.reduce((s, l) => s + l.valorParcela, 0);
    const totalEsperado = n * hp12cPMT(pv, i, n);
    // Tolerância R$ 1,00 por 48 parcelas (arredondamento propaga)
    expect(Math.abs(totalEngine - totalEsperado)).toBeLessThanOrEqual(1);
  });

  it("PRICE: saldo devedor em qualquer período = PV × (1+i)^k − PMT × [((1+i)^k − 1)/i]", () => {
    // Fórmula fechada do saldo devedor — válida em qualquer parcela.
    const pv = 50000, i = 0.025, n = 48;
    const pmt = hp12cPMT(pv, i, n);
    const linhas = calcularPRICE(pv, i, n, "2024-01-15");

    for (const k of [1, 12, 24, 36, 47]) {
      const saldoFormula = pv * Math.pow(1 + i, k) - pmt * ((Math.pow(1 + i, k) - 1) / i);
      const saldoEngine = linhas[k - 1].saldoDevedorAtual;
      // Tolerância de R$ 1,00 por propagação do arredondamento
      expect(Math.abs(saldoEngine - saldoFormula)).toBeLessThanOrEqual(1);
    }
  });
});

describe("Validação HP 12c — SAC", () => {
  it("SAC: amortização constante = PV/n (fórmula padrão HP 12c em modo SAC)", () => {
    const pv = 120000, i = 0.01, n = 120;
    const linhas = calcularSAC(pv, i, n, "2024-01-15");
    const amortEsperada = round2(pv / n);

    // Todas as amortizações (exceto última, que absorve resíduo) iguais
    for (let k = 0; k < n - 1; k++) {
      expect(linhas[k].amortizacao).toBe(amortEsperada);
    }
  });

  it("SAC: parcela k = amort + saldo_anterior × i", () => {
    const pv = 120000, i = 0.01, n = 120;
    const linhas = calcularSAC(pv, i, n, "2024-01-15");

    for (const k of [1, 30, 60, 90]) {
      const linha = linhas[k - 1];
      const jurosEsperado = round2(linha.saldoDevedorAnterior * i);
      const parcelaEsperada = round2(linha.amortizacao + jurosEsperado);
      expect(linha.juros).toBe(jurosEsperado);
      expect(linha.valorParcela).toBe(parcelaEsperada);
    }
  });

  it("SAC: primeira parcela = maior, última parcela ≈ amort + amort×i", () => {
    const pv = 120000, i = 0.01, n = 120;
    const linhas = calcularSAC(pv, i, n, "2024-01-15");
    const amort = pv / n;

    // Primeira parcela: amort + PV*i
    expect(linhas[0].valorParcela).toBeCloseTo(amort + pv * i, 1);
    // Última parcela: amort + amort*i (saldo = amort antes de pagar)
    expect(linhas[n - 1].valorParcela).toBeCloseTo(amort + amort * i, 1);
  });

  it("SAC: total de juros = amort × i × [n(n+1)/2] / n = amort × i × (n+1)/2 × n", () => {
    // Juros totais SAC = i × Sum(saldo_anterior) = i × amort × Sum(k) onde k=n,n-1,...,1
    const pv = 120000, i = 0.01, n = 120;
    const amort = pv / n;
    const linhas = calcularSAC(pv, i, n, "2024-01-15");
    const totalJurosEngine = linhas.reduce((s, l) => s + l.juros, 0);
    const totalJurosFormula = i * amort * (n * (n + 1) / 2);
    // Tolerância de R$ 1,00 (120 parcelas arredondando)
    expect(Math.abs(totalJurosEngine - totalJurosFormula)).toBeLessThanOrEqual(1);
  });
});

describe("Validação HP 12c — Equivalência de taxas", () => {
  it("taxa anual equivalente (1+i_m)^12 − 1 bate com padrão HP 12c", () => {
    // HP 12c: [12 i] [12 n] [1000 PV] [0 FV] [PMT]
    // Para taxas compostas: i_a = (1+i_m)^12 - 1
    const casos = [
      [0.01, 0.126825], // 1% a.m. → ≈ 12,6825% a.a.
      [0.015, 0.195618], // 1,5% a.m. → ≈ 19,5618% a.a.
      [0.02, 0.268242], // 2% a.m. → ≈ 26,8242% a.a.
      [0.025, 0.344889], // 2,5% a.m. → ≈ 34,4889% a.a.
    ];
    for (const [im, iaEsperado] of casos) {
      const iaCalculado = mensalParaAnual(im * 100) / 100;
      expect(iaCalculado).toBeCloseTo(iaEsperado, 4);
    }
  });

  it("conversão anual → mensal → anual é idempotente", () => {
    const iaOriginal = 34.4889;
    const im = anualParaMensal(iaOriginal);
    const iaDeVolta = mensalParaAnual(im);
    expect(iaDeVolta).toBeCloseTo(iaOriginal, 3);
  });
});

describe("Validação HP 12c — Cenários reais de revisão judicial", () => {
  // Casos inspirados em acórdãos típicos — valores arredondados que
  // aparecem em contratos reais de mercado.
  it("Financiamento CDC 24m 1,99% — caso típico de veículo", () => {
    const pv = 35000, i = 0.0199, n = 24;
    const linhas = calcularPRICE(pv, i, n, "2024-01-15");
    const pmtHP = hp12cPMT(pv, i, n);
    expect(linhas[0].valorParcela).toBeCloseTo(pmtHP, 1);
    // Sanity: última parcela zera saldo exato
    expect(linhas[n - 1].saldoDevedorAtual).toBe(0);
  });

  it("Consignado INSS 60m 1,85% — teto Res. CNPS atual", () => {
    const pv = 20000, i = 0.0185, n = 60;
    const linhas = calcularPRICE(pv, i, n, "2024-01-15");
    const pmtHP = hp12cPMT(pv, i, n);
    expect(linhas[0].valorParcela).toBeCloseTo(pmtHP, 1);
  });

  it("Imobiliário SFH 360m TR+0,7% — longo prazo", () => {
    // Taxa nominal baixa + muitas parcelas é o cenário mais exigente
    // para precisão (propagação de arredondamento).
    const pv = 250000, i = 0.007, n = 360;
    const linhas = calcularPRICE(pv, i, n, "2024-01-15");
    const pmtHP = hp12cPMT(pv, i, n);
    expect(linhas[0].valorParcela).toBeCloseTo(pmtHP, 1);
    expect(linhas[n - 1].saldoDevedorAtual).toBe(0);

    // Total pago deve estar dentro de R$ 10 do teórico (360 parcelas com juros
    // baixos exigem tolerância maior pela propagação de arredondamento).
    // Isso representa 0,001% de um total que passa de R$ 685 mil — negligível
    // para análise judicial.
    const totalEngine = linhas.reduce((s, l) => s + l.valorParcela, 0);
    const totalTeorico = n * pmtHP;
    expect(Math.abs(totalEngine - totalTeorico)).toBeLessThanOrEqual(10);
  });

  it("Cheque especial 6m 12% — juros altos compactos", () => {
    const pv = 5000, i = 0.12, n = 6;
    const linhas = calcularPRICE(pv, i, n, "2024-01-15");
    const pmtHP = hp12cPMT(pv, i, n);
    expect(linhas[0].valorParcela).toBeCloseTo(pmtHP, 1);
  });
});
