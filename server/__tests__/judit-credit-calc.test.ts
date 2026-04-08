/**
 * Testes puros das funções de cálculo de créditos da Judit.
 *
 * Esse é um ponto CRÍTICO do sistema — bugs aqui cobram os usuários
 * de forma errada. Por isso testamos exaustivamente:
 *   - Caso feliz (consulta típica)
 *   - Zero resultados
 *   - Muitos resultados (cap)
 *   - Valores inválidos (negativos, NaN, Infinity)
 *   - Consistência entre o total e o extra (extra = total - base)
 */

import { describe, it, expect } from "vitest";
import {
  CUSTOS_JUDIT,
  calcularCustoConsultaHistorica,
  calcularCustoExtraConsultaHistorica,
  estimarCustoConsulta,
} from "../routers/judit-credit-calc";

describe("calcularCustoConsultaHistorica", () => {
  it("cobra apenas o base quando 0 processos encontrados", () => {
    expect(calcularCustoConsultaHistorica(0)).toBe(CUSTOS_JUDIT.consulta_historica_base);
  });

  it("cobra base + por_processo × count pra resultados pequenos", () => {
    // 5 processos = 3 base + 5×1 = 8
    expect(calcularCustoConsultaHistorica(5)).toBe(
      CUSTOS_JUDIT.consulta_historica_base + 5 * CUSTOS_JUDIT.consulta_historica_por_processo,
    );
  });

  it("cobra correto pra 30 processos (caso típico OAB)", () => {
    // 30 processos = 3 base + 30×1 = 33
    expect(calcularCustoConsultaHistorica(30)).toBe(33);
  });

  it("aplica o cap quando resultados excedem o máximo", () => {
    // 200 processos → seria 3 + 200 = 203, mas cap é 100
    expect(calcularCustoConsultaHistorica(200)).toBe(CUSTOS_JUDIT.consulta_historica_max);
  });

  it("aplica o cap exato em 97 processos (borda)", () => {
    // 97 processos = 3 + 97 = 100 (exatamente no cap)
    expect(calcularCustoConsultaHistorica(97)).toBe(100);
  });

  it("aplica o cap em 98 processos (passa 1 do cap)", () => {
    // 98 processos = 3 + 98 = 101 → cap em 100
    expect(calcularCustoConsultaHistorica(98)).toBe(100);
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
    // 5.9 → trunca pra 5 → 3 + 5 = 8
    expect(calcularCustoConsultaHistorica(5.9)).toBe(8);
  });
});

describe("calcularCustoExtraConsultaHistorica", () => {
  it("zero extra quando 0 processos", () => {
    expect(calcularCustoExtraConsultaHistorica(0)).toBe(0);
  });

  it("extra = total − base", () => {
    // 10 processos: total = 13, extra = 10
    expect(calcularCustoExtraConsultaHistorica(10)).toBe(10);
  });

  it("extra respeita o cap (máximo cap − base)", () => {
    // 200 processos: total = 100 (cap), extra = 97
    const capRestante =
      CUSTOS_JUDIT.consulta_historica_max - CUSTOS_JUDIT.consulta_historica_base;
    expect(calcularCustoExtraConsultaHistorica(200)).toBe(capRestante);
  });

  it("consistência: total = base + extra sempre", () => {
    // Verifica invariante pra vários valores
    for (const count of [0, 1, 5, 10, 50, 97, 100, 500]) {
      const total = calcularCustoConsultaHistorica(count);
      const extra = calcularCustoExtraConsultaHistorica(count);
      expect(extra).toBe(total - CUSTOS_JUDIT.consulta_historica_base);
    }
  });
});

describe("estimarCustoConsulta", () => {
  it("CNJ tem custo fixo de 1", () => {
    const r = estimarCustoConsulta("lawsuit_cnj");
    expect(r.min).toBe(1);
    expect(r.max).toBe(1);
    expect(r.tipico).toBe(1);
  });

  it("CPF tem min=base, max=teto", () => {
    const r = estimarCustoConsulta("cpf");
    expect(r.min).toBe(CUSTOS_JUDIT.consulta_historica_base);
    expect(r.max).toBe(CUSTOS_JUDIT.consulta_historica_max);
    expect(r.tipico).toBeGreaterThan(r.min);
    expect(r.tipico).toBeLessThan(r.max);
  });

  it("OAB tem estimativa típica maior que CPF", () => {
    const cpf = estimarCustoConsulta("cpf");
    const oab = estimarCustoConsulta("oab");
    // Advogado em geral tem mais processos que pessoa física
    expect(oab.tipico).toBeGreaterThan(cpf.tipico);
  });

  it("todas as buscas históricas mencionam o teto na mensagem", () => {
    for (const tipo of ["cpf", "cnpj", "oab", "name"] as const) {
      const r = estimarCustoConsulta(tipo);
      expect(r.mensagem).toContain("100"); // o cap
      expect(r.mensagem.toLowerCase()).toContain("crédito");
    }
  });
});

describe("CUSTOS_JUDIT constantes", () => {
  it("base nunca é maior que o max", () => {
    expect(CUSTOS_JUDIT.consulta_historica_base).toBeLessThan(CUSTOS_JUDIT.consulta_historica_max);
  });

  it("por_processo é positivo", () => {
    expect(CUSTOS_JUDIT.consulta_historica_por_processo).toBeGreaterThan(0);
  });

  it("consulta CNJ é a mais barata", () => {
    expect(CUSTOS_JUDIT.consulta_cnj).toBeLessThanOrEqual(
      CUSTOS_JUDIT.consulta_historica_base,
    );
  });

  it("monitorar pessoa é mais caro que monitorar processo individual", () => {
    expect(CUSTOS_JUDIT.monitorar_pessoa).toBeGreaterThan(CUSTOS_JUDIT.monitorar_processo);
  });
});
