/**
 * O cálculo da jornada.
 *
 * O pedido era "pegar o horário que ele loga e desloga". A entrada funciona; a
 * saída é uma armadilha, porque quase ninguém clica em sair. Estes testes
 * existem pra que as duas maneiras de errar nunca voltem:
 *
 *  - registrar 23h pra quem esqueceu a aba aberta;
 *  - registrar nada pra quem fechou o notebook.
 *
 * Nos dois casos o resultado errado tem cara de resultado — e folha de ponto
 * errada é pior que folha nenhuma, porque a errada é assinada.
 */

import { describe, expect, it } from "vitest";
import {
  calcularJornada,
  formatarDuracao,
  HORAS_PARA_REVISAR,
  totalDoPeriodo,
  type DiaPontoBruto,
} from "../../shared/ponto";

const D = "2026-08-11";
const h = (hora: string) => new Date(`${D}T${hora}:00.000Z`);
/** Bem depois do expediente: garante que nada seja lido como "ainda online". */
const DEPOIS = new Date(`2026-08-12T12:00:00.000Z`);

function dia(over: Partial<DiaPontoBruto> = {}): DiaPontoBruto {
  return {
    dia: D,
    entradaEm: null,
    pausaInicioEm: null,
    pausaFimEm: null,
    saidaEm: null,
    ultimaAtividadeEm: null,
    ...over,
  };
}

describe("saída batida", () => {
  it("conta entrada até saída", () => {
    const j = calcularJornada(dia({ entradaEm: h("08:00"), saidaEm: h("17:00") }), DEPOIS);
    expect(j.status).toBe("fechado");
    expect(j.minutos).toBe(9 * 60);
    expect(j.saidaOrigem).toBe("registrada");
  });

  it("desconta a pausa fechada", () => {
    const j = calcularJornada(
      dia({
        entradaEm: h("08:00"),
        pausaInicioEm: h("12:00"),
        pausaFimEm: h("13:00"),
        saidaEm: h("17:00"),
      }),
      DEPOIS,
    );
    expect(j.minutosPausa).toBe(60);
    expect(j.minutos).toBe(8 * 60);
  });

  it("pausa aberta não apaga a tarde — só avisa", () => {
    // Quem saiu pro almoço e esqueceu de voltar a marcar tem uma pausa a
    // corrigir, não um turno inteiro descontado.
    const j = calcularJornada(
      dia({ entradaEm: h("08:00"), pausaInicioEm: h("12:00"), saidaEm: h("17:00") }),
      DEPOIS,
    );
    expect(j.minutosPausa).toBe(0);
    expect(j.minutos).toBe(9 * 60);
    expect(j.avisos.join(" ")).toContain("não encerrada");
  });

  it("saída antes da entrada não vira jornada negativa nem zero disfarçado", () => {
    const j = calcularJornada(dia({ entradaEm: h("17:00"), saidaEm: h("08:00") }), DEPOIS);
    expect(j.status).toBe("inconsistente");
    expect(j.minutos).toBeNull();
  });
});

describe("saída não batida", () => {
  it("usa a última atividade e DIZ que usou", () => {
    const j = calcularJornada(
      dia({ entradaEm: h("08:00"), ultimaAtividadeEm: h("18:12") }),
      DEPOIS,
    );
    expect(j.status).toBe("fechado");
    expect(j.saidaOrigem).toBe("atividade");
    expect(j.minutos).toBe(10 * 60 + 12);
    expect(j.avisos.join(" ")).toContain("última atividade");
  });

  it("entrada sem NENHUM sinal posterior não vira jornada", () => {
    // Fechou o notebook. Não há de onde tirar a saída, e inventar uma seria
    // assinar hora que ninguém conferiu.
    const j = calcularJornada(dia({ entradaEm: h("08:00") }), DEPOIS);
    expect(j.status).toBe("sem_saida");
    expect(j.minutos).toBeNull();
    expect(j.saida).toBeNull();
    expect(j.avisos.join(" ")).toContain("gestor");
  });

  it("atividade anterior à entrada não serve de saída", () => {
    const j = calcularJornada(
      dia({ entradaEm: h("08:00"), ultimaAtividadeEm: h("07:30") }),
      DEPOIS,
    );
    expect(j.status).toBe("sem_saida");
    expect(j.minutos).toBeNull();
  });

  it("aba esquecida aberta vira REVISAR, não 23 horas aceitas", () => {
    const j = calcularJornada(
      dia({ entradaEm: h("08:00"), ultimaAtividadeEm: new Date(`2026-08-12T06:00:00.000Z`) }),
      DEPOIS,
    );
    expect(j.status).toBe("revisar");
    // O número aparece — não é truncado em silêncio —, mas o dia não entra no
    // total do mês enquanto alguém não olhar.
    expect(j.minutos).toBeGreaterThan(HORAS_PARA_REVISAR * 60);
    expect(j.avisos.join(" ")).toContain("Confirme ou corrija");
  });

  it("sinal de vida recente é 'ainda trabalhando', não jornada fechada", () => {
    const agora = h("15:00");
    const j = calcularJornada(
      dia({ entradaEm: h("08:00"), ultimaAtividadeEm: h("14:58") }),
      agora,
    );
    expect(j.status).toBe("em_andamento");
    expect(j.minutos).toBeNull();
  });
});

describe("dia sem nada", () => {
  it("não inventa registro", () => {
    const j = calcularJornada(dia(), DEPOIS);
    expect(j.status).toBe("sem_registro");
    expect(j.entrada).toBeNull();
    expect(j.minutos).toBeNull();
    expect(j.avisos).toEqual([]);
  });
});

describe("totalDoPeriodo", () => {
  it("soma só o que fechou, e conta o que ficou pendente", () => {
    // Somar dia aberto produziria um total que ninguém consegue conferir
    // contra o espelho — e é o total que vai pro pagamento.
    const jornadas = [
      calcularJornada(dia({ entradaEm: h("08:00"), saidaEm: h("17:00") }), DEPOIS),
      calcularJornada(dia({ entradaEm: h("08:00"), ultimaAtividadeEm: h("17:30") }), DEPOIS),
      calcularJornada(dia({ entradaEm: h("08:00") }), DEPOIS),
      calcularJornada(dia(), DEPOIS),
    ];
    const t = totalDoPeriodo(jornadas);
    expect(t.diasFechados).toBe(2);
    expect(t.minutos).toBe(9 * 60 + (9 * 60 + 30));
    expect(t.diasPendentes).toBe(1);
  });
});

describe("formatarDuracao", () => {
  it("fala a língua de um espelho de ponto", () => {
    expect(formatarDuracao(492)).toBe("8h12");
    expect(formatarDuracao(480)).toBe("8h");
    expect(formatarDuracao(45)).toBe("45min");
    expect(formatarDuracao(null)).toBe("—");
  });
});
