/**
 * Testes puros das funções de cálculo de créditos da Judit.
 *
 * Esse é um ponto CRÍTICO do sistema — bugs aqui cobram os usuários
 * de forma errada. Por isso testamos exaustivamente:
 *   - Caso feliz (consulta típica)
 *   - Zero resultados
 *   - Muitos resultados (SEM cap — pay-as-you-go puro)
 *   - Valores inválidos (negativos, NaN, Infinity)
 *   - Consistência entre o total e o extra (extra = total - base)
 *   - Cobrança mensal de monitoramentos
 */

import { describe, it, expect } from "vitest";
import {
  CUSTOS_JUDIT,
  calcularCustoConsultaHistorica,
  calcularCustoExtraConsultaHistorica,
  calcularCustoMensalMonitoramentos,
  estimarCustoConsulta,
} from "../processos/credit-calc";

describe("calcularCustoConsultaHistorica", () => {
  it("cobra apenas o base quando 0 processos encontrados", () => {
    expect(calcularCustoConsultaHistorica(0)).toBe(CUSTOS_JUDIT.consulta_historica_base);
  });

  it("cobra base + 1 lote pra resultados pequenos (1-10)", () => {
    // 5 processos = 3 base + ceil(5/10)×1 = 3 + 1 = 4
    expect(calcularCustoConsultaHistorica(5)).toBe(
      CUSTOS_JUDIT.consulta_historica_base + CUSTOS_JUDIT.consulta_historica_por_lote_10,
    );
  });

  it("cobra exatos 10 processos = 1 lote (mesmo preço de 1 processo)", () => {
    // 10 processos = 3 + ceil(10/10)×1 = 3 + 1 = 4
    expect(calcularCustoConsultaHistorica(10)).toBe(4);
  });

  it("cobra 11 processos = 2 lotes (fronteira do arredondamento)", () => {
    // 11 processos = 3 + ceil(11/10)×1 = 3 + 2 = 5
    expect(calcularCustoConsultaHistorica(11)).toBe(5);
  });

  it("cobra correto pra 30 processos (caso típico OAB)", () => {
    // 30 processos = 3 + ceil(30/10)×1 = 3 + 3 = 6
    expect(calcularCustoConsultaHistorica(30)).toBe(6);
  });

  it("NÃO aplica cap — cobra pelo consumo real (500 processos)", () => {
    // 500 processos = 3 + ceil(500/10)×1 = 3 + 50 = 53. Sem cap.
    expect(calcularCustoConsultaHistorica(500)).toBe(53);
  });

  it("cobra pelo consumo real em 1000 processos", () => {
    // 1000 processos = 3 + ceil(1000/10)×1 = 3 + 100 = 103
    expect(calcularCustoConsultaHistorica(1000)).toBe(103);
  });

  it("trata valores negativos retornando base", () => {
    expect(calcularCustoConsultaHistorica(-5)).toBe(CUSTOS_JUDIT.consulta_historica_base);
  });

  it("trata NaN retornando base", () => {
    expect(calcularCustoConsultaHistorica(NaN)).toBe(CUSTOS_JUDIT.consulta_historica_base);
  });

  it("trata Infinity retornando base", () => {
    expect(calcularCustoConsultaHistorica(Infinity)).toBe(CUSTOS_JUDIT.consulta_historica_base);
  });

  it("trunca decimais", () => {
    // 5.9 → trunca pra 5 → 3 + ceil(5/10)×1 = 3 + 1 = 4
    expect(calcularCustoConsultaHistorica(5.9)).toBe(4);
  });
});

describe("calcularCustoExtraConsultaHistorica", () => {
  it("zero extra quando 0 processos", () => {
    expect(calcularCustoExtraConsultaHistorica(0)).toBe(0);
  });

  it("extra = total − base", () => {
    // 10 processos: total = 3 + 1 = 4, extra = 1
    expect(calcularCustoExtraConsultaHistorica(10)).toBe(1);
  });

  it("consistência: total = base + extra sempre", () => {
    for (const count of [0, 1, 5, 10, 50, 100, 500, 1000]) {
      const total = calcularCustoConsultaHistorica(count);
      const extra = calcularCustoExtraConsultaHistorica(count);
      expect(extra).toBe(total - CUSTOS_JUDIT.consulta_historica_base);
    }
  });
});

