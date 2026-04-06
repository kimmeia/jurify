/**
 * Testes extensivos do Engine de Cálculos Diversos
 */
import { describe, it, expect } from "vitest";
import {
  round2, round4, round6, round8,
  converterTaxaEfetiva,
  nominalParaEfetiva,
  efetivaParaNominal,
  converterTaxa,
  calcularTaxaReal,
  calcularJuros,
  calcularAtualizacaoMonetaria,
  calcularPrazoPrescricional,
  PRAZOS_PRESCRICIONAIS,
} from "./engine-calculos-diversos";
import type { IndiceVariacao } from "../../shared/calculos-diversos-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe("Funções auxiliares", () => {
  it("round2 arredonda para 2 casas decimais", () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.235)).toBe(1.24);
    expect(round2(0)).toBe(0);
    expect(round2(-1.555)).toBe(-1.55);
  });

  it("round4 arredonda para 4 casas decimais", () => {
    expect(round4(1.23456)).toBe(1.2346);
    expect(round4(0.00001)).toBe(0);
  });

  it("round6 arredonda para 6 casas decimais", () => {
    expect(round6(1.2345678)).toBe(1.234568);
  });

  it("round8 arredonda para 8 casas decimais", () => {
    expect(round8(1.123456789)).toBe(1.12345679);
  });
});

// ─── Conversão de Taxas Efetivas ─────────────────────────────────────────────

describe("Conversão de Taxas Efetivas", () => {
  it("mensal 1% → anual (juros compostos)", () => {
    // (1 + 0.01)^12 - 1 = 12.6825...%
    const resultado = converterTaxaEfetiva(1, "mensal", "anual");
    expect(resultado).toBeCloseTo(12.6825, 3);
  });

  it("anual 12% → mensal (juros compostos)", () => {
    // (1 + 0.12)^(1/12) - 1 = 0.9489...%
    const resultado = converterTaxaEfetiva(12, "anual", "mensal");
    expect(resultado).toBeCloseTo(0.9489, 3);
  });

  it("mensal 2% → anual", () => {
    // (1.02)^12 - 1 = 26.8242...%
    const resultado = converterTaxaEfetiva(2, "mensal", "anual");
    expect(resultado).toBeCloseTo(26.8242, 3);
  });

  it("anual 26.8242% → mensal deve retornar ~2%", () => {
    const resultado = converterTaxaEfetiva(26.8242, "anual", "mensal");
    expect(resultado).toBeCloseTo(2, 2);
  });

  it("diária 0.05% → mensal (365 dias)", () => {
    // (1.0005)^(365/12) - 1
    const resultado = converterTaxaEfetiva(0.05, "diaria", "mensal", "corridos");
    expect(resultado).toBeGreaterThan(1.5);
    expect(resultado).toBeLessThan(1.6);
  });

  it("diária 0.05% → anual (252 dias úteis)", () => {
    // (1.0005)^252 - 1
    const resultado = converterTaxaEfetiva(0.05, "diaria", "anual", "uteis");
    expect(resultado).toBeCloseTo(13.4, 0);
  });

  it("mensal → mensal retorna o mesmo valor", () => {
    const resultado = converterTaxaEfetiva(1.5, "mensal", "mensal");
    expect(resultado).toBeCloseTo(1.5, 6);
  });

  it("mensal 1% → semestral", () => {
    // (1.01)^6 - 1 = 6.1520...%
    const resultado = converterTaxaEfetiva(1, "mensal", "semestral");
    expect(resultado).toBeCloseTo(6.152, 2);
  });

  it("trimestral 3% → anual", () => {
    // (1.03)^4 - 1 = 12.5509...%
    const resultado = converterTaxaEfetiva(3, "trimestral", "anual");
    expect(resultado).toBeCloseTo(12.5509, 3);
  });

  it("semestral 5% → mensal", () => {
    // (1.05)^(1/6) - 1 = 0.8165...%
    const resultado = converterTaxaEfetiva(5, "semestral", "mensal");
    expect(resultado).toBeCloseTo(0.8165, 3);
  });
});

// ─── Nominal ↔ Efetiva ──────────────────────────────────────────────────────

