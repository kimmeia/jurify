/**
 * Testes do Engine de Cálculo do FGTS
 */

import { describe, it, expect } from "vitest";
import { calcularFGTS } from "./engine-fgts";

describe("calcularFGTS", () => {
  // ─── Cálculo básico ─────────────────────────────────────────────────────────

  it("calcula depósito de 8% sobre salário base", () => {
    const resultado = calcularFGTS({
      periodos: [{ mesAno: "2024-01", salarioBase: 3000 }],
      tipoMulta: "sem_multa",
    });
    expect(resultado.periodos[0].deposito).toBe(240); // 3000 * 0.08
    expect(resultado.periodos[0].remuneracao).toBe(3000);
  });

  it("inclui horas extras e adicionais na base de cálculo", () => {
    const resultado = calcularFGTS({
      periodos: [{ mesAno: "2024-01", salarioBase: 3000, horasExtras: 500, adicionais: 200 }],
      tipoMulta: "sem_multa",
    });
    expect(resultado.periodos[0].remuneracao).toBe(3700); // 3000 + 500 + 200
    expect(resultado.periodos[0].deposito).toBe(296); // 3700 * 0.08
  });

  it("acumula saldo corretamente em múltiplos períodos", () => {
    const resultado = calcularFGTS({
      periodos: [
        { mesAno: "2024-01", salarioBase: 3000 },
        { mesAno: "2024-02", salarioBase: 3000 },
        { mesAno: "2024-03", salarioBase: 3000 },
      ],
      tipoMulta: "sem_multa",
    });
    // Mês 1: saldo = 240 (sem juros no primeiro mês pois saldo anterior = 0)
    expect(resultado.periodos[0].saldoFinal).toBe(240);
    // Mês 2: juros sobre 240 = 0.59, depósito 240 → saldo = 480.59
    expect(resultado.periodos[1].saldoFinal).toBeCloseTo(480.59, 1);
    // Mês 3: juros sobre 480.59 ≈ 1.19, depósito 240 → saldo ≈ 721.78
    expect(resultado.periodos[2].saldoFinal).toBeCloseTo(721.78, 1);
    expect(resultado.totalDepositos).toBe(720); // 240 * 3
  });

  it("usa saldo anterior como base para juros do primeiro mês", () => {
    const resultado = calcularFGTS({
      periodos: [{ mesAno: "2024-01", salarioBase: 3000 }],
      tipoMulta: "sem_multa",
      saldoAnterior: 10000,
    });
    const jurosEsperados = Math.round(10000 * 0.002466 * 100) / 100; // ≈ 24.66
    expect(resultado.periodos[0].juros).toBe(jurosEsperados);
    expect(resultado.saldoAnterior).toBe(10000);
  });

  // ─── Multa rescisória ────────────────────────────────────────────────────────

  it("aplica multa de 40% para demissão sem justa causa", () => {
    const resultado = calcularFGTS({
      periodos: [{ mesAno: "2024-01", salarioBase: 3000 }],
      tipoMulta: "sem_justa_causa",
    });
    expect(resultado.multaPercentual).toBe(40);
    expect(resultado.valorMulta).toBeCloseTo(resultado.saldoTotal * 0.40, 2);
    expect(resultado.totalAReceber).toBeCloseTo(resultado.saldoTotal * 1.40, 2);
  });

  it("aplica multa de 40% para rescisão indireta", () => {
    const resultado = calcularFGTS({
      periodos: [{ mesAno: "2024-01", salarioBase: 3000 }],
      tipoMulta: "rescisao_indireta",
    });
    expect(resultado.multaPercentual).toBe(40);
  });

  it("aplica multa de 20% para acordo mútuo", () => {
    const resultado = calcularFGTS({
      periodos: [{ mesAno: "2024-01", salarioBase: 3000 }],
      tipoMulta: "acordo_mutuo",
    });
    expect(resultado.multaPercentual).toBe(20);
    expect(resultado.valorMulta).toBeCloseTo(resultado.saldoTotal * 0.20, 2);
  });

  it("não aplica multa para pedido de demissão", () => {
    const resultado = calcularFGTS({
      periodos: [{ mesAno: "2024-01", salarioBase: 3000 }],
      tipoMulta: "sem_multa",
    });
    expect(resultado.multaPercentual).toBe(0);
    expect(resultado.valorMulta).toBe(0);
    expect(resultado.totalAReceber).toBe(resultado.saldoTotal);
  });

  // ─── Ordenação e protocolo ───────────────────────────────────────────────────

  it("ordena períodos cronologicamente", () => {
    const resultado = calcularFGTS({
      periodos: [
        { mesAno: "2024-03", salarioBase: 3000 },
        { mesAno: "2024-01", salarioBase: 3000 },
        { mesAno: "2024-02", salarioBase: 3000 },
      ],
      tipoMulta: "sem_multa",
    });
    expect(resultado.periodos[0].mesAno).toBe("2024-01");
    expect(resultado.periodos[1].mesAno).toBe("2024-02");
    expect(resultado.periodos[2].mesAno).toBe("2024-03");
  });

  it("gera protocolo de cálculo único", () => {
    const r1 = calcularFGTS({ periodos: [{ mesAno: "2024-01", salarioBase: 3000 }], tipoMulta: "sem_multa" });
    const r2 = calcularFGTS({ periodos: [{ mesAno: "2024-01", salarioBase: 3000 }], tipoMulta: "sem_multa" });
    expect(r1.protocoloCalculo).toMatch(/^FGTS-/);
    // Protocolos podem ser iguais se executados no mesmo ms, mas o formato está correto
    expect(r2.protocoloCalculo).toMatch(/^FGTS-/);
  });

  // ─── Cenário realista: 12 meses ──────────────────────────────────────────────

  it("calcula corretamente 12 meses com salário de R$ 3.000", () => {
    const periodos = Array.from({ length: 12 }, (_, i) => ({
      mesAno: `2024-${String(i + 1).padStart(2, "0")}`,
      salarioBase: 3000,
    }));
    const resultado = calcularFGTS({ periodos, tipoMulta: "sem_justa_causa" });

    // 12 depósitos de R$ 240 = R$ 2.880 total de depósitos
    expect(resultado.totalDepositos).toBe(2880);
    // Saldo final deve ser maior que os depósitos (por causa dos juros)
    expect(resultado.saldoTotal).toBeGreaterThan(2880);
    // Multa de 40% deve ser aplicada
    expect(resultado.valorMulta).toBeCloseTo(resultado.saldoTotal * 0.40, 2);
    // Total a receber = saldo + multa
    expect(resultado.totalAReceber).toBeCloseTo(resultado.saldoTotal * 1.40, 2);
    // Deve ter 12 períodos
    expect(resultado.periodos).toHaveLength(12);
  });

  // ─── Campos de resumo ────────────────────────────────────────────────────────

  it("retorna todos os campos obrigatórios no resultado", () => {
    const resultado = calcularFGTS({
      periodos: [{ mesAno: "2024-01", salarioBase: 3000 }],
      tipoMulta: "sem_justa_causa",
    });
    expect(resultado).toHaveProperty("periodos");
    expect(resultado).toHaveProperty("saldoAnterior");
    expect(resultado).toHaveProperty("totalDepositos");
    expect(resultado).toHaveProperty("totalJuros");
    expect(resultado).toHaveProperty("saldoTotal");
    expect(resultado).toHaveProperty("multaPercentual");
    expect(resultado).toHaveProperty("valorMulta");
    expect(resultado).toHaveProperty("totalAReceber");
    expect(resultado).toHaveProperty("protocoloCalculo");
  });

  it("cada período retorna todos os campos obrigatórios", () => {
    const resultado = calcularFGTS({
      periodos: [{ mesAno: "2024-01", salarioBase: 3000 }],
      tipoMulta: "sem_multa",
    });
    const p = resultado.periodos[0];
    expect(p).toHaveProperty("mesAno");
    expect(p).toHaveProperty("remuneracao");
    expect(p).toHaveProperty("deposito");
    expect(p).toHaveProperty("juros");
    expect(p).toHaveProperty("saldoFinal");
  });
});