describe("calcularCustoMensalMonitoramentos", () => {
  it("zero quando não tem monitoramentos", () => {
    expect(calcularCustoMensalMonitoramentos(0, 0)).toBe(0);
  });

  it("cobra apenas processos quando só tem processos", () => {
    // 10 processos × 5 = 50
    expect(calcularCustoMensalMonitoramentos(10, 0)).toBe(
      10 * CUSTOS_JUDIT.monitorar_processo_mes,
    );
  });

  it("cobra apenas pessoas quando só tem pessoas", () => {
    // 5 pessoas × 35 = 175
    expect(calcularCustoMensalMonitoramentos(0, 5)).toBe(
      5 * CUSTOS_JUDIT.monitorar_pessoa_mes,
    );
  });

  it("cobra ambos somados", () => {
    // 10 processos (50) + 5 pessoas (175) = 225
    const esperado =
      10 * CUSTOS_JUDIT.monitorar_processo_mes + 5 * CUSTOS_JUDIT.monitorar_pessoa_mes;
    expect(calcularCustoMensalMonitoramentos(10, 5)).toBe(esperado);
  });

  it("trata valores negativos como 0", () => {
    expect(calcularCustoMensalMonitoramentos(-5, -3)).toBe(0);
  });

  it("trunca decimais", () => {
    // 10.7 → 10, 5.9 → 5 → 10×5 + 5×35
    const esperado =
      10 * CUSTOS_JUDIT.monitorar_processo_mes + 5 * CUSTOS_JUDIT.monitorar_pessoa_mes;
    expect(calcularCustoMensalMonitoramentos(10.7, 5.9)).toBe(esperado);
  });
});

describe("estimarCustoConsulta", () => {
  it("CNJ tem custo fixo de 1", () => {
    const r = estimarCustoConsulta("lawsuit_cnj");
    expect(r.min).toBe(1);
    expect(r.tipico).toBe(1);
  });

  it("CPF tem min=base, típico >= base", () => {
    const r = estimarCustoConsulta("cpf");
    expect(r.min).toBe(CUSTOS_JUDIT.consulta_historica_base);
    expect(r.tipico).toBeGreaterThanOrEqual(r.min);
  });

  it("OAB tem estimativa típica maior ou igual a CPF", () => {
    const cpf = estimarCustoConsulta("cpf");
    const oab = estimarCustoConsulta("oab");
    // Advogado em geral tem mais processos que pessoa física
    expect(oab.tipico).toBeGreaterThanOrEqual(cpf.tipico);
  });

  it("mensagem menciona os parâmetros de cobrança", () => {
    for (const tipo of ["cpf", "cnpj", "oab", "name"] as const) {
      const r = estimarCustoConsulta(tipo);
      expect(r.mensagem.toLowerCase()).toContain("crédito");
    }
  });
});

describe("CUSTOS_JUDIT constantes", () => {
  it("base é positivo", () => {
    expect(CUSTOS_JUDIT.consulta_historica_base).toBeGreaterThan(0);
  });

  it("por_lote_10 é positivo", () => {
    expect(CUSTOS_JUDIT.consulta_historica_por_lote_10).toBeGreaterThan(0);
  });

  it("consulta CNJ é a mais barata", () => {
    expect(CUSTOS_JUDIT.consulta_cnj).toBeLessThanOrEqual(
      CUSTOS_JUDIT.consulta_historica_base,
    );
  });

  it("monitorar pessoa mensal é mais caro que monitorar processo mensal", () => {
    expect(CUSTOS_JUDIT.monitorar_pessoa_mes).toBeGreaterThan(
      CUSTOS_JUDIT.monitorar_processo_mes,
    );
  });
});