describe("Conversão Nominal ↔ Efetiva", () => {
  it("nominal 12% a.a. capitalização mensal → efetiva anual", () => {
    // (1 + 0.12/12)^12 - 1 = (1.01)^12 - 1 = 12.6825%
    const resultado = nominalParaEfetiva(12, "anual", "mensal");
    expect(resultado).toBeCloseTo(12.6825, 3);
  });

  it("nominal 24% a.a. capitalização mensal → efetiva anual", () => {
    // (1 + 0.24/12)^12 - 1 = (1.02)^12 - 1 = 26.8242%
    const resultado = nominalParaEfetiva(24, "anual", "mensal");
    expect(resultado).toBeCloseTo(26.8242, 3);
  });

  it("nominal 6% a.s. capitalização mensal → efetiva semestral", () => {
    // (1 + 0.06/6)^6 - 1 = (1.01)^6 - 1 = 6.1520%
    const resultado = nominalParaEfetiva(6, "semestral", "mensal");
    expect(resultado).toBeCloseTo(6.152, 2);
  });

  it("efetiva 12.6825% a.a. → nominal a.a. capitalização mensal", () => {
    // 12 × [(1.126825)^(1/12) - 1] = 12 × 0.01 = 12%
    const resultado = efetivaParaNominal(12.6825, "anual", "mensal");
    expect(resultado).toBeCloseTo(12, 1);
  });

  it("efetiva 26.8242% a.a. → nominal a.a. capitalização mensal", () => {
    const resultado = efetivaParaNominal(26.8242, "anual", "mensal");
    expect(resultado).toBeCloseTo(24, 1);
  });

  it("ida e volta: nominal → efetiva → nominal deve preservar valor", () => {
    const efetiva = nominalParaEfetiva(18, "anual", "mensal");
    const nominal = efetivaParaNominal(efetiva, "anual", "mensal");
    expect(nominal).toBeCloseTo(18, 2);
  });
});

// ─── Função Principal converterTaxa ──────────────────────────────────────────

describe("Função converterTaxa (principal)", () => {
  it("efetiva mensal → efetiva anual", () => {
    const resultado = converterTaxa({
      taxaOriginal: 1,
      periodoOrigem: "mensal",
      periodoDestino: "anual",
      tipoOrigem: "efetiva",
      tipoDestino: "efetiva",
      baseDias: "corridos",
    });
    expect(resultado.taxaConvertida).toBeCloseTo(12.6825, 3);
    expect(resultado.detalhamento).toContain("Taxa original");
    expect(resultado.detalhamento).toContain("Taxa convertida");
  });

  it("nominal anual → efetiva mensal", () => {
    const resultado = converterTaxa({
      taxaOriginal: 12,
      periodoOrigem: "anual",
      periodoDestino: "mensal",
      tipoOrigem: "nominal",
      tipoDestino: "efetiva",
      baseDias: "corridos",
      capitalizacaoNominal: "mensal",
    });
    // Nominal 12% a.a. cap. mensal = efetiva 12.6825% a.a. → mensal = 1%
    expect(resultado.taxaConvertida).toBeCloseTo(1, 2);
  });

  it("efetiva anual → nominal anual cap. mensal", () => {
    const resultado = converterTaxa({
      taxaOriginal: 12.6825,
      periodoOrigem: "anual",
      periodoDestino: "anual",
      tipoOrigem: "efetiva",
      tipoDestino: "nominal",
      baseDias: "corridos",
      capitalizacaoNominal: "mensal",
    });
    expect(resultado.taxaConvertida).toBeCloseTo(12, 1);
  });

  it("mesmo período e tipo retorna mesmo valor", () => {
    const resultado = converterTaxa({
      taxaOriginal: 5.5,
      periodoOrigem: "mensal",
      periodoDestino: "mensal",
      tipoOrigem: "efetiva",
      tipoDestino: "efetiva",
      baseDias: "corridos",
    });
    expect(resultado.taxaConvertida).toBeCloseTo(5.5, 6);
  });

  it("inclui fórmula aplicada no resultado", () => {
    const resultado = converterTaxa({
      taxaOriginal: 2,
      periodoOrigem: "mensal",
      periodoDestino: "anual",
      tipoOrigem: "efetiva",
      tipoDestino: "efetiva",
      baseDias: "corridos",
    });
    expect(resultado.formulaAplicada.length).toBeGreaterThan(0);
    expect(resultado.detalhamento).toContain("Passos do cálculo");
  });
});

