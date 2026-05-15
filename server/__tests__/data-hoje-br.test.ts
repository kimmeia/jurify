/**
 * Testes do helper `dataHojeBR()` — retorna data ISO no fuso brasileiro.
 *
 * Bug original: `new Date().toISOString().slice(0,10)` retorna UTC, então
 * após 21h BRT (= 00h UTC+1) o "hoje" vira "amanhã" pra o operador.
 * Pagamentos marcados à noite ficavam datados pro dia seguinte; KPI
 * "Vencido" disparava 3h antes do vencimento real terminar.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dataHojeBR } from "../../shared/escritorio-types";

describe("dataHojeBR", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("21h BRT (00h UTC dia seguinte): retorna hoje em BRT, não amanhã em UTC", () => {
    // 14 de maio às 23:00 BRT = 15 de maio 02:00 UTC.
    // Em UTC o slice retornaria 2026-05-15 ("amanhã" pro user).
    // dataHojeBR(BRT) precisa retornar 2026-05-14.
    vi.setSystemTime(new Date("2026-05-15T02:00:00.000Z"));
    expect(dataHojeBR()).toBe("2026-05-14");
  });

  it("00h BRT (03h UTC mesmo dia): retorna o dia corrente em ambos", () => {
    vi.setSystemTime(new Date("2026-05-14T03:00:00.000Z"));
    expect(dataHojeBR()).toBe("2026-05-14");
  });

  it("12h BRT (15h UTC): meio do dia bate igual em qualquer fuso", () => {
    vi.setSystemTime(new Date("2026-05-14T15:00:00.000Z"));
    expect(dataHojeBR()).toBe("2026-05-14");
  });

  it("aceita fuso custom (Manaus UTC-4)", () => {
    // 15 mai 02:00 UTC = 14 mai 22:00 Manaus (UTC-4)
    vi.setSystemTime(new Date("2026-05-15T02:00:00.000Z"));
    expect(dataHojeBR("America/Manaus")).toBe("2026-05-14");
  });

  it("aceita fuso custom (Noronha UTC-2)", () => {
    // 15 mai 03:00 UTC = 15 mai 01:00 Noronha (UTC-2) — já é o próximo dia!
    vi.setSystemTime(new Date("2026-05-15T03:00:00.000Z"));
    expect(dataHojeBR("America/Noronha")).toBe("2026-05-15");
    // Comparação: BRT (UTC-3) está em 00h dia 15 → também já virou
    expect(dataHojeBR("America/Sao_Paulo")).toBe("2026-05-15");
  });

  it("zero-padding consistente (dia/mês com 1 dígito)", () => {
    // 5 mar 15:00 UTC = 5 mar 12:00 BRT
    vi.setSystemTime(new Date("2026-03-05T15:00:00.000Z"));
    expect(dataHojeBR()).toBe("2026-03-05");
  });

  it("fim de mês: virada de mês em UTC ainda é o mês anterior em BRT", () => {
    // 1 jun 02:00 UTC = 31 mai 23:00 BRT
    vi.setSystemTime(new Date("2026-06-01T02:00:00.000Z"));
    expect(dataHojeBR()).toBe("2026-05-31");
  });

  it("fim de ano: virada em UTC ainda é o ano anterior em BRT", () => {
    // 1 jan 02:00 UTC = 31 dez 23:00 BRT
    vi.setSystemTime(new Date("2027-01-01T02:00:00.000Z"));
    expect(dataHojeBR()).toBe("2026-12-31");
  });
});
