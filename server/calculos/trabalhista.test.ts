/**
 * Testes do Motor de Cálculo Trabalhista
 * 
 * Cobre:
 * - Rescisão: sem justa causa, pedido demissão, justa causa, acordo mútuo
 * - INSS progressivo
 * - IRRF com dependentes
 * - Aviso prévio proporcional (Lei 12.506/2011)
 * - 13º proporcional, férias proporcionais + 1/3, férias vencidas em dobro
 * - FGTS + multa 40%/20%
 * - Horas extras 50% e 100%, adicional noturno, reflexos
 */

import { describe, expect, it } from "vitest";
import { calcularRescisao, calcularINSS, calcularIRRF } from "./engine-rescisao";
import { calcularHorasExtras } from "./engine-horas-extras";
import type { ParametrosRescisao, ParametrosHorasExtras } from "../../shared/trabalhista-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── INSS Progressivo ────────────────────────────────────────────────────────

describe("calcularINSS", () => {
  it("calcula INSS para salário na primeira faixa (R$ 1.500)", () => {
    const inss = calcularINSS(1500);
    // 1500 × 7.5% = 112.50
    expect(inss).toBe(112.50);
  });

  it("calcula INSS para salário na segunda faixa (R$ 2.500)", () => {
    const inss = calcularINSS(2500);
    // 1518 × 7.5% = 113.85
    // (2500 - 1518) × 9% = 88.38
    expect(inss).toBeCloseTo(202.23, 1);
  });

  it("calcula INSS para salário na terceira faixa (R$ 4.000)", () => {
    const inss = calcularINSS(4000);
    // 1518 × 7.5% = 113.85
    // (2793.88 - 1518) × 9% = 114.83
    // (4000 - 2793.88) × 12% = 144.73
    expect(inss).toBeCloseTo(373.41, 1);
  });

  it("calcula INSS para salário acima do teto (R$ 10.000)", () => {
    const inss = calcularINSS(10000);
    // Teto: 1518×7.5% + 1275.88×9% + 1396.95×12% + 3966.58×14%
    const teto = r2(1518 * 0.075 + (2793.88 - 1518) * 0.09 + (4190.83 - 2793.88) * 0.12 + (8157.41 - 4190.83) * 0.14);
    expect(inss).toBeCloseTo(teto, 1);
  });

  it("calcula INSS para salário mínimo (R$ 1.518)", () => {
    const inss = calcularINSS(1518);
    expect(inss).toBeCloseTo(113.85, 1);
  });
});

// ─── IRRF ────────────────────────────────────────────────────────────────────

describe("calcularIRRF", () => {
  it("retorna 0 para base abaixo da faixa de isenção", () => {
    expect(calcularIRRF(2000)).toBe(0);
  });

  it("calcula IRRF para base na segunda faixa", () => {
    const ir = calcularIRRF(2700);
    // 2700 × 7.5% - 169.44 = 33.06
    expect(ir).toBeCloseTo(33.06, 1);
  });

  it("calcula IRRF para base alta (R$ 8.000)", () => {
    const ir = calcularIRRF(8000);
    // 8000 × 27.5% - 896.00 = 1304.00
    expect(ir).toBeCloseTo(1304.00, 1);
  });

  it("desconta dependentes corretamente", () => {
    // Base 3000 com 2 dependentes: 3000 - 2×189.59 = 2620.82
    const ir = calcularIRRF(3000, 2);
    const baseAjustada = 3000 - 2 * 189.59;
    // 2620.82 × 7.5% - 169.44 = 27.12
    const esperado = r2(baseAjustada * 0.075 - 169.44);
    expect(ir).toBeCloseTo(Math.max(esperado, 0), 1);
  });

  it("retorna 0 quando dependentes zeram a base", () => {
    expect(calcularIRRF(500, 5)).toBe(0);
  });
});

// ─── Rescisão — Sem Justa Causa ──────────────────────────────────────────────

