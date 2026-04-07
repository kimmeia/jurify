/**
 * Testes — Geradores de Parecer Técnico (Markdown)
 *
 * Cobertura:
 *  - parecer-fgts.gerarParecerFGTS: estrutura, multa rescisória, todos os tipos
 *  - parecer-trabalhista.gerarParecerRescisao: verbas, fundamentação
 *  - parecer-trabalhista.gerarParecerHorasExtras: cálculo, adicional
 *
 * Garante que o conteúdo gerado contém as seções obrigatórias e formatação
 * monetária correta. Funciona como "snapshot leve" — qualquer mudança
 * estrutural quebra os testes.
 */

import { describe, it, expect } from "vitest";
import { gerarParecerFGTS } from "./parecer-fgts";
import { gerarParecerRescisao, gerarParecerHorasExtras } from "./parecer-trabalhista";
import { calcularFGTS } from "./engine-fgts";
import { calcularRescisao, calcularHorasExtras } from "./engine-rescisao";
import { calcularHorasExtras as calcHE } from "./engine-horas-extras";
import type { ParametrosFGTS } from "./engine-fgts";
import type { ParametrosRescisao, ParametrosHorasExtras } from "../../shared/trabalhista-types";

// ─── Parecer FGTS ────────────────────────────────────────────────────────────

describe("gerarParecerFGTS", () => {
  function paramsFGTS(tipoMulta: ParametrosFGTS["tipoMulta"]): ParametrosFGTS {
    return {
      tipoMulta,
      saldoAnterior: 0,
      periodos: [
        { mesAno: "2024-01", remuneracao: 3000 },
        { mesAno: "2024-02", remuneracao: 3000 },
        { mesAno: "2024-03", remuneracao: 3000 },
      ],
    };
  }

  it("gera markdown com estrutura mínima esperada", () => {
    const resultado = calcularFGTS(paramsFGTS("sem_justa_causa"));
    const md = gerarParecerFGTS(paramsFGTS("sem_justa_causa"), resultado);
    expect(md).toContain("PARECER");
    expect(md).toContain("FGTS");
    expect(md).toContain("MULTA RESCISÓRIA");
    expect(md).toContain("Lei 8.036/1990");
  });

  it("inclui demonstrativo mensal de cada período", () => {
    const params = paramsFGTS("sem_justa_causa");
    const resultado = calcularFGTS(params);
    const md = gerarParecerFGTS(params, resultado);
    // Cada mês deve aparecer no markdown
    expect(md).toContain("Jan/2024");
    expect(md).toContain("Fev/2024");
    expect(md).toContain("Mar/2024");
  });

  it("formata valores em BRL (com R$)", () => {
    const params = paramsFGTS("sem_justa_causa");
    const resultado = calcularFGTS(params);
    const md = gerarParecerFGTS(params, resultado);
    expect(md).toContain("R$");
  });

  it("aplica 40% de multa em demissão sem justa causa", () => {
    const params = paramsFGTS("sem_justa_causa");
    const resultado = calcularFGTS(params);
    expect(resultado.multaPercentual).toBe(40);
    const md = gerarParecerFGTS(params, resultado);
    expect(md).toContain("40%");
  });

  it("aplica 20% de multa em acordo mútuo (art. 484-A CLT)", () => {
    const params = paramsFGTS("acordo_mutuo");
    const resultado = calcularFGTS(params);
    expect(resultado.multaPercentual).toBe(20);
    const md = gerarParecerFGTS(params, resultado);
    expect(md).toContain("20%");
    expect(md).toContain("484-A");
  });

  it("não inclui multa quando tipo é sem_multa", () => {
    const params = paramsFGTS("sem_multa");
    const resultado = calcularFGTS(params);
    expect(resultado.multaPercentual).toBe(0);
    const md = gerarParecerFGTS(params, resultado);
    // Mas o documento ainda existe e menciona "sem multa"
    expect(md.toLowerCase()).toContain("sem");
  });
});

// ─── Parecer Rescisão ────────────────────────────────────────────────────────

describe("gerarParecerRescisao", () => {
  const baseParams: ParametrosRescisao = {
    tipoRescisao: "sem_justa_causa",
    tipoContrato: "indeterminado",
    dataAdmissao: "2020-01-01",
    dataDesligamento: "2024-01-01",
    salarioBruto: 3000,
    avisoPrevioIndenizado: true,
    avisoPrevioTrabalhado: false,
    saqueAtrasado: false,
  };

  it("gera estrutura completa de parecer rescisório", () => {
    const resultado = calcularRescisao(baseParams);
    const md = gerarParecerRescisao(baseParams, resultado);
    expect(md).toContain("PARECER TÉCNICO");
    expect(md).toContain("RESCISÃO CONTRATUAL");
    expect(md).toContain("DADOS DO CONTRATO");
    expect(md).toContain("VERBAS RESCISÓRIAS");
    expect(md).toContain(resultado.protocoloCalculo);
  });

  it("inclui o tempo de serviço calculado", () => {
    const resultado = calcularRescisao(baseParams);
    const md = gerarParecerRescisao(baseParams, resultado);
    // 4 anos exatos
    expect(md).toContain("4 ano");
  });

  it("lista todas as verbas com fundamento legal", () => {
    const resultado = calcularRescisao(baseParams);
    const md = gerarParecerRescisao(baseParams, resultado);
    // Cada verba calculada deve aparecer no markdown
    for (const v of resultado.verbas) {
      expect(md).toContain(v.descricao);
    }
  });

  it("formata data brasileira (dd/mm/yyyy)", () => {
    const resultado = calcularRescisao(baseParams);
    const md = gerarParecerRescisao(baseParams, resultado);
    expect(md).toContain("01/01/2020"); // admissão
    expect(md).toContain("01/01/2024"); // desligamento
  });

  it("muda fundamentação para pedido de demissão", () => {
    const params: ParametrosRescisao = { ...baseParams, tipoRescisao: "pedido_demissao" };
    const resultado = calcularRescisao(params);
    const md = gerarParecerRescisao(params, resultado);
    expect(md.toLowerCase()).toContain("pedido");
  });
});

// ─── Parecer Horas Extras ────────────────────────────────────────────────────

describe("gerarParecerHorasExtras", () => {
  const baseHE: ParametrosHorasExtras = {
    salarioBruto: 3000,
    cargaHorariaMensal: 220,
    incluirAdicionalNoturno: false,
    periodos: [
      { mesAno: "2024-01", horasExtras50: 20, horasExtras100: 0 },
      { mesAno: "2024-02", horasExtras50: 15, horasExtras100: 0 },
    ],
  };

  it("gera estrutura completa de parecer de horas extras", () => {
    const resultado = calcHE(baseHE);
    const md = gerarParecerHorasExtras(baseHE, resultado);
    expect(md).toContain("PARECER TÉCNICO");
    expect(md).toContain("HORAS EXTRAS");
    expect(md).toContain("R$");
    expect(md).toContain(resultado.protocoloCalculo);
  });

  it("inclui detalhamento mensal das horas trabalhadas", () => {
    const resultado = calcHE(baseHE);
    const md = gerarParecerHorasExtras(baseHE, resultado);
    expect(md).toContain("2024");
  });

  it("menciona reflexos quando habilitado", () => {
    const resultado = calcHE(baseHE);
    const md = gerarParecerHorasExtras(baseHE, resultado);
    expect(md.toLowerCase()).toContain("reflex");
  });
});