// ─── Taxa Real (Fisher) ─────────────────────────────────────────────────────

describe("Taxa Real (Fisher)", () => {
  it("taxa nominal 10%, inflação 4% → taxa real ~5.77%", () => {
    const resultado = calcularTaxaReal({ taxaNominal: 10, inflacao: 4 });
    // (1.10 / 1.04) - 1 = 0.05769...
    expect(resultado.taxaReal).toBeCloseTo(5.7692, 3);
  });

  it("taxa nominal igual à inflação → taxa real ~0%", () => {
    const resultado = calcularTaxaReal({ taxaNominal: 5, inflacao: 5 });
    expect(resultado.taxaReal).toBeCloseTo(0, 4);
  });

  it("taxa nominal menor que inflação → taxa real negativa", () => {
    const resultado = calcularTaxaReal({ taxaNominal: 3, inflacao: 6 });
    expect(resultado.taxaReal).toBeLessThan(0);
    // (1.03 / 1.06) - 1 = -0.02830...
    expect(resultado.taxaReal).toBeCloseTo(-2.8302, 3);
  });

  it("inflação zero → taxa real = taxa nominal", () => {
    const resultado = calcularTaxaReal({ taxaNominal: 8, inflacao: 0 });
    expect(resultado.taxaReal).toBeCloseTo(8, 4);
  });

  it("inclui fórmula no resultado", () => {
    const resultado = calcularTaxaReal({ taxaNominal: 12, inflacao: 5 });
    expect(resultado.formulaAplicada).toContain("i_real");
  });
});

// ─── Juros Simples e Compostos ───────────────────────────────────────────────

describe("Juros Simples", () => {
  it("C=1000, i=1% a.m., n=12 meses", () => {
    const resultado = calcularJuros({
      capital: 1000,
      taxa: 1,
      periodoTaxa: "mensal",
      prazo: 12,
      periodoPrazo: "mensal",
      tipo: "simples",
    });
    // J = 1000 × 0.01 × 12 = 120
    expect(resultado.juros).toBe(120);
    expect(resultado.montante).toBe(1120);
  });

  it("C=5000, i=2% a.m., n=6 meses", () => {
    const resultado = calcularJuros({
      capital: 5000,
      taxa: 2,
      periodoTaxa: "mensal",
      prazo: 6,
      periodoPrazo: "mensal",
      tipo: "simples",
    });
    expect(resultado.juros).toBe(600);
    expect(resultado.montante).toBe(5600);
  });

  it("evolução mensal tem o número correto de períodos", () => {
    const resultado = calcularJuros({
      capital: 1000,
      taxa: 1,
      periodoTaxa: "mensal",
      prazo: 12,
      periodoPrazo: "mensal",
      tipo: "simples",
    });
    expect(resultado.evolucaoMensal).toHaveLength(12);
    expect(resultado.evolucaoMensal[0].juros).toBe(10); // 1000 × 1%
    expect(resultado.evolucaoMensal[11].saldoFinal).toBe(1120);
  });

  it("juros constantes em cada período (simples)", () => {
    const resultado = calcularJuros({
      capital: 2000,
      taxa: 1.5,
      periodoTaxa: "mensal",
      prazo: 6,
      periodoPrazo: "mensal",
      tipo: "simples",
    });
    // Juros simples: juros constantes em cada período
    for (const ev of resultado.evolucaoMensal) {
      expect(ev.juros).toBe(30); // 2000 × 1.5%
    }
  });
});

