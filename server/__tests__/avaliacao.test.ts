/**
 * Avaliação de desempenho — a régua e o relógio.
 *
 * Duas coisas estão sendo protegidas aqui.
 *
 * A primeira é a diferença entre "não avaliei" e "tirou zero". Zero é a pior
 * nota possível; ausência de nota não é nota nenhuma. Colapsar os dois faria a
 * média despencar por causa de um critério que o gestor pulou de propósito.
 *
 * A segunda é a contagem do ciclo. Uma avaliação que ninguém repete é uma
 * avaliação que aconteceu uma vez e virou enfeite — a tela precisa saber
 * cobrar, e precisa parar de cobrar de quem está em dia.
 */

import { describe, expect, it } from "vitest";
import {
  CICLO_MESES,
  CRITERIOS,
  deltaDeNota,
  mediaDasNotas,
  mesesEntre,
  normalizarNotas,
  NOTA_MAX,
  precisaAvaliar,
  proximoCiclo,
  situacaoDaAcao,
  situacaoDoCiclo,
} from "../../shared/avaliacao";

describe("notas", () => {
  it("critério sem nota fica de fora da média, e não vira zero", () => {
    // Com {5, 5} a média é 5. Se os três critérios não avaliados entrassem
    // como zero, cairia pra 2,0 — e o gestor teria "reprovado" alguém por não
    // ter opinião sobre autonomia.
    expect(mediaDasNotas({ pontualidade: 5, metas: 5 })).toBe(5);
  });

  it("nada avaliado devolve null, não zero", () => {
    expect(mediaDasNotas({})).toBeNull();
  });

  it("zero é nota de verdade e conta", () => {
    expect(mediaDasNotas({ pontualidade: 0, metas: 4 })).toBe(2);
  });

  it("arredonda a média em uma casa", () => {
    expect(mediaDasNotas({ pontualidade: 1.5, metas: 2, tecnica: 3, comunicacao: 3.5, autonomia: 3 }))
      .toBe(2.6);
  });

  it("descarta critério que não existe mais", () => {
    // Ele entraria na média de um jeito que ninguém explica olhando a tela,
    // que só mostra os critérios atuais.
    const n = normalizarNotas({ pontualidade: 4, proatividade: 5 });
    expect(n).toEqual({ pontualidade: 4 });
    expect(mediaDasNotas(n)).toBe(4);
  });

  it("recusa nota fora da régua", () => {
    expect(normalizarNotas({ pontualidade: -1, metas: 6, tecnica: 3 })).toEqual({ tecnica: 3 });
  });

  it("arredonda pra meio ponto — a régua não tem mais precisão que isso", () => {
    expect(normalizarNotas({ pontualidade: 3.7 })).toEqual({ pontualidade: 3.5 });
    expect(normalizarNotas({ pontualidade: 3.8 })).toEqual({ pontualidade: 4 });
  });

  it("aceita JSON vindo do banco e sobrevive a lixo", () => {
    expect(normalizarNotas('{"metas":2.5}')).toEqual({ metas: 2.5 });
    expect(normalizarNotas("não é json")).toEqual({});
    expect(normalizarNotas(null)).toEqual({});
    expect(normalizarNotas(42)).toEqual({});
  });

  it("todo critério da lista é aceito", () => {
    const todos = Object.fromEntries(CRITERIOS.map((c) => [c.id, NOTA_MAX]));
    expect(Object.keys(normalizarNotas(todos)).sort()).toEqual(CRITERIOS.map((c) => c.id).sort());
    expect(mediaDasNotas(normalizarNotas(todos))).toBe(NOTA_MAX);
  });
});

