/**
 * A jornada contratada.
 *
 * É ela que transforma "trabalhou 7h20" em "cumpriu" ou "faltou" — e o número
 * que sai daqui vira conversa sobre o salário de alguém. Duas invariantes
 * carregam o arquivo:
 *
 *  1. jornada quebrada ou ausente NÃO vira jornada padrão. Cobrar 8h de quem
 *     nunca teve jornada configurada é inventar um contrato;
 *  2. atraso tem tolerância. Sem ela o espelho acusaria quase todo mundo quase
 *     todo dia, e alarme que dispara sempre ninguém lê.
 */

import { describe, expect, it } from "vitest";
import {
  expedienteDoDia,
  horaDosMinutos,
  jornadaPadrao,
  minutosDaHora,
  minutosPrevistos,
  normalizarJornada,
  pontualidade,
  resumirJornada,
  TOLERANCIA_ATRASO_MIN,
  type JornadaSemanal,
} from "../../shared/jornada";

// 2026-08-11 é uma terça; 2026-08-15 é sábado; 2026-08-16 é domingo.
const TERCA = "2026-08-11";
const SABADO = "2026-08-15";
const DOMINGO = "2026-08-16";

describe("normalizarJornada", () => {
  it("aceita o formato da tela", () => {
    const j = normalizarJornada({ 1: { inicio: "08:00", fim: "18:00", intervaloMin: 60 } });
    expect(j).toEqual({ 1: { inicio: "08:00", fim: "18:00", intervaloMin: 60 } });
  });

  it("lê JSON vindo do banco", () => {
    expect(normalizarJornada('{"2":{"inicio":"09:00","fim":"15:00","intervaloMin":0}}')).toEqual({
      2: { inicio: "09:00", fim: "15:00", intervaloMin: 0 },
    });
  });

  it("ausente e quebrada dão o MESMO resultado: null", () => {
    // Tratar jornada inválida como "8h de seg a sex" cobraria de alguém uma
    // carga que ninguém contratou.
    expect(normalizarJornada(null)).toBeNull();
    expect(normalizarJornada("")).toBeNull();
    expect(normalizarJornada("{{{")).toBeNull();
    expect(normalizarJornada({})).toBeNull();
    expect(normalizarJornada(42)).toBeNull();
  });

  it("descarta dia com horário impossível em vez de corrigir por conta própria", () => {
    expect(normalizarJornada({ 1: { inicio: "18:00", fim: "08:00", intervaloMin: 0 } })).toBeNull();
    expect(normalizarJornada({ 1: { inicio: "25:00", fim: "26:00", intervaloMin: 0 } })).toBeNull();
    expect(normalizarJornada({ 9: { inicio: "08:00", fim: "18:00", intervaloMin: 0 } })).toBeNull();
  });

  it("intervalo maior que o expediente é ignorado, não vira jornada negativa", () => {
    const j = normalizarJornada({ 1: { inicio: "08:00", fim: "12:00", intervaloMin: 300 } });
    expect(j![1]!.intervaloMin).toBe(0);
  });

  it("mantém os dias válidos quando um é inválido", () => {
    const j = normalizarJornada({
      1: { inicio: "08:00", fim: "18:00", intervaloMin: 60 },
      2: { inicio: "xx", fim: "18:00", intervaloMin: 0 },
    });
    expect(Object.keys(j!)).toEqual(["1"]);
  });
});

describe("previsão por dia", () => {
  const j: JornadaSemanal = {
    1: { inicio: "08:00", fim: "18:00", intervaloMin: 60 },
    2: { inicio: "08:00", fim: "14:00", intervaloMin: 0 },
  };

  it("desconta o intervalo", () => {
    expect(minutosPrevistos(j, "2026-08-10")).toBe(9 * 60); // segunda
    expect(minutosPrevistos(j, TERCA)).toBe(6 * 60);
  });

  it("dia fora do mapa é folga, não erro", () => {
    expect(minutosPrevistos(j, SABADO)).toBe(0);
    expect(minutosPrevistos(j, DOMINGO)).toBe(0);
    expect(expedienteDoDia(j, SABADO)).toBeNull();
  });

  it("sem jornada, nada é previsto", () => {
    expect(minutosPrevistos(null, TERCA)).toBe(0);
  });

  it("o dia da semana não escorrega pelo fuso", () => {
    // Extrair o dia da semana à meia-noite empurraria a data pro dia anterior
    // em fuso negativo, e a terça viraria segunda no espelho inteiro.
    expect(expedienteDoDia(j, TERCA)).toEqual({ inicio: "08:00", fim: "14:00", intervaloMin: 0 });
  });
});

describe("pontualidade", () => {
  const j: JornadaSemanal = { 2: { inicio: "08:00", fim: "18:00", intervaloMin: 60 } };

  it("dentro da tolerância não é atraso", () => {
    expect(pontualidade(j, TERCA, 8 * 60 + TOLERANCIA_ATRASO_MIN)).toEqual({
      atrasoMin: 0,
      atrasado: false,
    });
  });

  it("além da tolerância conta o atraso cheio", () => {
    const p = pontualidade(j, TERCA, 8 * 60 + 25);
    expect(p.atrasado).toBe(true);
    expect(p.atrasoMin).toBe(25);
  });

  it("chegar antes nunca é atraso", () => {
    expect(pontualidade(j, TERCA, 7 * 60 + 30).atrasado).toBe(false);
  });

  it("folga e ausência de jornada não geram atraso", () => {
    expect(pontualidade(j, SABADO, 10 * 60).atrasado).toBe(false);
    expect(pontualidade(null, TERCA, 10 * 60).atrasado).toBe(false);
  });

  it("sem entrada registrada não há atraso a afirmar", () => {
    expect(pontualidade(j, TERCA, null).atrasado).toBe(false);
  });
});

describe("horas", () => {
  it("converte nos dois sentidos", () => {
    expect(minutosDaHora("08:30")).toBe(510);
    expect(horaDosMinutos(510)).toBe("08:30");
    expect(minutosDaHora("24:00")).toBeNull();
    expect(minutosDaHora("8:30")).toBeNull();
  });
});

describe("resumirJornada", () => {
  it("agrupa dias consecutivos de mesmo horário", () => {
    expect(resumirJornada(jornadaPadrao())).toBe("Seg a Sex · 08:00–18:00 · 45h/semana");
  });

  it("lista quando os dias não são consecutivos", () => {
    const j = normalizarJornada({
      1: { inicio: "08:00", fim: "12:00", intervaloMin: 0 },
      3: { inicio: "08:00", fim: "12:00", intervaloMin: 0 },
    });
    expect(resumirJornada(j)).toContain("Seg, Qua");
  });

  it("sem jornada, diz que não há", () => {
    expect(resumirJornada(null)).toBe("Sem jornada definida");
  });
});