describe("Juros Compostos", () => {
  it("C=1000, i=1% a.m., n=12 meses", () => {
    const resultado = calcularJuros({
      capital: 1000,
      taxa: 1,
      periodoTaxa: "mensal",
      prazo: 12,
      periodoPrazo: "mensal",
      tipo: "composto",
    });
    // M = 1000 × (1.01)^12 = 1126.83
    expect(resultado.montante).toBeCloseTo(1126.83, 1);
    expect(resultado.juros).toBeCloseTo(126.83, 1);
  });

  it("C=10000, i=10% a.a., n=3 anos", () => {
    const resultado = calcularJuros({
      capital: 10000,
      taxa: 10,
      periodoTaxa: "anual",
      prazo: 3,
      periodoPrazo: "anual",
      tipo: "composto",
    });
    // M = 10000 × (1.10)^3 = 13310
    expect(resultado.montante).toBeCloseTo(13310, 0);
  });

  it("juros crescentes em cada período (compostos)", () => {
    const resultado = calcularJuros({
      capital: 1000,
      taxa: 5,
      periodoTaxa: "mensal",
      prazo: 4,
      periodoPrazo: "mensal",
      tipo: "composto",
    });
    // Juros compostos: juros crescem a cada período
    for (let i = 1; i < resultado.evolucaoMensal.length; i++) {
      expect(resultado.evolucaoMensal[i].juros).toBeGreaterThan(resultado.evolucaoMensal[i - 1].juros);
    }
  });

  it("compostos > simples para mesmo capital/taxa/prazo", () => {
    const simples = calcularJuros({
      capital: 1000, taxa: 2, periodoTaxa: "mensal",
      prazo: 24, periodoPrazo: "mensal", tipo: "simples",
    });
    const composto = calcularJuros({
      capital: 1000, taxa: 2, periodoTaxa: "mensal",
      prazo: 24, periodoPrazo: "mensal", tipo: "composto",
    });
    expect(composto.montante).toBeGreaterThan(simples.montante);
  });

  it("conversão de prazo: taxa mensal com prazo anual", () => {
    const resultado = calcularJuros({
      capital: 1000,
      taxa: 1,
      periodoTaxa: "mensal",
      prazo: 1,
      periodoPrazo: "anual",
      tipo: "composto",
    });
    // n = 12 meses, M = 1000 × (1.01)^12
    expect(resultado.montante).toBeCloseTo(1126.83, 1);
  });

  it("inclui fórmula no resultado", () => {
    const resultado = calcularJuros({
      capital: 5000, taxa: 1, periodoTaxa: "mensal",
      prazo: 12, periodoPrazo: "mensal", tipo: "composto",
    });
    expect(resultado.formulaAplicada).toContain("M = C");
  });
});

// ─── Atualização Monetária ───────────────────────────────────────────────────

