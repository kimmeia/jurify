/**
 * Testes — Engine Previdenciário
 *
 * Cobertura:
 *  - calcularResumoTC: soma de períodos, conversão especial→comum
 *  - simularAposentadoria: regras pré e pós-reforma, elegibilidade
 *  - calcularRMI: média de salários, fator previdenciário, tetos
 *  - calcularGPSAtraso: cálculo de atrasados com SELIC e multa
 *  - gerarProtocolo: formato consistente
 */

import { describe, it, expect } from "vitest";
import {
  calcularResumoTC,
  simularAposentadoria,
  calcularRMI,
  calcularGPSAtraso,
  gerarProtocolo,
} from "./engine-previdenciario";
import type {
  PeriodoContribuicao,
  ParametrosSimulacao,
  ParametrosRMI,
  ParametrosGPS,
} from "../../shared/previdenciario-types";
import { SALARIO_MINIMO_2026, TETO_INSS_2026 } from "../../shared/previdenciario-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function periodo(
  dataInicio: string,
  dataFim: string,
  tipoAtividade: PeriodoContribuicao["tipoAtividade"] = "URBANA_COMUM",
): PeriodoContribuicao {
  return {
    id: `${dataInicio}-${dataFim}`,
    dataInicio,
    dataFim,
    tipoAtividade,
    categoriaVinculo: "CLT",
  };
}

// ─── gerarProtocolo ──────────────────────────────────────────────────────────

describe("gerarProtocolo", () => {
  it("retorna formato PREV-YYYYMMDDHHMMSS-XXXXXX", () => {
    const p = gerarProtocolo();
    expect(p).toMatch(/^PREV-\d{14}-[A-Z0-9]{6}$/);
  });

  it("gera protocolos únicos em chamadas consecutivas", () => {
    const a = gerarProtocolo();
    const b = gerarProtocolo();
    expect(a).not.toBe(b);
  });
});

// ─── calcularResumoTC ────────────────────────────────────────────────────────

describe("calcularResumoTC", () => {
  it("soma um único período comum corretamente", () => {
    const r = calcularResumoTC([periodo("2010-01-01", "2020-01-01")], "M");
    // 10 anos = 120 meses
    expect(r.totalMesesComum).toBe(120);
    expect(r.totalMesesBruto).toBe(120);
  });

  it("soma múltiplos períodos comuns", () => {
    const r = calcularResumoTC(
      [periodo("2000-01-01", "2010-01-01"), periodo("2012-01-01", "2022-01-01")],
      "M",
    );
    expect(r.totalMesesComum).toBe(240); // 10 + 10 anos
  });

  it("ignora períodos com data fim anterior à data início", () => {
    const r = calcularResumoTC(
      [periodo("2020-01-01", "2010-01-01"), periodo("2000-01-01", "2010-01-01")],
      "M",
    );
    expect(r.totalMesesComum).toBe(120);
  });

  it("converte tempo especial para comum (homem, 25 anos)", () => {
    // Período especial 25 anos (insalubre comum) — fator 1.4 para homem
    const r = calcularResumoTC([periodo("2000-01-01", "2010-01-01", "URBANA_ESPECIAL_25")], "M");
    expect(r.totalMesesEspecial25).toBe(120);
    // 120 × 1.4 = 168 meses convertidos
    expect(r.totalMesesConvertido).toBeGreaterThanOrEqual(120);
    expect(r.conversoes.length).toBeGreaterThan(0);
  });

  it("converte tempo especial 25 anos diferente para mulher (fator 1.2)", () => {
    const rH = calcularResumoTC([periodo("2000-01-01", "2010-01-01", "URBANA_ESPECIAL_25")], "M");
    const rM = calcularResumoTC([periodo("2000-01-01", "2010-01-01", "URBANA_ESPECIAL_25")], "F");
    // Homem deve ter mais meses convertidos que mulher (fator maior)
    expect(rH.totalMesesConvertido).toBeGreaterThan(rM.totalMesesConvertido);
  });

  it("não converte tempo especial após 13/11/2019 (data da reforma)", () => {
    // Período totalmente após a reforma — não há conversão
    const r = calcularResumoTC([periodo("2020-01-01", "2025-01-01", "URBANA_ESPECIAL_25")], "M");
    expect(r.totalMesesEspecial25).toBe(60);
    // Sem conversão para esse trecho — totalConvertido pode ser igual ao bruto
    // (a EC 103/2019 vedou conversão de tempo especial pós-reforma)
    expect(r.conversoes.length).toBe(0);
  });

  it("contabiliza tempo rural separadamente", () => {
    const r = calcularResumoTC([periodo("2000-01-01", "2015-01-01", "RURAL")], "M");
    expect(r.totalMesesRural).toBe(180);
    expect(r.totalMesesComum).toBe(0);
  });
});

// ─── simularAposentadoria ────────────────────────────────────────────────────