describe("Rescisão — Sem Justa Causa", () => {
  const params: ParametrosRescisao = {
    dataAdmissao: "2020-03-15",
    dataDesligamento: "2025-01-20",
    salarioBruto: 5000,
    tipoRescisao: "sem_justa_causa",
    tipoContrato: "indeterminado",
    avisoPrevioTrabalhado: false,
    avisoPrevioIndenizado: true,
    feriasVencidas: false,
  };

  it("calcula saldo de salário corretamente", () => {
    const resultado = calcularRescisao(params);
    const saldoSalario = resultado.verbas.find(v => v.descricao.includes("Saldo de Salário"));
    expect(saldoSalario).toBeDefined();
    // 20 dias / 30 × 5000 = 3333.33
    expect(saldoSalario!.valor).toBeCloseTo(3333.33, 1);
  });

  it("calcula aviso prévio proporcional (Lei 12.506/2011)", () => {
    const resultado = calcularRescisao(params);
    // 4 anos completos → 30 + 4×3 = 42 dias
    expect(resultado.diasAvisoPrevio).toBe(42);
    // 42/30 × 5000 = 7000
    expect(resultado.valorAvisoPrevio).toBeCloseTo(7000, 0);
  });

  it("calcula 13º proporcional", () => {
    const resultado = calcularRescisao(params);
    const decimo = resultado.verbas.find(v => v.descricao.includes("13º Salário"));
    expect(decimo).toBeDefined();
    expect(decimo!.valor).toBeGreaterThan(0);
  });

  it("calcula férias proporcionais + 1/3", () => {
    const resultado = calcularRescisao(params);
    const ferias = resultado.verbas.find(v => v.descricao.includes("Férias Proporcionais"));
    const terco = resultado.verbas.find(v => v.descricao.includes("1/3 Constitucional sobre Férias Proporcionais"));
    expect(ferias).toBeDefined();
    expect(terco).toBeDefined();
    // O 1/3 deve ser exatamente 1/3 das férias
    expect(terco!.valor).toBeCloseTo(ferias!.valor / 3, 1);
  });

  it("calcula multa de 40% do FGTS", () => {
    const resultado = calcularRescisao(params);
    expect(resultado.multaFGTS).toBeGreaterThan(0);
    // Multa deve ser 40% do saldo
    expect(resultado.multaFGTS).toBeCloseTo(resultado.saldoFGTSEstimado * 0.40, 0);
  });

  it("calcula INSS e IRRF como descontos", () => {
    const resultado = calcularRescisao(params);
    expect(resultado.inss).toBeGreaterThan(0);
    expect(resultado.totalDescontos).toBeGreaterThan(0);
  });

  it("valor líquido = proventos - descontos", () => {
    const resultado = calcularRescisao(params);
    expect(resultado.valorLiquido).toBeCloseTo(resultado.totalProventos - resultado.totalDescontos, 1);
  });

  it("gera protocolo de cálculo", () => {
    const resultado = calcularRescisao(params);
    expect(resultado.protocoloCalculo).toMatch(/^TRAB-RES-/);
  });

  it("calcula tempo de serviço corretamente", () => {
    const resultado = calcularRescisao(params);
    expect(resultado.tempoServico.anos).toBe(4);
    expect(resultado.tempoServico.meses).toBe(10);
  });
});

// ─── Rescisão — Pedido de Demissão ───────────────────────────────────────────

describe("Rescisão — Pedido de Demissão", () => {
  const params: ParametrosRescisao = {
    dataAdmissao: "2022-06-01",
    dataDesligamento: "2025-02-15",
    salarioBruto: 3500,
    tipoRescisao: "pedido_demissao",
    tipoContrato: "indeterminado",
    avisoPrevioTrabalhado: true,
    avisoPrevioIndenizado: false,
    feriasVencidas: false,
  };

  it("NÃO inclui aviso prévio indenizado", () => {
    const resultado = calcularRescisao(params);
    const aviso = resultado.verbas.find(v => v.descricao.includes("Aviso Prévio"));
    expect(aviso).toBeUndefined();
    expect(resultado.diasAvisoPrevio).toBe(0);
  });

  it("NÃO inclui multa FGTS", () => {
    const resultado = calcularRescisao(params);
    expect(resultado.multaFGTS).toBe(0);
  });

  it("inclui 13º proporcional", () => {
    const resultado = calcularRescisao(params);
    const decimo = resultado.verbas.find(v => v.descricao.includes("13º Salário"));
    expect(decimo).toBeDefined();
  });

  it("inclui férias proporcionais + 1/3", () => {
    const resultado = calcularRescisao(params);
    const ferias = resultado.verbas.find(v => v.descricao.includes("Férias Proporcionais"));
    expect(ferias).toBeDefined();
  });
});

// ─── Rescisão — Justa Causa ──────────────────────────────────────────────────