describe("Atualização Monetária", () => {
  const indicesMock: IndiceVariacao[] = [
    { data: "01/2023", variacao: 0.53, fatorAcumulado: 1 },
    { data: "02/2023", variacao: 0.84, fatorAcumulado: 1 },
    { data: "03/2023", variacao: 0.71, fatorAcumulado: 1 },
    { data: "04/2023", variacao: 0.61, fatorAcumulado: 1 },
    { data: "05/2023", variacao: 0.23, fatorAcumulado: 1 },
    { data: "06/2023", variacao: -0.08, fatorAcumulado: 1 },
  ];

  it("calcula correção com índices positivos", () => {
    const resultado = calcularAtualizacaoMonetaria(
      10000, "IPCA", "01/2023", "06/2023", indicesMock,
    );
    expect(resultado.valorCorrigido).toBeGreaterThan(10000);
    expect(resultado.correcaoMonetaria).toBeGreaterThan(0);
    expect(resultado.fatorCorrecao).toBeGreaterThan(1);
    expect(resultado.variacaoPercentual).toBeGreaterThan(0);
  });

  it("fator acumulado é produtório dos índices", () => {
    const resultado = calcularAtualizacaoMonetaria(
      1000, "IPCA", "01/2023", "06/2023", indicesMock,
    );
    // Fator manual: (1.0053)(1.0084)(1.0071)(1.0061)(1.0023)(0.9992)
    let fatorManual = 1;
    for (const idx of indicesMock) {
      fatorManual *= (1 + idx.variacao / 100);
    }
    expect(resultado.fatorCorrecao).toBeCloseTo(fatorManual, 6);
  });

  it("valor corrigido = original × fator", () => {
    const resultado = calcularAtualizacaoMonetaria(
      5000, "IGPM", "01/2023", "06/2023", indicesMock,
    );
    expect(resultado.valorCorrigido).toBeCloseTo(5000 * resultado.fatorCorrecao, 1);
  });

  it("sem juros de mora e sem multa por padrão", () => {
    const resultado = calcularAtualizacaoMonetaria(
      10000, "IPCA", "01/2023", "06/2023", indicesMock,
    );
    expect(resultado.jurosMora).toBe(0);
    expect(resultado.multa).toBe(0);
    expect(resultado.valorTotal).toBe(resultado.valorCorrigido);
  });

  it("aplica juros de mora corretamente", () => {
    const resultado = calcularAtualizacaoMonetaria(
      10000, "IPCA", "01/2023", "06/2023", indicesMock,
      true, 12, // 12% a.a. = 1% a.m.
    );
    // Juros = valorCorrigido × 1% × 6 meses
    const jurosMoraEsperado = round2(resultado.valorCorrigido * 0.01 * 6);
    expect(resultado.jurosMora).toBe(jurosMoraEsperado);
    expect(resultado.valorTotal).toBeGreaterThan(resultado.valorCorrigido);
  });

  it("aplica multa corretamente", () => {
    const resultado = calcularAtualizacaoMonetaria(
      10000, "IPCA", "01/2023", "06/2023", indicesMock,
      false, 12, true, 2,
    );
    const multaEsperada = round2(resultado.valorCorrigido * 0.02);
    expect(resultado.multa).toBe(multaEsperada);
  });

  it("aplica juros + multa juntos", () => {
    const resultado = calcularAtualizacaoMonetaria(
      10000, "IPCA", "01/2023", "06/2023", indicesMock,
      true, 12, true, 2,
    );
    expect(resultado.valorTotal).toBe(
      round2(resultado.valorCorrigido + resultado.jurosMora + resultado.multa)
    );
  });

  it("índices vazios retornam valor original", () => {
    const resultado = calcularAtualizacaoMonetaria(
      10000, "IPCA", "01/2023", "01/2023", [],
    );
    expect(resultado.valorCorrigido).toBe(10000);
    expect(resultado.fatorCorrecao).toBe(1);
    expect(resultado.correcaoMonetaria).toBe(0);
  });

  it("índice negativo reduz o valor", () => {
    const indicesNegativos: IndiceVariacao[] = [
      { data: "01/2023", variacao: -1.5, fatorAcumulado: 1 },
      { data: "02/2023", variacao: -0.5, fatorAcumulado: 1 },
    ];
    const resultado = calcularAtualizacaoMonetaria(
      10000, "IGPM", "01/2023", "02/2023", indicesNegativos,
    );
    expect(resultado.valorCorrigido).toBeLessThan(10000);
    expect(resultado.correcaoMonetaria).toBeLessThan(0);
  });

  it("detalhamento contém informações relevantes", () => {
    const resultado = calcularAtualizacaoMonetaria(
      10000, "SELIC", "01/2023", "06/2023", indicesMock,
    );
    expect(resultado.detalhamento).toContain("Valor original");
    expect(resultado.detalhamento).toContain("SELIC");
    expect(resultado.detalhamento).toContain("Fator de correção");
  });

  it("retorna índices com fator acumulado progressivo", () => {
    const resultado = calcularAtualizacaoMonetaria(
      10000, "IPCA", "01/2023", "06/2023", indicesMock,
    );
    // Fator acumulado deve ser crescente (com exceção de índices negativos)
    for (let i = 1; i < resultado.indices.length; i++) {
      if (resultado.indices[i].variacao >= 0) {
        expect(resultado.indices[i].fatorAcumulado).toBeGreaterThanOrEqual(
          resultado.indices[i - 1].fatorAcumulado * 0.99 // tolerância para negativos
        );
      }
    }
  });
});

// ─── Prazos Prescricionais ───────────────────────────────────────────────────

