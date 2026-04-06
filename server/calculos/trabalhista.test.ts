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