describe("Rescisão — Justa Causa", () => {
  const params: ParametrosRescisao = {
    dataAdmissao: "2021-01-10",
    dataDesligamento: "2025-03-05",
    salarioBruto: 4000,
    tipoRescisao: "justa_causa",
    tipoContrato: "indeterminado",
    avisoPrevioTrabalhado: false,
    avisoPrevioIndenizado: false,
    feriasVencidas: true,
    periodosFeriasVencidas: 1,
  };

  it("NÃO inclui 13º proporcional", () => {
    const resultado = calcularRescisao(params);
    const decimo = resultado.verbas.find(v => v.descricao.includes("13º Salário"));
    expect(decimo).toBeUndefined();
  });

  it("NÃO inclui férias proporcionais", () => {
    const resultado = calcularRescisao(params);
    const ferias = resultado.verbas.find(v => v.descricao.includes("Férias Proporcionais"));
    expect(ferias).toBeUndefined();
  });

  it("NÃO inclui aviso prévio", () => {
    const resultado = calcularRescisao(params);
    expect(resultado.diasAvisoPrevio).toBe(0);
  });

  it("NÃO inclui multa FGTS", () => {
    const resultado = calcularRescisao(params);
    expect(resultado.multaFGTS).toBe(0);
  });

  it("inclui saldo de salário", () => {
    const resultado = calcularRescisao(params);
    const saldo = resultado.verbas.find(v => v.descricao.includes("Saldo de Salário"));
    expect(saldo).toBeDefined();
    expect(saldo!.valor).toBeGreaterThan(0);
  });

  it("inclui férias vencidas + 1/3", () => {
    const resultado = calcularRescisao(params);
    const feriasVencidas = resultado.verbas.find(v => v.descricao.includes("Férias Vencidas"));
    expect(feriasVencidas).toBeDefined();
    expect(feriasVencidas!.valor).toBeCloseTo(4000, 0);
  });
});

// ─── Rescisão — Acordo Mútuo ─────────────────────────────────────────────────

describe("Rescisão — Acordo Mútuo (art. 484-A CLT)", () => {
  const params: ParametrosRescisao = {
    dataAdmissao: "2019-07-01",
    dataDesligamento: "2025-01-31",
    salarioBruto: 6000,
    tipoRescisao: "acordo_mutuo",
    tipoContrato: "indeterminado",
    avisoPrevioTrabalhado: false,
    avisoPrevioIndenizado: true,
    feriasVencidas: false,
  };

  it("calcula aviso prévio com 50% (metade)", () => {
    const resultado = calcularRescisao(params);
    const aviso = resultado.verbas.find(v => v.descricao.includes("Aviso Prévio"));
    expect(aviso).toBeDefined();
    expect(aviso!.descricao).toContain("50%");
  });

  it("calcula multa de 20% do FGTS (metade dos 40%)", () => {
    const resultado = calcularRescisao(params);
    expect(resultado.multaFGTS).toBeGreaterThan(0);
    expect(resultado.multaFGTS).toBeCloseTo(resultado.saldoFGTSEstimado * 0.20, 0);
  });

  it("inclui 13º e férias integrais", () => {
    const resultado = calcularRescisao(params);
    const decimo = resultado.verbas.find(v => v.descricao.includes("13º Salário"));
    expect(decimo).toBeDefined();
  });
});

// ─── Rescisão — Férias Vencidas em Dobro ─────────────────────────────────────

