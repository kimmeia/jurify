/**
 * Helpers de data de calendário (`shared/data-calendario.ts`).
 *
 * O fuso é fixado em America/Fortaleza (UTC-3, sem horário de verão) porque
 * o bug só existe fora do UTC: meia-noite UTC de 10/09 é 21:00 de 09/09
 * aqui. Rodando em UTC — como o CI e o Railway — o teste passaria com o
 * código errado.
 */

process.env.TZ = "America/Fortaleza";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  dataCalendarioISO,
  dataLocalHoje,
  diaSemanaCalendario,
  formatarDataCalendario,
} from "../../shared/data-calendario";

const MEIA_NOITE_UTC = new Date("2026-09-10T00:00:00Z");
const MEIO_DIA_UTC = new Date("2026-09-10T12:00:00Z");

describe("o ambiente do teste reproduz o bug", () => {
  it("o fuso fixado é UTC-3 e a formatação local mostra o dia anterior", () => {
    expect(MEIA_NOITE_UTC.getTimezoneOffset()).toBe(180);
    expect(MEIA_NOITE_UTC.toLocaleDateString("pt-BR")).toBe("09/09/2026");
  });
});

describe("formatarDataCalendario", () => {
  it("meia-noite UTC de 10/09 formata 10/09/2026 (registros antigos)", () => {
    expect(formatarDataCalendario(MEIA_NOITE_UTC)).toBe("10/09/2026");
  });

  it("meio-dia UTC de 10/09 formata 10/09/2026 (registros novos)", () => {
    expect(formatarDataCalendario(MEIO_DIA_UTC)).toBe("10/09/2026");
  });

  it("aceita string ISO e string só-data (Asaas manda YYYY-MM-DD)", () => {
    expect(formatarDataCalendario("2026-09-10T00:00:00.000Z")).toBe("10/09/2026");
    expect(formatarDataCalendario("2026-09-10")).toBe("10/09/2026");
  });

  it("variantes: sem ano, mês abreviado, com dia da semana", () => {
    expect(formatarDataCalendario(MEIA_NOITE_UTC, { ano: false })).toBe("10/09");
    const curto = formatarDataCalendario(MEIA_NOITE_UTC, { ano: false, mes: "curto" });
    expect(curto).toMatch(/^10 .*set/);
    expect(formatarDataCalendario(MEIA_NOITE_UTC, { diaSemana: true })).toBe(
      "quinta-feira, 10/09/2026",
    );
  });

  it("vazio pra null, string vazia e data inválida", () => {
    expect(formatarDataCalendario(null)).toBe("");
    expect(formatarDataCalendario(undefined)).toBe("");
    expect(formatarDataCalendario("")).toBe("");
    expect(formatarDataCalendario("não é data")).toBe("");
    expect(formatarDataCalendario(new Date(NaN))).toBe("");
  });
});

describe("diaSemanaCalendario", () => {
  it("10/09/2026 é quinta-feira, à meia-noite e ao meio-dia UTC", () => {
    expect(diaSemanaCalendario(MEIA_NOITE_UTC)).toBe("quinta-feira");
    expect(diaSemanaCalendario(MEIO_DIA_UTC)).toBe("quinta-feira");
    expect(diaSemanaCalendario("2026-09-10")).toBe("quinta-feira");
  });

  it("dia da semana e data impressa nunca discordam", () => {
    // Era a linha "quinta-feira, 09/09" do drawer: semana em UTC, data local.
    for (const d of [MEIA_NOITE_UTC, MEIO_DIA_UTC, new Date("2026-09-10T23:59:59Z")]) {
      expect(`${diaSemanaCalendario(d)}, ${formatarDataCalendario(d)}`).toBe(
        "quinta-feira, 10/09/2026",
      );
    }
  });
});

describe("dataCalendarioISO", () => {
  it("devolve a parte de data em UTC, pronta pro <input type=date>", () => {
    expect(dataCalendarioISO(MEIA_NOITE_UTC)).toBe("2026-09-10");
    expect(dataCalendarioISO(MEIO_DIA_UTC)).toBe("2026-09-10");
    expect(dataCalendarioISO("2026-09-10T00:00:00.000Z")).toBe("2026-09-10");
  });

  it("string só-data passa intacta; inválido vira vazio", () => {
    expect(dataCalendarioISO("2026-09-10")).toBe("2026-09-10");
    expect(dataCalendarioISO(null)).toBe("");
    expect(dataCalendarioISO("abc")).toBe("");
  });
});

describe("string só-data não depende do fuso do navegador", () => {
  // A oeste de Greenwich uma âncora em meia-noite LOCAL passaria despercebida
  // (03:00Z ainda é o mesmo dia); a leste ela cai no dia anterior.
  beforeAll(() => {
    process.env.TZ = "Asia/Tokyo";
  });
  afterAll(() => {
    process.env.TZ = "America/Fortaleza";
  });

  it("em UTC+9 '2026-09-10' continua 10/09/2026, quinta-feira", () => {
    expect(new Date("2026-09-10T00:00:00Z").getTimezoneOffset()).toBe(-540);
    expect(formatarDataCalendario("2026-09-10")).toBe("10/09/2026");
    expect(diaSemanaCalendario("2026-09-10")).toBe("quinta-feira");
    expect(dataCalendarioISO("2026-09-10")).toBe("2026-09-10");
  });
});

describe("dataLocalHoje", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("às 21:30 de 09/09 em Fortaleza ainda é 09/09 (toISOString já diria 10/09)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T00:30:00Z"));
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-09-10");
    expect(dataLocalHoje()).toBe("2026-09-09");
  });

  it("aceita o instante por parâmetro e faz padding de mês e dia", () => {
    expect(dataLocalHoje(new Date("2026-09-10T00:30:00Z"))).toBe("2026-09-09");
    expect(dataLocalHoje(new Date("2026-01-05T15:00:00Z"))).toBe("2026-01-05");
  });

  it("de dia, local e UTC coincidem", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T15:00:00Z"));
    expect(dataLocalHoje()).toBe("2026-09-10");
  });
});
