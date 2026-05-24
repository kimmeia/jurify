/**
 * Testes dos helpers puros do router-relatorios.
 *
 * `mesVigente`, `desdeDias`, `subtrairUmMesClamped` e `metaProporcionalPeriodo`
 * são funções sem dependência de DB — fáceis de cobrir com input/output direto.
 *
 * `subtrairUmMesClamped` e `metaProporcionalPeriodo` foram introduzidos pra
 * resolver bugs reportados:
 *   - Comparação MTD vs LMTD errada em fim de mês (`Date#setMonth` overflow).
 *   - `progressoMeta` calculado contra meta mensal cheia em ranges curtos.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  desdeDias,
  metaProporcionalPeriodo,
} from "../escritorio/router-relatorios";
import { subtrairUmMesISO, primeiroDiaDoMesISO } from "../../shared/escritorio-types";

describe("desdeDias", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna data N dias atrás (UTC, mesma hora)", () => {
    const d = desdeDias(7);
    expect(d.toISOString()).toBe("2026-05-07T12:00:00.000Z");
  });

  it("preserva hora; só desloca o dia", () => {
    const d = desdeDias(30);
    expect(d.toISOString()).toBe("2026-04-14T12:00:00.000Z");
  });

  it("dias=1 → ontem", () => {
    const d = desdeDias(1);
    expect(d.toISOString()).toBe("2026-05-13T12:00:00.000Z");
  });
});

describe("primeiroDiaDoMesISO", () => {
  it("retorna o dia 01 do mês da data", () => {
    expect(primeiroDiaDoMesISO("2026-05-23")).toBe("2026-05-01");
    expect(primeiroDiaDoMesISO("2026-12-31")).toBe("2026-12-01");
  });

  it("dia 1 retorna ele mesmo", () => {
    expect(primeiroDiaDoMesISO("2026-01-01")).toBe("2026-01-01");
  });
});

describe("subtrairUmMesISO", () => {
  it("preserva o dia quando o mês anterior também tem aquele dia (15 jun → 15 mai)", () => {
    expect(subtrairUmMesISO("2026-06-15")).toBe("2026-05-15");
  });

  it("31 mar → 28 fev (clamp pro último dia, NÃO rola pra 3 mar)", () => {
    expect(subtrairUmMesISO("2026-03-31")).toBe("2026-02-28");
  });

  it("31 mai → 30 abr (abr tem 30 dias)", () => {
    expect(subtrairUmMesISO("2026-05-31")).toBe("2026-04-30");
  });

  it("29 mar 2024 → 29 fev 2024 (bissexto preserva)", () => {
    expect(subtrairUmMesISO("2024-03-29")).toBe("2024-02-29");
  });

  it("29 mar 2026 → 28 fev 2026 (não-bissexto clampa)", () => {
    expect(subtrairUmMesISO("2026-03-29")).toBe("2026-02-28");
  });

  it("15 jan → 15 dez do ano anterior (cross-year)", () => {
    expect(subtrairUmMesISO("2026-01-15")).toBe("2025-12-15");
  });

  it("01 mai → 01 abr (primeiro dia do mês)", () => {
    expect(subtrairUmMesISO("2026-05-01")).toBe("2026-04-01");
  });

  it("31 jan → 31 dez do ano anterior (cross-year sem clamp)", () => {
    expect(subtrairUmMesISO("2026-01-31")).toBe("2025-12-31");
  });
});

describe("metaProporcionalPeriodo", () => {
  it("range inteiro do mês (31 dias) → meta cheia", () => {
    const ini = new Date(2026, 4, 1); // 1 mai
    const fim = new Date(2026, 4, 31); // 31 mai
    expect(metaProporcionalPeriodo(10000, ini, fim)).toBeCloseTo(10000, 1);
  });

  it("range de 7 dias em mês de 31 → 7/31 da meta", () => {
    const ini = new Date(2026, 4, 1);
    const fim = new Date(2026, 4, 7); // 7 mai (7 dias inclusivos)
    const r = metaProporcionalPeriodo(10000, ini, fim);
    expect(r).toBeCloseTo(10000 * (7 / 31), 1);
  });

  it("range de 1 dia → 1/diasNoMes", () => {
    const ini = new Date(2026, 4, 14);
    const fim = new Date(2026, 4, 14);
    const r = metaProporcionalPeriodo(10000, ini, fim);
    expect(r).toBeCloseTo(10000 / 31, 1);
  });

  it("fevereiro 2026 (28 dias) — range cheio → meta cheia", () => {
    const ini = new Date(2026, 1, 1);
    const fim = new Date(2026, 1, 28);
    expect(metaProporcionalPeriodo(5000, ini, fim)).toBeCloseTo(5000, 1);
  });

  it("range cross-mês usa diasNoMes do dataInicio (aproximação aceita)", () => {
    // 25 abr → 5 mai = 11 dias. dataInicio é abril (30 dias). 11/30 = 36.67%.
    const ini = new Date(2026, 3, 25);
    const fim = new Date(2026, 4, 5);
    const r = metaProporcionalPeriodo(9000, ini, fim);
    expect(r).toBeCloseTo(9000 * (11 / 30), 1);
  });

  it("meta zero retorna zero", () => {
    const ini = new Date(2026, 4, 1);
    const fim = new Date(2026, 4, 14);
    expect(metaProporcionalPeriodo(0, ini, fim)).toBe(0);
  });
});