describe("Rescisão — Férias Vencidas em Dobro", () => {
  it("calcula férias em dobro quando há 2 períodos vencidos", () => {
    const params: ParametrosRescisao = {
      dataAdmissao: "2018-01-01",
      dataDesligamento: "2025-02-28",
      salarioBruto: 3000,
      tipoRescisao: "sem_justa_causa",
      tipoContrato: "indeterminado",
      avisoPrevioTrabalhado: false,
      avisoPrevioIndenizado: true,
      feriasVencidas: true,
      periodosFeriasVencidas: 2,
    };

    const resultado = calcularRescisao(params);
    const feriasVencidas = resultado.verbas.filter(v => v.descricao.includes("Férias Vencidas"));
    const feriasDobro = resultado.verbas.filter(v => v.descricao.includes("Dobro"));

    // Deve ter pelo menos 1 período normal e 1 em dobro
    expect(feriasVencidas.length + feriasDobro.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Rescisão — Com Adicionais ───────────────────────────────────────────────

describe("Rescisão — Com Médias de Adicionais", () => {
  it("inclui média de horas extras na remuneração", () => {
    const params: ParametrosRescisao = {
      dataAdmissao: "2022-01-01",
      dataDesligamento: "2025-01-15",
      salarioBruto: 4000,
      tipoRescisao: "sem_justa_causa",
      tipoContrato: "indeterminado",
      avisoPrevioTrabalhado: false,
      avisoPrevioIndenizado: true,
      feriasVencidas: false,
      mediaHorasExtras: 800,
      mediaComissoes: 500,
    };

    const resultado = calcularRescisao(params);
    // Saldo de salário deve ser baseado em 4000 + 800 + 500 = 5300
    const saldo = resultado.verbas.find(v => v.descricao.includes("Saldo de Salário"));
    expect(saldo).toBeDefined();
    // 15/30 × 5300 = 2650
    expect(saldo!.valor).toBeCloseTo(2650, 0);
  });
});

// ─── Horas Extras ────────────────────────────────────────────────────────────

describe("Cálculo de Horas Extras", () => {
  const params: ParametrosHorasExtras = {
    salarioBruto: 3000,
    cargaHorariaMensal: 220,
    periodos: [
      { mesAno: "2024-10", horasExtras50: 20, horasExtras100: 4 },
      { mesAno: "2024-11", horasExtras50: 15, horasExtras100: 8 },
      { mesAno: "2024-12", horasExtras50: 25, horasExtras100: 6 },
    ],
    incluirAdicionalNoturno: false,
  };

  it("calcula valor da hora normal corretamente", () => {
    const resultado = calcularHorasExtras(params);
    // 3000 / 220 = 13.64
    expect(resultado.valorHoraNormal).toBeCloseTo(13.64, 1);
  });

  it("calcula valor da hora extra 50% corretamente", () => {
    const resultado = calcularHorasExtras(params);
    // 13.64 × 1.5 = 20.45
    expect(resultado.valorHoraExtra50).toBeCloseTo(20.45, 1);
  });

  it("calcula valor da hora extra 100% corretamente", () => {
    const resultado = calcularHorasExtras(params);
    // 13.64 × 2.0 = 27.27
    expect(resultado.valorHoraExtra100).toBeCloseTo(27.27, 1);
  });

  it("totaliza horas extras corretamente", () => {
    const resultado = calcularHorasExtras(params);
    expect(resultado.totalHorasExtras50).toBe(60); // 20 + 15 + 25
    expect(resultado.totalHorasExtras100).toBe(18); // 4 + 8 + 6
  });

  it("calcula total geral de horas extras", () => {
    const resultado = calcularHorasExtras(params);
    // 60 × 20.45 + 18 × 27.27 = 1227 + 490.86 = ~1717.86
    expect(resultado.totalGeral).toBeGreaterThan(1700);
    expect(resultado.totalGeral).toBeLessThan(1750);
  });

  it("gera detalhamento por período", () => {
    const resultado = calcularHorasExtras(params);
    expect(resultado.detalhamentoPeriodos).toHaveLength(3);
    expect(resultado.detalhamentoPeriodos[0].mesAno).toBe("2024-10");
    expect(resultado.detalhamentoPeriodos[0].totalPeriodo).toBeGreaterThan(0);
  });

  it("calcula reflexos (férias, 13º, FGTS, DSR)", () => {
    const resultado = calcularHorasExtras(params);
    expect(resultado.reflexos.reflexoFerias).toBeGreaterThan(0);
    expect(resultado.reflexos.reflexo13Salario).toBeGreaterThan(0);
    expect(resultado.reflexos.reflexoFGTS).toBeGreaterThan(0);
    expect(resultado.reflexos.reflexoDSR).toBeGreaterThan(0);
    expect(resultado.reflexos.totalReflexos).toBeCloseTo(
      resultado.reflexos.reflexoFerias +
      resultado.reflexos.reflexo13Salario +
      resultado.reflexos.reflexoFGTS +
      resultado.reflexos.reflexoDSR,
      1
    );
  });

  it("total com reflexos = total geral + total reflexos", () => {
    const resultado = calcularHorasExtras(params);
    expect(resultado.totalComReflexos).toBeCloseTo(
      resultado.totalGeral + resultado.reflexos.totalReflexos,
      1
    );
  });

  it("gera protocolo de cálculo", () => {
    const resultado = calcularHorasExtras(params);
    expect(resultado.protocoloCalculo).toMatch(/^TRAB-HE-/);
  });
});

// ─── Horas Extras com Adicional Noturno ──────────────────────────────────────

describe("Horas Extras — Adicional Noturno", () => {
  it("calcula adicional noturno de 20%", () => {
    const params: ParametrosHorasExtras = {
      salarioBruto: 4000,
      cargaHorariaMensal: 220,
      periodos: [
        { mesAno: "2024-12", horasExtras50: 10, horasExtras100: 0, horasNoturnas: 40 },
      ],
      incluirAdicionalNoturno: true,
    };

    const resultado = calcularHorasExtras(params);
    // Hora normal: 4000/220 = 18.18
    // Adicional noturno: 40 × 18.18 × 0.20 = 145.45
    expect(resultado.totalAdicionalNoturno).toBeGreaterThan(140);
    expect(resultado.totalAdicionalNoturno).toBeLessThan(150);
    expect(resultado.totalHorasNoturnas).toBe(40);
  });

  it("NÃO calcula adicional noturno quando desabilitado", () => {
    const params: ParametrosHorasExtras = {
      salarioBruto: 4000,
      cargaHorariaMensal: 220,
      periodos: [
        { mesAno: "2024-12", horasExtras50: 10, horasExtras100: 0, horasNoturnas: 40 },
      ],
      incluirAdicionalNoturno: false,
    };

    const resultado = calcularHorasExtras(params);
    expect(resultado.totalAdicionalNoturno).toBe(0);
    expect(resultado.totalHorasNoturnas).toBe(0);
  });
});

// ─── Horas Extras com Salário Variável por Período ───────────────────────────

describe("Horas Extras — Salário Variável por Período", () => {
  it("usa salário específico de cada período quando informado", () => {
    const params: ParametrosHorasExtras = {
      salarioBruto: 3000,
      cargaHorariaMensal: 220,
      periodos: [
        { mesAno: "2024-10", horasExtras50: 10, horasExtras100: 0, salarioBase: 2500 },
        { mesAno: "2024-11", horasExtras50: 10, horasExtras100: 0, salarioBase: 3500 },
      ],
      incluirAdicionalNoturno: false,
    };

    const resultado = calcularHorasExtras(params);
    const p1 = resultado.detalhamentoPeriodos[0];
    const p2 = resultado.detalhamentoPeriodos[1];

    // Período 1: 2500/220 = 11.36 → 11.36 × 1.5 × 10 = 170.45
    expect(p1.salarioBase).toBe(2500);
    expect(p1.valorHoraNormal).toBeCloseTo(11.36, 1);

    // Período 2: 3500/220 = 15.91 → 15.91 × 1.5 × 10 = 238.64
    expect(p2.salarioBase).toBe(3500);
    expect(p2.valorHoraNormal).toBeCloseTo(15.91, 1);

    // Total deve ser diferente de usar salário fixo
    expect(p1.totalPeriodo).toBeLessThan(p2.totalPeriodo);
  });
});

// ─── Cenários de Borda ───────────────────────────────────────────────────────

describe("Cenários de Borda", () => {
  it("rescisão com 1 dia de trabalho", () => {
    const params: ParametrosRescisao = {
      dataAdmissao: "2025-01-01",
      dataDesligamento: "2025-01-01",
      salarioBruto: 3000,
      tipoRescisao: "sem_justa_causa",
      tipoContrato: "experiencia",
      avisoPrevioTrabalhado: false,
      avisoPrevioIndenizado: false,
      feriasVencidas: false,
    };

    const resultado = calcularRescisao(params);
    expect(resultado.tempoServico.totalDias).toBe(0);
    expect(resultado.valorLiquido).toBeGreaterThanOrEqual(0);
  });

  it("horas extras com apenas 1 período", () => {
    const params: ParametrosHorasExtras = {
      salarioBruto: 1518,
      cargaHorariaMensal: 220,
      periodos: [
        { mesAno: "2025-01", horasExtras50: 5, horasExtras100: 0 },
      ],
      incluirAdicionalNoturno: false,
    };

    const resultado = calcularHorasExtras(params);
    expect(resultado.detalhamentoPeriodos).toHaveLength(1);
    expect(resultado.totalGeral).toBeGreaterThan(0);
  });

  it("rescisão com salário alto (acima do teto INSS)", () => {
    const params: ParametrosRescisao = {
      dataAdmissao: "2020-01-01",
      dataDesligamento: "2025-01-15",
      salarioBruto: 15000,
      tipoRescisao: "sem_justa_causa",
      tipoContrato: "indeterminado",
      avisoPrevioTrabalhado: false,
      avisoPrevioIndenizado: true,
      feriasVencidas: false,
    };

    const resultado = calcularRescisao(params);
    // INSS deve estar limitado ao teto
    expect(resultado.inss).toBeLessThan(2000); // Teto INSS ~950
    expect(resultado.totalProventos).toBeGreaterThan(0);
  });

  it("aviso prévio máximo de 90 dias (30 + 60)", () => {
    const params: ParametrosRescisao = {
      dataAdmissao: "2000-01-01",
      dataDesligamento: "2025-01-31",
      salarioBruto: 5000,
      tipoRescisao: "sem_justa_causa",
      tipoContrato: "indeterminado",
      avisoPrevioTrabalhado: false,
      avisoPrevioIndenizado: true,
      feriasVencidas: false,
    };

    const resultado = calcularRescisao(params);
    // 25 anos → 30 + min(25×3, 60) = 30 + 60 = 90
    expect(resultado.diasAvisoPrevio).toBe(90);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// VALIDAÇÃO DE FÓRMULAS — Rescisão
//
// Testes de precisão com valores derivados direto do fundamento legal
// (CLT, CF, Lei 12.506/2011, Súmulas TST). Falhas aqui indicam desvio
// do entendimento jurídico vigente.
// ═════════════════════════════════════════════════════════════════════════════

describe("Rescisão — Rescisão Indireta (art. 483 CLT)", () => {
  it("tem os mesmos direitos de sem justa causa: aviso prévio, 13º, férias, FGTS 40%", () => {
    const params: ParametrosRescisao = {
      dataAdmissao: "2021-01-01",
      dataDesligamento: "2024-12-31",
      salarioBruto: 4000,
      tipoRescisao: "rescisao_indireta",
      tipoContrato: "indeterminado",
      avisoPrevioTrabalhado: false,
      avisoPrevioIndenizado: true,
      feriasVencidas: false,
    };

    const resultado = calcularRescisao(params);

    // Aviso prévio devido
    expect(resultado.diasAvisoPrevio).toBeGreaterThanOrEqual(30);
    expect(resultado.valorAvisoPrevio).toBeGreaterThan(0);

    // 13º proporcional devido (dezembro inteiro)
    const tem13 = resultado.verbas.some((v) => v.descricao.includes("13º"));
    expect(tem13).toBe(true);

    // Férias proporcionais devidas
    const temFerias = resultado.verbas.some((v) =>
      v.descricao.toLowerCase().includes("férias proporcionais"),
    );
    expect(temFerias).toBe(true);

    // FGTS com multa 40%
    expect(resultado.multaFGTS).toBeGreaterThan(0);
    expect(resultado.multaFGTS).toBeCloseTo(resultado.saldoFGTSEstimado * 0.4, 1);
  });

  it("aviso prévio proporcional conforme Lei 12.506/2011 (3 dias por ano)", () => {
    // 4 anos completos → 30 + 4×3 = 42 dias
    const params: ParametrosRescisao = {
      dataAdmissao: "2021-01-01",
      dataDesligamento: "2024-12-31",
      salarioBruto: 4000,
      tipoRescisao: "rescisao_indireta",
      tipoContrato: "indeterminado",
      avisoPrevioTrabalhado: false,
      avisoPrevioIndenizado: true,
      feriasVencidas: false,
    };
    const resultado = calcularRescisao(params);
    // 3 anos e ~11 meses → engine usa tempoServico.anos que é 3
    // 30 + 3×3 = 39 dias
    expect(resultado.diasAvisoPrevio).toBe(39);
  });
});

describe("Rescisão — FGTS informado pelo usuário", () => {
  it("usa exatamente o valor informado (ignora estimativa)", () => {
    const params: ParametrosRescisao = {
      dataAdmissao: "2020-01-01",
      dataDesligamento: "2024-12-31",
      salarioBruto: 3000,
      tipoRescisao: "sem_justa_causa",
      tipoContrato: "indeterminado",
      avisoPrevioTrabalhado: false,
      avisoPrevioIndenizado: true,
      feriasVencidas: false,
      saldoFGTS: 12345.67,
    };
    const resultado = calcularRescisao(params);
    expect(resultado.fgtsInformado).toBe(true);
    expect(resultado.saldoFGTSEstimado).toBe(12345.67);
    expect(resultado.multaFGTS).toBeCloseTo(12345.67 * 0.4, 2);
    expect(resultado.totalFGTS).toBeCloseTo(12345.67 * 1.4, 2);
  });

  it("estima saldo quando usuário não informa", () => {
    const params: ParametrosRescisao = {
      dataAdmissao: "2020-01-01",
      dataDesligamento: "2024-12-31",
      salarioBruto: 3000,
      tipoRescisao: "sem_justa_causa",
      tipoContrato: "indeterminado",
      avisoPrevioTrabalhado: false,
      avisoPrevioIndenizado: true,
      feriasVencidas: false,
      // saldoFGTS omitido
    };
    const resultado = calcularRescisao(params);
    expect(resultado.fgtsInformado).toBe(false);
    expect(resultado.saldoFGTSEstimado).toBeGreaterThan(0);
  });

  it("saldoFGTS = 0 é tratado como 'não informado' (usa estimativa)", () => {
    // Comportamento atual: 0 é falsy, então > 0 falha na checagem
    const params: ParametrosRescisao = {
      dataAdmissao: "2020-01-01",
      dataDesligamento: "2024-12-31",
      salarioBruto: 3000,
      tipoRescisao: "sem_justa_causa",
      tipoContrato: "indeterminado",
      avisoPrevioTrabalhado: false,
      avisoPrevioIndenizado: true,
      feriasVencidas: false,
      saldoFGTS: 0,
    };
    const resultado = calcularRescisao(params);
    // Engine trata saldoFGTS 0 como "não informado" e estima
    expect(resultado.fgtsInformado).toBe(false);
  });
});

describe("Rescisão — Projeção do aviso prévio afeta 13º e férias", () => {
  it("aviso indenizado projeta data → avos13 diferente do desligamento cru", () => {
    // Admissão 2023-01-01, desligamento em 10/06/2024 (dia 10, < 15 → não
    // conta junho). Sem aviso: mês projetado = maio (5 avos). Com aviso
    // indenizado (30 dias): projeta pra 10/07 (dia 10 < 15 → mês junho = 6
    // avos). Um mês a mais no cálculo do 13º.
    const baseParams = {
      dataAdmissao: "2023-01-01",
      dataDesligamento: "2024-06-10",
      salarioBruto: 3000,
      tipoContrato: "indeterminado" as const,
      feriasVencidas: false,
      avisoPrevioTrabalhado: false,
    };

    const semAviso = calcularRescisao({
      ...baseParams,
      tipoRescisao: "pedido_demissao",
      avisoPrevioIndenizado: false,
    });
    const comAviso = calcularRescisao({
      ...baseParams,
      tipoRescisao: "sem_justa_causa",
      avisoPrevioIndenizado: true,
    });

    // Matcher estrito: "13º Salário" (evita casar com "INSS ... 13º")
    const verba13Sem = semAviso.verbas.find((v) =>
      v.descricao.startsWith("13º Salário"),
    );
    const verba13Com = comAviso.verbas.find((v) =>
      v.descricao.startsWith("13º Salário"),
    );

    expect(verba13Sem).toBeDefined();
    expect(verba13Com).toBeDefined();
    // 13º com projeção de aviso deve ser estritamente maior
    expect(verba13Com!.valor).toBeGreaterThan(verba13Sem!.valor);
  });
});

describe("Rescisão — INSS e IRRF aplicam-se separadamente a saldo e 13º", () => {
  it("INSS é calculado em duas bases: saldo de salário e 13º (com tetos separados)", () => {
    const params: ParametrosRescisao = {
      dataAdmissao: "2020-01-01",
      dataDesligamento: "2024-12-31",
      salarioBruto: 6000,
      tipoRescisao: "sem_justa_causa",
      tipoContrato: "indeterminado",
      avisoPrevioTrabalhado: false,
      avisoPrevioIndenizado: true,
      feriasVencidas: false,
    };
    const resultado = calcularRescisao(params);

    const saldo = resultado.verbas.find((v) => v.descricao.includes("Saldo"));
    const verba13 = resultado.verbas.find((v) => v.descricao.includes("13º"));
    expect(saldo).toBeDefined();
    expect(verba13).toBeDefined();

    // INSS total deve ser = INSS(saldo) + INSS(13º) — ambos calculados
    // com tabela progressiva INDEPENDENTE
    const inssSaldoManual = calcularINSS(saldo!.valor);
    const inss13Manual = calcularINSS(verba13!.valor);
    const inssEsperado = Math.round((inssSaldoManual + inss13Manual) * 100) / 100;
    expect(resultado.inss).toBeCloseTo(inssEsperado, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// VALIDAÇÃO DE FÓRMULAS — Horas Extras
//
// Testes específicos das súmulas TST que regem horas extras e seus
// reflexos. Falhas aqui significam divergência do entendimento consolidado.
// ═════════════════════════════════════════════════════════════════════════════

describe("Horas Extras — DSR sobre HE (Súmula 172 TST + OJ 394 SDI-1)", () => {
  it("DSR calculado por período = (HE do período ÷ dias úteis) × domingos", () => {
    // Outubro/2024: 31 dias, 4 domingos (6, 13, 20, 27) → 27 dias úteis
    const params: ParametrosHorasExtras = {
      salarioBruto: 2200, // R$ 10/h com carga 220
      cargaHorariaMensal: 220,
      periodos: [
        { mesAno: "2024-10", horasExtras50: 20, horasExtras100: 0 },
      ],
      incluirAdicionalNoturno: false,
    };
    const resultado = calcularHorasExtras(params);

    // Valor HE do período: 20h × 10 × 1.5 = R$ 300
    // DSR = 300 / 27 × 4 = 44.44
    const heDoMes = 20 * 10 * 1.5;
    const diasUteis = 27;
    const domingos = 4;
    const dsrEsperado = (heDoMes / diasUteis) * domingos;
    expect(resultado.reflexos.reflexoDSR).toBeCloseTo(dsrEsperado, 1);
  });

  it("DSR varia conforme o mês (4 vs 5 domingos)", () => {
    // Dezembro/2024: 31 dias, 5 domingos (1, 8, 15, 22, 29) → 26 dias úteis
    // vs Outubro/2024: 31 dias, 4 domingos → 27 dias úteis
    const mesComumHE = (mesAno: string): ParametrosHorasExtras => ({
      salarioBruto: 2200,
      cargaHorariaMensal: 220,
      periodos: [{ mesAno, horasExtras50: 20, horasExtras100: 0 }],
      incluirAdicionalNoturno: false,
    });

    const rOut = calcularHorasExtras(mesComumHE("2024-10"));
    const rDez = calcularHorasExtras(mesComumHE("2024-12"));

    // Dezembro tem mais domingos → DSR maior que outubro
    expect(rDez.reflexos.reflexoDSR).toBeGreaterThan(rOut.reflexos.reflexoDSR);
  });
});

describe("Horas Extras — Reflexo em FGTS (Súmula 63 TST)", () => {
  it("FGTS = 8% sobre (HE + DSR), não apenas HE", () => {
    const params: ParametrosHorasExtras = {
      salarioBruto: 2200,
      cargaHorariaMensal: 220,
      periodos: [{ mesAno: "2024-10", horasExtras50: 20, horasExtras100: 0 }],
      incluirAdicionalNoturno: false,
    };
    const r = calcularHorasExtras(params);
    const baseEsperada = r.totalGeral + r.reflexos.reflexoDSR;
    expect(r.reflexos.reflexoFGTS).toBeCloseTo(baseEsperada * 0.08, 1);
  });
});

describe("Horas Extras — Precisão absoluta (cenário simples)", () => {
  it("salário R$ 2200 / 220h → hora = R$ 10,00 exato", () => {
    const r = calcularHorasExtras({
      salarioBruto: 2200,
      cargaHorariaMensal: 220,
      periodos: [{ mesAno: "2024-06", horasExtras50: 0, horasExtras100: 0 }],
      incluirAdicionalNoturno: false,
    });
    expect(r.valorHoraNormal).toBe(10);
    expect(r.valorHoraExtra50).toBe(15);
    expect(r.valorHoraExtra100).toBe(20);
    expect(r.valorHoraNoturna).toBe(12); // adicional noturno 20%
  });

  it("10h extras a 50% = R$ 150,00 exato", () => {
    const r = calcularHorasExtras({
      salarioBruto: 2200,
      cargaHorariaMensal: 220,
      periodos: [{ mesAno: "2024-06", horasExtras50: 10, horasExtras100: 0 }],
      incluirAdicionalNoturno: false,
    });
    expect(r.totalValorHorasExtras).toBe(150);
  });

  it("adicional noturno = 20% × hora normal (Art. 73 CLT)", () => {
    const r = calcularHorasExtras({
      salarioBruto: 2200,
      cargaHorariaMensal: 220,
      periodos: [
        { mesAno: "2024-06", horasExtras50: 0, horasExtras100: 0, horasNoturnas: 50 },
      ],
      incluirAdicionalNoturno: true,
    });
    // 50h × R$10 × 0.2 = R$100
    expect(r.totalAdicionalNoturno).toBe(100);
  });
});

describe("Horas Extras — Cenários de borda", () => {
  it("período sem horas extras (apenas noturnas) calcula corretamente", () => {
    const r = calcularHorasExtras({
      salarioBruto: 3000,
      cargaHorariaMensal: 220,
      periodos: [
        { mesAno: "2024-06", horasExtras50: 0, horasExtras100: 0, horasNoturnas: 20 },
      ],
      incluirAdicionalNoturno: true,
    });
    expect(r.totalValorHorasExtras).toBe(0);
    expect(r.totalAdicionalNoturno).toBeGreaterThan(0);
  });

  it("mesAno com fevereiro (28 dias) funciona corretamente", () => {
    const r = calcularHorasExtras({
      salarioBruto: 2200,
      cargaHorariaMensal: 220,
      periodos: [{ mesAno: "2025-02", horasExtras50: 10, horasExtras100: 0 }],
      incluirAdicionalNoturno: false,
    });
    // Fev/2025: 28 dias, domingos: 2, 9, 16, 23 = 4 domingos, 24 dias úteis
    // DSR = 150 / 24 × 4 = 25
    expect(r.reflexos.reflexoDSR).toBeCloseTo(25, 1);
  });

  it("fevereiro bissexto (29 dias — 2024)", () => {
    const r = calcularHorasExtras({
      salarioBruto: 2200,
      cargaHorariaMensal: 220,
      periodos: [{ mesAno: "2024-02", horasExtras50: 10, horasExtras100: 0 }],
      incluirAdicionalNoturno: false,
    });
    // Fev/2024: 29 dias, domingos: 4, 11, 18, 25 = 4 domingos, 25 dias úteis
    // DSR = 150 / 25 × 4 = 24
    expect(r.reflexos.reflexoDSR).toBeCloseTo(24, 1);
  });
});