describe("ciclo", () => {
  it("conta os meses entre dois ciclos, inclusive virando o ano", () => {
    expect(mesesEntre("2026-05", "2026-08")).toBe(3);
    expect(mesesEntre("2025-11", "2026-02")).toBe(3);
    expect(mesesEntre("2026-08", "2026-08")).toBe(0);
  });

  it("o próximo ciclo vence três meses depois, virando o ano", () => {
    expect(proximoCiclo("2026-05")).toBe("2026-08");
    expect(proximoCiclo("2025-11")).toBe("2026-02");
    expect(proximoCiclo("2026-12")).toBe("2027-03");
  });

  it("quem nunca foi avaliado sai como 'nunca', não como 'vencida'", () => {
    // A cobrança é a mesma, mas chamar de vencida uma avaliação que nunca
    // existiu manda o gestor procurar um histórico que não há.
    expect(situacaoDoCiclo(null, "2026-08")).toBe("nunca");
    expect(situacaoDoCiclo(undefined, "2026-08")).toBe("nunca");
  });

  it("dentro do prazo está em dia", () => {
    expect(situacaoDoCiclo("2026-08", "2026-08")).toBe("em_dia");
    expect(situacaoDoCiclo("2026-06", "2026-08")).toBe("em_dia");
  });

  it("no mês em que fecha, pede avaliação — mas ainda não está vencida", () => {
    expect(situacaoDoCiclo("2026-05", "2026-08")).toBe("vence_agora");
  });

  it("passou do prazo é vencida", () => {
    expect(situacaoDoCiclo("2026-04", "2026-08")).toBe("vencida");
    expect(situacaoDoCiclo("2025-11", "2026-08")).toBe("vencida");
  });

  it("ciclo no futuro não é vencido", () => {
    // Acontece quando o gestor corrige a data do relógio, ou avalia com o mês
    // seguinte selecionado. Cobrar aí seria cobrar do nada.
    expect(situacaoDoCiclo("2026-09", "2026-08")).toBe("em_dia");
  });

  it("só 'em dia' dispensa ação do gestor", () => {
    expect(precisaAvaliar("em_dia")).toBe(false);
    for (const s of ["vence_agora", "vencida", "nunca"] as const) {
      expect(precisaAvaliar(s), s).toBe(true);
    }
  });

  it("a periodicidade é a mesma nos dois caminhos", () => {
    // `proximoCiclo` e `situacaoDoCiclo` derivam da mesma constante; se uma
    // delas ganhasse um número solto, a tela cobraria num mês e diria que
    // vence noutro.
    const proximo = proximoCiclo("2026-01")!;
    expect(mesesEntre("2026-01", proximo)).toBe(CICLO_MESES);
    expect(situacaoDoCiclo("2026-01", proximo)).toBe("vence_agora");
  });
});

describe("delta entre ciclos", () => {
  it("mostra quanto a nota andou", () => {
    expect(deltaDeNota(2.6, 3.4)).toBe(-0.8);
    expect(deltaDeNota(3.8, 3.4)).toBe(0.4);
  });

  it("sem comparação não inventa movimento", () => {
    expect(deltaDeNota(2.6, null)).toBeNull();
    expect(deltaDeNota(null, 3.4)).toBeNull();
  });
});

describe("plano combinado", () => {
  const acao = (prazo: string | null, concluidoEm: string | null = null) =>
    ({ id: 1, descricao: "x", prazo, concluidoEm });

  it("cumprida é cumprida mesmo depois do prazo", () => {
    expect(situacaoDaAcao(acao("2026-07-01", "2026-08-05"), "2026-08-12")).toBe("concluida");
  });

  it("atrasada exige prazo combinado", () => {
    // Sem data não há como estar atrasado, e pintar de vermelho tudo que está
    // em aberto transformaria o plano numa lista de acusações.
    expect(situacaoDaAcao(acao(null), "2026-08-12")).toBe("em_aberto");
    expect(situacaoDaAcao(acao("2026-07-01"), "2026-08-12")).toBe("atrasada");
  });

  it("no dia do prazo ainda não está atrasada", () => {
    expect(situacaoDaAcao(acao("2026-08-12"), "2026-08-12")).toBe("em_aberto");
  });
});
