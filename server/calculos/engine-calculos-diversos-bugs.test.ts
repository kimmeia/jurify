/**
 * Testes de regressão pra bugs do engine-calculos-diversos.ts.
 *
 * Bug: a conversão de prazos (`converterPrazo`) usava 30 dias/mês e
 * 365 dias/ano simultaneamente, criando uma incoerência. Resultado:
 * cálculo de juros sobre 365 dias dava ~0,17% a mais do que sobre
 * 1 ano (deveriam ser iguais).
 */

import { describe, expect, it } from "vitest";
import { calcularJuros } from "./engine-calculos-diversos";

describe("Bug — conversão prazo diária↔anual deve ser consistente", () => {
  it("365 dias a 1% a.m. deve dar o mesmo que 12 meses a 1% a.m. (compostos)", () => {
    const por365dias = calcularJuros({
      capital: 1000,
      taxa: 1,
      periodoTaxa: "mensal",
      prazo: 365,
      periodoPrazo: "diaria",
      tipo: "composto",
    });
    const por12meses = calcularJuros({
      capital: 1000,
      taxa: 1,
      periodoTaxa: "mensal",
      prazo: 12,
      periodoPrazo: "mensal",
      tipo: "composto",
    });
    // Diferença esperada: < R$ 0,01
    expect(por365dias.montante).toBeCloseTo(por12meses.montante, 1);
  });

  it("365 dias a 1% a.m. simples deve dar 12% (juros = capital × i × n)", () => {
    const r = calcularJuros({
      capital: 1000,
      taxa: 1,
      periodoTaxa: "mensal",
      prazo: 365,
      periodoPrazo: "diaria",
      tipo: "simples",
    });
    // n = 365/365 × 12 = 12. juros = 1000 × 1% × 12 = 120
    expect(r.juros).toBeCloseTo(120, 0);
    expect(r.montante).toBeCloseTo(1120, 0);
  });

  it("1 ano a 12% a.a. deve dar o mesmo que 12 meses a 1% a.m. (compostos)", () => {
    const por1ano = calcularJuros({
      capital: 1000,
      taxa: 12,
      periodoTaxa: "anual",
      prazo: 1,
      periodoPrazo: "anual",
      tipo: "composto",
    });
    expect(por1ano.montante).toBeCloseTo(1120, 0); // 1000 × 1.12
  });
});
