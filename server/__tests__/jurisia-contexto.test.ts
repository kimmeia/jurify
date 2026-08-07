/**
 * O corte do contexto.
 *
 * A trava de citação recusa qualquer fonte que não tenha sido entregue — então
 * o que este módulo deixa de fora vira, na prática, coisa que o JurisIA "não
 * sabe". Cortar a sentença pra caber três juntadas de petição seria o pior
 * erro possível, e é isso que estes testes seguram.
 */

import { describe, it, expect } from "vitest";
import { montarContextoProcesso, type EventoContexto } from "../../shared/jurisia-contexto";

const ev = (over: Partial<EventoContexto> & { id: number; dataEvento: string }): EventoContexto => ({
  titulo: "Movimentação",
  ...over,
});

describe("montarContextoProcesso", () => {
  it("escreve a história em ordem cronológica", () => {
    const c = montarContextoProcesso([
      ev({ id: 3, dataEvento: "2026-03-10", titulo: "Sentença" }),
      ev({ id: 1, dataEvento: "2026-01-05", titulo: "Distribuição" }),
      ev({ id: 2, dataEvento: "2026-02-08", titulo: "Contestação" }),
    ]);
    expect(c.fontes.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(c.texto.indexOf("Distribuição")).toBeLessThan(c.texto.indexOf("Sentença"));
  });

  it("cada fonte aparece marcada com o id que a resposta vai citar", () => {
    const c = montarContextoProcesso([ev({ id: 42, dataEvento: "2026-05-02", titulo: "Acórdão" })]);
    expect(c.texto).toContain("[FONTE 42]");
    expect(c.texto).toContain("02/05/2026");
  });

  it("quando não cabe tudo, a rotina é a primeira a sair", () => {
    const eventos = [
      ...Array.from({ length: 8 }, (_, i) =>
        ev({ id: 100 + i, dataEvento: `2026-01-0${i + 1}`, relevancia: "rotina", titulo: "Juntada" }),
      ),
      ev({ id: 9, dataEvento: "2026-02-01", titulo: "Sentença", desfecho: "parcial" }),
      ev({ id: 8, dataEvento: "2026-01-20", titulo: "Decisão", teor: "texto" }),
    ];
    const c = montarContextoProcesso(eventos, { maxFontes: 2 });
    expect(c.fontes.map((f) => f.id).sort()).toEqual([8, 9]);
    expect(c.omitidas).toBe(8);
  });

  it("desfecho tem prioridade sobre teor, e teor sobre movimentação comum", () => {
    const c = montarContextoProcesso(
      [
        ev({ id: 1, dataEvento: "2026-06-01", titulo: "Comum" }),
        ev({ id: 2, dataEvento: "2026-06-02", titulo: "Com teor", teor: "algo" }),
        ev({ id: 3, dataEvento: "2026-06-03", titulo: "Com desfecho", desfecho: "favoravel" }),
      ],
      { maxFontes: 2 },
    );
    expect(c.fontes.map((f) => f.id).sort()).toEqual([2, 3]);
  });

  it("desfecho neutro não vale como desfecho na disputa por espaço", () => {
    // "neutro" é o que a análise devolve quando o ato não julga nada; tratá-lo
    // como decisão empurraria a sentença de verdade pra fora do corte.
    const c = montarContextoProcesso(
      [
        ev({ id: 1, dataEvento: "2026-06-01", titulo: "Ato neutro", desfecho: "neutro" }),
        ev({ id: 2, dataEvento: "2026-05-01", titulo: "Com teor", teor: "algo" }),
      ],
      { maxFontes: 1 },
    );
    expect(c.fontes.map((f) => f.id)).toEqual([2]);
  });

  it("empate de peso é desempatado pelo mais recente", () => {
    const c = montarContextoProcesso(
      [
        ev({ id: 1, dataEvento: "2026-01-01", titulo: "Velha" }),
        ev({ id: 2, dataEvento: "2026-09-01", titulo: "Nova" }),
      ],
      { maxFontes: 1 },
    );
    expect(c.fontes.map((f) => f.id)).toEqual([2]);
  });

  it("avisa quantas ficaram de fora, em vez de fingir que veio tudo", () => {
    const eventos = Array.from({ length: 5 }, (_, i) =>
      ev({ id: i + 1, dataEvento: `2026-01-0${i + 1}` }),
    );
    const c = montarContextoProcesso(eventos, { maxFontes: 2 });
    expect(c.omitidas).toBe(3);
    expect(c.texto).toContain("3 movimentação(ões) de rotina ficaram fora");
  });

  it("teor gigante é truncado — um só não pode comer o processo inteiro", () => {
    const c = montarContextoProcesso([
      ev({ id: 1, dataEvento: "2026-04-01", titulo: "Sentença", teor: "x".repeat(9000) }),
    ]);
    expect(c.texto.length).toBeLessThan(2200);
    expect(c.texto).toContain("…");
  });

  it("pontos da análise entram como bullets", () => {
    const c = montarContextoProcesso([
      ev({
        id: 1,
        dataEvento: "2026-04-01",
        titulo: "Sentença",
        pontos: ["Devolução em dobro deferida.", "Dano moral afastado."],
      }),
    ]);
    expect(c.texto).toContain("- Devolução em dobro deferida.");
    expect(c.texto).toContain("- Dano moral afastado.");
  });

  it("processo sem movimentação não quebra", () => {
    const c = montarContextoProcesso([]);
    expect(c.fontes).toEqual([]);
    expect(c.omitidas).toBe(0);
  });

  it("título vazio não gera fonte sem rótulo", () => {
    const c = montarContextoProcesso([ev({ id: 1, dataEvento: "2026-04-01", titulo: "   " })]);
    expect(c.fontes[0].rotulo).toBe("(sem título)");
  });
});
