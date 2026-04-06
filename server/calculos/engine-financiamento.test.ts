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
    expect(parecer).toContain("ANÁLISE DE TAXAS");
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
