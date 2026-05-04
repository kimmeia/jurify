/**
 * Testes — Parcelamento "local" (N cobranças avulsas)
 *
 * Cobre:
 *   • addMonthsIso (cálculo de vencimentos sequenciais)
 *   • calcularParcelas (divisão de valor com resíduo na última)
 */

import { describe, it, expect } from "vitest";
import {
  addMonthsIso,
  calcularParcelas,
} from "../integracoes/parcelamento-local";

describe("addMonthsIso", () => {
  it("adiciona 1 mês simples", () => {
    expect(addMonthsIso("2026-01-15", 1)).toBe("2026-02-15");
  });

  it("adiciona N meses cruzando ano", () => {
    expect(addMonthsIso("2026-11-10", 3)).toBe("2027-02-10");
  });

  it("ajusta dia 31 pra fim de fevereiro (28 em ano comum)", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("ajusta dia 31 pra fim de fevereiro (29 em ano bissexto)", () => {
    expect(addMonthsIso("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("dia 30 → fevereiro vira 28/29", () => {
    expect(addMonthsIso("2026-03-30", 11)).toBe("2027-02-28");
  });

  it("0 meses retorna a mesma data", () => {
    expect(addMonthsIso("2026-05-04", 0)).toBe("2026-05-04");
  });
});

describe("calcularParcelas", () => {
  it("divide igualitário quando o total é múltiplo das parcelas", () => {
    const r = calcularParcelas(1000, 2, "2026-06-15");
    expect(r).toEqual([
      { parcelaAtual: 1, parcelaTotal: 2, valor: 500.00, vencimento: "2026-06-15" },
      { parcelaAtual: 2, parcelaTotal: 2, valor: 500.00, vencimento: "2026-07-15" },
    ]);
  });

  it("resíduo de centavos cai na última parcela", () => {
    // 1000.00 / 3 = 333.333... → 333.33 + 333.33 + 333.34 = 1000.00
    const r = calcularParcelas(1000, 3, "2026-06-15");
    expect(r.map((p) => p.valor)).toEqual([333.33, 333.33, 333.34]);
    // Soma bate exato
    const total = r.reduce((s, p) => s + p.valor, 0);
    expect(Math.round(total * 100)).toBe(100000);
  });

  it("vencimentos mensais sequenciais", () => {
    const r = calcularParcelas(900, 3, "2026-01-31");
    expect(r.map((p) => p.vencimento)).toEqual([
      "2026-01-31",
      "2026-02-28", // ajuste pro último dia do mês
      "2026-03-31",
    ]);
  });

  it("12 parcelas funciona", () => {
    const r = calcularParcelas(2400, 12, "2026-01-15");
    expect(r).toHaveLength(12);
    expect(r.every((p) => p.valor === 200)).toBe(true);
    expect(r[11].vencimento).toBe("2026-12-15");
  });

  it("24 parcelas (limite máximo) funciona", () => {
    const r = calcularParcelas(2400, 24, "2026-01-15");
    expect(r).toHaveLength(24);
    expect(r.every((p) => p.valor === 100)).toBe(true);
    // Última parcela: parcela 1 em jan/2026 + 23 meses = dez/2027
    expect(r[23].vencimento).toBe("2027-12-15");
  });

  it("rejeita parcelas < 2 (avulsa não é parcelamento)", () => {
    expect(() => calcularParcelas(1000, 1, "2026-06-15")).toThrow(/inválido/);
    expect(() => calcularParcelas(1000, 0, "2026-06-15")).toThrow(/inválido/);
  });

  it("rejeita parcelas > 24", () => {
    expect(() => calcularParcelas(1000, 25, "2026-06-15")).toThrow(/inválido/);
  });

  it("rejeita valor zero ou negativo", () => {
    expect(() => calcularParcelas(0, 3, "2026-06-15")).toThrow(/Valor total/);
    expect(() => calcularParcelas(-100, 3, "2026-06-15")).toThrow(/Valor total/);
  });

  it("valor com centavos quebrados — 100.10 / 3", () => {
    // 100.10 = 10010 cents. 10010 / 3 = 3336.66... → 3336 + 3336 + 3338 = 10010
    const r = calcularParcelas(100.10, 3, "2026-06-15");
    expect(r.map((p) => p.valor)).toEqual([33.36, 33.36, 33.38]);
    const total = Math.round(r.reduce((s, p) => s + p.valor, 0) * 100);
    expect(total).toBe(10010);
  });

  it("não introduz erro de ponto flutuante (R$ 99.99 em 7x)", () => {
    // 99.99 = 9999 cents. 9999 / 7 = 1428.43... → 6×1428 + 1×1431 = 9999
    const r = calcularParcelas(99.99, 7, "2026-06-15");
    const total = Math.round(r.reduce((s, p) => s + p.valor, 0) * 100);
    expect(total).toBe(9999);
  });
});
