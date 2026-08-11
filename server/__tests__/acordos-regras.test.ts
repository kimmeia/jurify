/**
 * Regras da negociação compartilhadas entre servidor e tela.
 *
 * O que se testa aqui não é aritmética — é o que a tela AFIRMA. "Parado há 31
 * dias" em vermelho e "esperando eles" são acusações sobre o trabalho de
 * alguém: se a dedução erra, o gestor cobra a pessoa errada.
 */

import { describe, expect, it } from "vitest";
import {
  DIAS_PARADO_ALERTA,
  descontoSobreOrigem,
  diasSemMovimento,
  estaParado,
  progressoNegociacao,
  vezDeQuem,
} from "../../shared/acordos";

const AGORA = new Date("2026-08-10T12:00:00Z");
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 86400000);

describe("diasSemMovimento", () => {
  it("conta dias inteiros", () => {
    expect(diasSemMovimento(diasAtras(31), AGORA)).toBe(31);
    expect(diasSemMovimento(diasAtras(1), AGORA)).toBe(1);
  });

  it("hoje é zero, não um", () => {
    expect(diasSemMovimento(AGORA, AGORA)).toBe(0);
  });

  it("sem data devolve null — não zero", () => {
    // Zero diria "movimentou hoje", que é o oposto de "nunca movimentou".
    expect(diasSemMovimento(null, AGORA)).toBeNull();
    expect(diasSemMovimento(undefined, AGORA)).toBeNull();
  });

  it("data inválida não vira NaN na tela", () => {
    expect(diasSemMovimento("não é data", AGORA)).toBeNull();
  });

  it("data no futuro vira 0, não negativo", () => {
    expect(diasSemMovimento(new Date(AGORA.getTime() + 5 * 86400000), AGORA)).toBe(0);
  });

  it("aceita string ISO além de Date", () => {
    expect(diasSemMovimento(diasAtras(7).toISOString(), AGORA)).toBe(7);
  });
});

describe("estaParado", () => {
  it("no dia exato do corte já conta como parado", () => {
    expect(estaParado(diasAtras(DIAS_PARADO_ALERTA), AGORA)).toBe(true);
  });

  it("um dia antes do corte ainda não", () => {
    expect(estaParado(diasAtras(DIAS_PARADO_ALERTA - 1), AGORA)).toBe(false);
  });

  it("sem movimentação registrada não afirma que está parado", () => {
    expect(estaParado(null, AGORA)).toBe(false);
  });
});

describe("vezDeQuem", () => {
  it("proposta nossa deixa a bola com eles", () => {
    expect(vezDeQuem("proposta", false)).toBe("eles");
  });

  it("contraproposta deles deixa a bola conosco", () => {
    expect(vezDeQuem("contraproposta", true)).toBe("nos");
  });

  it("proposta DELES também é nossa vez de responder", () => {
    expect(vezDeQuem("proposta", true)).toBe("nos");
  });

  it("nota não move a bola — preserva de quem era", () => {
    // "Liguei e não atenderam" não transfere a obrigação de responder.
    expect(vezDeQuem("nota", false, "eles")).toBe("eles");
    expect(vezDeQuem("nota", false, "nos")).toBe("nos");
  });

  it("encerramento não deixa vez com ninguém", () => {
    expect(vezDeQuem("fechamento", false, "eles")).toBeNull();
    expect(vezDeQuem("cancelamento", false, "nos")).toBeNull();
  });

  it("sem tratativa nenhuma não inventa vez", () => {
    expect(vezDeQuem(null, false)).toBeNull();
  });
});

describe("progressoNegociacao", () => {
  const cobrando = { valorDisponivel: 55_000_00, valorPretendido: 120_000_00 };

  it("na meta é 100%", () => {
    expect(progressoNegociacao({ ...cobrando, valorProposta: 120_000_00 })).toBe(100);
  });

  it("no limite é 0%", () => {
    expect(progressoNegociacao({ ...cobrando, valorProposta: 55_000_00 })).toBe(0);
  });

  it("no meio do caminho é ~50%", () => {
    expect(progressoNegociacao({ ...cobrando, valorProposta: 87_500_00 })).toBeCloseTo(50, 0);
  });

  /**
   * A régua tem que valer nos DOIS sentidos: quem paga quer o menor número, e
   * ali "avançar" é a proposta CAIR. Sem isso o termômetro leria invertido pra
   * metade dos acordos do escritório.
   */
  it("pagando (meta abaixo do limite), avançar é o valor cair", () => {
    const pagando = { valorDisponivel: 100_000_00, valorPretendido: 40_000_00 };
    expect(progressoNegociacao({ ...pagando, valorProposta: 40_000_00 })).toBe(100);
    expect(progressoNegociacao({ ...pagando, valorProposta: 100_000_00 })).toBe(0);
    expect(progressoNegociacao({ ...pagando, valorProposta: 70_000_00 })).toBeCloseTo(50, 0);
  });

  it("passar da meta não estoura de 100", () => {
    expect(progressoNegociacao({ ...cobrando, valorProposta: 200_000_00 })).toBe(100);
  });

  it("pior que o limite não fica negativo", () => {
    expect(progressoNegociacao({ ...cobrando, valorProposta: 10_000_00 })).toBe(0);
  });

  it("sem proposta ainda, usa o valor inicial como posição", () => {
    expect(progressoNegociacao({ ...cobrando, valorInicial: 55_000_00 })).toBe(0);
  });

  it("sem os marcos não existe régua — devolve null, não zero", () => {
    // Zero pintaria de vermelho uma negociação que só não tem marcos definidos.
    expect(progressoNegociacao({ valorProposta: 90_000_00 })).toBeNull();
    expect(progressoNegociacao({ valorPretendido: 100, valorProposta: 50 })).toBeNull();
  });

  it("meta igual ao limite não divide por zero", () => {
    expect(progressoNegociacao({ valorDisponivel: 500, valorPretendido: 500, valorProposta: 500 })).toBe(100);
    expect(progressoNegociacao({ valorDisponivel: 500, valorPretendido: 500, valorProposta: 400 })).toBe(0);
  });
});

/**
 * O número do negócio numa quitação.
 *
 * Dívida de 100 mil quitada por 22 mil são 78% de desconto — é isso que o
 * cliente contratou o escritório pra conseguir. "R$ 22.000,00" sozinho não diz
 * se foi bom ou péssimo.
 */
describe("descontoSobreOrigem", () => {
  it("quitação típica: 100 mil vira 22 mil", () => {
    expect(descontoSobreOrigem(100_000_00, 22_000_00)).toBe(78);
  });

  it("sem desconto nenhum é 0%", () => {
    expect(descontoSobreOrigem(100_000_00, 100_000_00)).toBe(0);
  });

  it("proposta acima da origem vira desconto negativo, não zero", () => {
    // Acontece com juros/multa somados depois. Esconder o sinal mentiria.
    expect(descontoSobreOrigem(100_000_00, 130_000_00)).toBe(-30);
  });

  it("sem valor de origem não há percentual — devolve null", () => {
    expect(descontoSobreOrigem(null, 22_000_00)).toBeNull();
    expect(descontoSobreOrigem(0, 22_000_00)).toBeNull();
    expect(descontoSobreOrigem(100_000_00, null)).toBeNull();
  });
});