describe("simularAposentadoria", () => {
  it("retorna ResultadoSimulacao com todas as regras avaliadas", () => {
    const params: ParametrosSimulacao = {
      sexo: "M",
      dataNascimento: "1965-01-01",
      periodos: [periodo("1985-01-01", "2025-01-01")],
    };
    const r = simularAposentadoria(params);
    expect(r.resumoTC.totalMesesComum).toBe(480); // 40 anos
    expect(Array.isArray(r.regras)).toBe(true);
    expect(r.regras.length).toBeGreaterThan(0);
    expect(r.protocoloCalculo).toMatch(/^PREV-/);
    expect(typeof r.parecerTecnico).toBe("string");
    expect(r.dataCalculo).toBeTruthy();
  });

  it("identifica elegibilidade quando o segurado já cumpriu requisitos", () => {
    // Homem nascido em 1955 (70 anos em 2025), 45 anos de contribuição
    const params: ParametrosSimulacao = {
      sexo: "M",
      dataNascimento: "1955-01-01",
      periodos: [periodo("1980-01-01", "2025-01-01")],
    };
    const r = simularAposentadoria(params);
    // Pelo menos uma regra deve ser elegível
    const elegiveis = r.regras.filter((rg) => rg.elegivel);
    expect(elegiveis.length).toBeGreaterThan(0);
  });

  it("identifica não elegibilidade para pessoa muito jovem", () => {
    const params: ParametrosSimulacao = {
      sexo: "F",
      dataNascimento: "2000-01-01",
      periodos: [periodo("2020-01-01", "2025-01-01")],
    };
    const r = simularAposentadoria(params);
    // Ninguém com 25 anos e 5 anos de contribuição se aposenta
    const elegiveis = r.regras.filter((rg) => rg.elegivel);
    expect(elegiveis.length).toBe(0);
  });
});

// ─── calcularRMI ─────────────────────────────────────────────────────────────

describe("calcularRMI", () => {
  it("calcula média correta de salários iguais", () => {
    const params: ParametrosRMI = {
      sexo: "M",
      dataNascimento: "1965-01-01",
      dataAposentadoria: "2025-01-01",
      tempoContribuicaoMeses: 480, // 40 anos
      salariosContribuicao: [3000, 3000, 3000, 3000, 3000],
      regraAplicavel: "PEDAGIO_100",
    };
    const r = calcularRMI(params);
    expect(r.mediaSalarios).toBe(3000);
    expect(r.rmi).toBe(3000); // PEDAGIO_100 paga 100%
  });

  it("limita RMI ao teto do INSS", () => {
    const params: ParametrosRMI = {
      sexo: "M",
      dataNascimento: "1965-01-01",
      dataAposentadoria: "2025-01-01",
      tempoContribuicaoMeses: 480,
      salariosContribuicao: [50000, 50000, 50000], // Acima do teto
      regraAplicavel: "PEDAGIO_100",
    };
    const r = calcularRMI(params);
    expect(r.rmiLimitada).toBe(TETO_INSS_2026);
  });

  it("aplica piso do salário mínimo quando RMI é muito baixa", () => {
    const params: ParametrosRMI = {
      sexo: "M",
      dataNascimento: "1965-01-01",
      dataAposentadoria: "2025-01-01",
      tempoContribuicaoMeses: 240,
      salariosContribuicao: [500, 500, 500], // Abaixo do mínimo
      regraAplicavel: "PEDAGIO_100",
    };
    const r = calcularRMI(params);
    expect(r.rmiLimitada).toBeGreaterThanOrEqual(SALARIO_MINIMO_2026);
  });

  it("rejeita lista de salários vazia", () => {
    const params: ParametrosRMI = {
      sexo: "M",
      dataNascimento: "1965-01-01",
      dataAposentadoria: "2025-01-01",
      tempoContribuicaoMeses: 240,
      salariosContribuicao: [],
      regraAplicavel: "PEDAGIO_100",
    };
    expect(() => calcularRMI(params)).toThrow(/Nenhum salário/);
  });

  it("retorna metadados (teto, piso, fundamentação)", () => {
    const params: ParametrosRMI = {
      sexo: "F",
      dataNascimento: "1970-01-01",
      dataAposentadoria: "2025-01-01",
      tempoContribuicaoMeses: 360,
      salariosContribuicao: [4000, 4500, 5000],
      regraAplicavel: "PONTOS",
    };
    const r = calcularRMI(params);
    expect(r.tetoINSS).toBe(TETO_INSS_2026);
    expect(r.pisoINSS).toBe(SALARIO_MINIMO_2026);
    expect(r.fundamentacao).toBeTruthy();
    expect(r.coeficiente).toBeGreaterThan(0);
  });
});

// ─── calcularGPSAtraso ───────────────────────────────────────────────────────

describe("calcularGPSAtraso", () => {
  it("calcula contribuições atrasadas com juros e multa", () => {
    const params: ParametrosGPS = {
      categoria: "CONTRIBUINTE_INDIVIDUAL",
      plano: "NORMAL",
      salarioContribuicao: 3000,
      competenciasAtrasadas: ["2023-01", "2023-02", "2023-03"],
      jaInscritoNoINSS: true,
      primeiraContribuicaoEmDia: true,
    };
    const r = calcularGPSAtraso(params);
    expect(r.linhas.length).toBe(3);
    expect(r.totalOriginal).toBeGreaterThan(0);
    expect(r.totalJuros).toBeGreaterThanOrEqual(0);
    expect(r.totalMulta).toBeGreaterThanOrEqual(0);
    // Plano NORMAL = 20% sobre salário
    expect(r.linhas[0].valorOriginal).toBeCloseTo(600, 0);
  });

  it("aplica alíquota menor para plano simplificado (11%)", () => {
    const params: ParametrosGPS = {
      categoria: "CONTRIBUINTE_INDIVIDUAL",
      plano: "SIMPLIFICADO",
      salarioContribuicao: 3000,
      competenciasAtrasadas: ["2024-01"],
      jaInscritoNoINSS: true,
      primeiraContribuicaoEmDia: true,
    };
    const r = calcularGPSAtraso(params);
    // 11% de 3000 = 330
    expect(r.linhas[0].valorOriginal).toBeCloseTo(330, 0);
  });
});
