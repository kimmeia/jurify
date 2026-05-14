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
  mesVigente,
  subtrairUmMesClamped,
  metaProporcionalPeriodo,
} from "../escritorio/router-relatorios";

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

describe("mesVigente", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dataInicio é o dia 1 do mês corrente (00:00 local)", () => {
    vi.setSystemTime(new Date("2026-05-14T15:30:00"));
    const { dataInicio, dataFim } = mesVigente();
    expect(dataInicio.getDate()).toBe(1);
    expect(dataInicio.getMonth()).toBe(4); // mai = 4
    expect(dataInicio.getFullYear()).toBe(2026);
    expect(dataInicio.getHours()).toBe(0);
    expect(dataInicio.getMinutes()).toBe(0);
    // dataFim = agora
    expect(dataFim.getDate()).toBe(14);
  });

  it("funciona em janeiro (boundary do ano)", () => {
    vi.setSystemTime(new Date("2026-01-05T10:00:00"));
    const { dataInicio } = mesVigente();
    expect(dataInicio.getMonth()).toBe(0);
    expect(dataInicio.getDate()).toBe(1);
    expect(dataInicio.getFullYear()).toBe(2026);
  });
});

describe("subtrairUmMesClamped", () => {
  it("preserva o dia quando o mês anterior também tem aquele dia", () => {
    // 15 jun → 15 mai
    const r = subtrairUmMesClamped(new Date(2026, 5, 15, 10, 30));
    expect(r.getFullYear()).toBe(2026);
    expect(r.getMonth()).toBe(4); // mai
    expect(r.getDate()).toBe(15);
    expect(r.getHours()).toBe(10);
    expect(r.getMinutes()).toBe(30);
  });

  it("31 mar → 28 fev (clamp pro último dia, NÃO rola pra 3 mar)", () => {
    const r = subtrairUmMesClamped(new Date(2026, 2, 31));
    expect(r.getMonth()).toBe(1); // fev
    expect(r.getDate()).toBe(28); // 2026 não é bissexto
    expect(r.getFullYear()).toBe(2026);
  });

  it("31 mai → 30 abr (abr tem 30 dias)", () => {
    const r = subtrairUmMesClamped(new Date(2026, 4, 31));
    expect(r.getMonth()).toBe(3); // abr
    expect(r.getDate()).toBe(30);
  });

  it("29 mar 2024 → 29 fev 2024 (bissexto preserva)", () => {
    const r = subtrairUmMesClamped(new Date(2024, 2, 29));
    expect(r.getMonth()).toBe(1); // fev
    expect(r.getDate()).toBe(29);
  });

  it("29 mar 2026 → 28 fev 2026 (não-bissexto clampa)", () => {
    const r = subtrairUmMesClamped(new Date(2026, 2, 29));
    expect(r.getMonth()).toBe(1);
    expect(r.getDate()).toBe(28);
  });

  it("15 jan → 15 dez do ano anterior (cross-year)", () => {
    const r = subtrairUmMesClamped(new Date(2026, 0, 15));
    expect(r.getMonth()).toBe(11); // dez
    expect(r.getDate()).toBe(15);
    expect(r.getFullYear()).toBe(2025);
  });

  it("não muta o input", () => {
    const input = new Date(2026, 2, 31);
    const inputTime = input.getTime();
    subtrairUmMesClamped(input);
    expect(input.getTime()).toBe(inputTime);
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