describe("Prazos Prescricionais", () => {
  it("lista de prazos contém todas as áreas", () => {
    const areas = new Set(PRAZOS_PRESCRICIONAIS.map(p => p.area));
    expect(areas.has("civil")).toBe(true);
    expect(areas.has("trabalhista")).toBe(true);
    expect(areas.has("tributario")).toBe(true);
    expect(areas.has("consumidor")).toBe(true);
    expect(areas.has("penal")).toBe(true);
  });

  it("todos os prazos têm fundamentação legal", () => {
    for (const prazo of PRAZOS_PRESCRICIONAIS) {
      expect(prazo.fundamentacao.length).toBeGreaterThan(0);
      expect(prazo.descricao.length).toBeGreaterThan(0);
    }
  });

  it("calcula prescrição futura corretamente", () => {
    // Fato gerador há 1 ano, prazo de 3 anos → não prescrito
    const umAnoAtras = new Date();
    umAnoAtras.setFullYear(umAnoAtras.getFullYear() - 1);
    const resultado = calcularPrazoPrescricional({
      area: "civil",
      tipoAcao: "civil_3_reparacao",
      dataFatoGerador: umAnoAtras.toISOString().split("T")[0],
    });
    expect(resultado.prescrito).toBe(false);
    expect(resultado.diasRestantes).toBeGreaterThan(0);
    expect(resultado.prazo.prazoAnos).toBe(3);
  });

  it("calcula prescrição passada corretamente", () => {
    // Fato gerador há 4 anos, prazo de 3 anos → prescrito
    const quatroAnosAtras = new Date();
    quatroAnosAtras.setFullYear(quatroAnosAtras.getFullYear() - 4);
    const resultado = calcularPrazoPrescricional({
      area: "civil",
      tipoAcao: "civil_3_reparacao",
      dataFatoGerador: quatroAnosAtras.toISOString().split("T")[0],
    });
    expect(resultado.prescrito).toBe(true);
    expect(resultado.diasRestantes).toBeLessThan(0);
  });

  it("suspensão adia a prescrição", () => {
    const doisAnosAtras = new Date();
    doisAnosAtras.setFullYear(doisAnosAtras.getFullYear() - 2);

    const semSuspensao = calcularPrazoPrescricional({
      area: "civil",
      tipoAcao: "civil_3_reparacao",
      dataFatoGerador: doisAnosAtras.toISOString().split("T")[0],
    });

    const comSuspensao = calcularPrazoPrescricional({
      area: "civil",
      tipoAcao: "civil_3_reparacao",
      dataFatoGerador: doisAnosAtras.toISOString().split("T")[0],
      suspensoes: [{ inicio: "2024-01-01", fim: "2024-07-01" }],
    });

    // Com suspensão deve ter mais dias restantes
    expect(comSuspensao.diasRestantes).toBeGreaterThan(semSuspensao.diasRestantes);
    expect(comSuspensao.totalDiasSuspensos).toBeGreaterThan(0);
  });

  it("prescrição trabalhista bienal (2 anos)", () => {
    const resultado = calcularPrazoPrescricional({
      area: "trabalhista",
      tipoAcao: "trab_2_bienal",
      dataFatoGerador: "2022-01-01",
    });
    expect(resultado.prazo.prazoAnos).toBe(2);
    expect(resultado.prescrito).toBe(true); // 2022 + 2 = 2024, já passou
  });

  it("prescrição tributária 5 anos", () => {
    const umAnoAtras = new Date();
    umAnoAtras.setFullYear(umAnoAtras.getFullYear() - 1);
    const resultado = calcularPrazoPrescricional({
      area: "tributario",
      tipoAcao: "trib_5_repeticao",
      dataFatoGerador: umAnoAtras.toISOString().split("T")[0],
    });
    expect(resultado.prazo.prazoAnos).toBe(5);
    expect(resultado.prescrito).toBe(false);
  });

  it("erro para tipo de ação inexistente", () => {
    expect(() => calcularPrazoPrescricional({
      area: "civil",
      tipoAcao: "inexistente",
      dataFatoGerador: "2023-01-01",
    })).toThrow("Prazo prescricional não encontrado");
  });

  it("erro para data inválida", () => {
    expect(() => calcularPrazoPrescricional({
      area: "civil",
      tipoAcao: "civil_3_reparacao",
      dataFatoGerador: "data-invalida",
    })).toThrow("Data do fato gerador inválida");
  });

  it("detalhamento contém informações completas", () => {
    const resultado = calcularPrazoPrescricional({
      area: "civil",
      tipoAcao: "civil_10_geral",
      dataFatoGerador: "2020-06-15",
    });
    expect(resultado.detalhamento).toContain("Art. 205, CC");
    expect(resultado.detalhamento).toContain("10 ano(s)");
    expect(resultado.detalhamento).toContain("Status:");
  });

  it("múltiplas suspensões são somadas", () => {
    const resultado = calcularPrazoPrescricional({
      area: "civil",
      tipoAcao: "civil_5_divida_liquida",
      dataFatoGerador: "2022-01-01",
      suspensoes: [
        { inicio: "2022-06-01", fim: "2022-09-01" }, // ~92 dias
        { inicio: "2023-01-01", fim: "2023-04-01" }, // ~90 dias
      ],
    });
    expect(resultado.suspensoes).toHaveLength(2);
    expect(resultado.totalDiasSuspensos).toBeGreaterThan(180);
  });
});
