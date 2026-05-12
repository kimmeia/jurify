/**
 * Testes pra `normalizarValorBR` e `parseValorBR`.
 *
 * Contexto: operadores digitam valores em formato brasileiro
 * ("3.000,00") e o sistema precisa normalizar pra formato US ("3000.00")
 * antes de gravar — senão `CAST('3.000' AS DECIMAL)` no MySQL retorna
 * 3.00 em vez de 3000.00 e distorce relatórios.
 *
 * A heurística de disambiguação (ponto + 3 dígitos = milhar BR) é
 * sensível; a maior parte dos casos aqui exercita exatamente ela.
 */

import { describe, expect, it } from "vitest";
import { normalizarValorBR, parseValorBR } from "../../shared/valor-br";

describe("normalizarValorBR", () => {
  it("retorna null pra entrada vazia/nula", () => {
    expect(normalizarValorBR(null)).toBeNull();
    expect(normalizarValorBR(undefined)).toBeNull();
    expect(normalizarValorBR("")).toBeNull();
    expect(normalizarValorBR("   ")).toBeNull();
  });

  it("retorna null pra entrada não-numérica", () => {
    expect(normalizarValorBR("abc")).toBeNull();
    expect(normalizarValorBR("R$")).toBeNull();
  });

  it("normaliza inteiros simples", () => {
    expect(normalizarValorBR("0")).toBe("0.00");
    expect(normalizarValorBR("3")).toBe("3.00");
    expect(normalizarValorBR("3000")).toBe("3000.00");
    expect(normalizarValorBR("1500")).toBe("1500.00");
  });

  it("normaliza formato BR com vírgula decimal", () => {
    expect(normalizarValorBR("3000,50")).toBe("3000.50");
    expect(normalizarValorBR("0,99")).toBe("0.99");
    expect(normalizarValorBR("1500,00")).toBe("1500.00");
  });

  it("normaliza formato BR com ponto-milhar (3 dígitos)", () => {
    expect(normalizarValorBR("3.000")).toBe("3000.00");
    expect(normalizarValorBR("1.500")).toBe("1500.00");
    expect(normalizarValorBR("12.500")).toBe("12500.00");
    expect(normalizarValorBR("999.999")).toBe("999999.00");
  });

  it("normaliza formato BR completo (milhar + decimal)", () => {
    expect(normalizarValorBR("3.000,00")).toBe("3000.00");
    expect(normalizarValorBR("1.500,50")).toBe("1500.50");
    expect(normalizarValorBR("1.000.000,99")).toBe("1000000.99");
  });

  it("normaliza com prefixo R$ e espaços", () => {
    expect(normalizarValorBR("R$ 3.000,00")).toBe("3000.00");
    expect(normalizarValorBR("R$3.000")).toBe("3000.00");
    expect(normalizarValorBR("  R$  1.500,50  ")).toBe("1500.50");
    expect(normalizarValorBR("r$ 100")).toBe("100.00");
  });

  it("normaliza múltiplos pontos como milhares BR", () => {
    expect(normalizarValorBR("1.000.000")).toBe("1000000.00");
    expect(normalizarValorBR("2.500.000")).toBe("2500000.00");
  });

  it("preserva formato US quando ponto não é milhar (1, 2 ou 4+ dígitos depois)", () => {
    expect(normalizarValorBR("3.5")).toBe("3.50");
    expect(normalizarValorBR("3.50")).toBe("3.50");
    expect(normalizarValorBR("3.99")).toBe("3.99");
    expect(normalizarValorBR("3.0000")).toBe("3.00");
    expect(normalizarValorBR("3000.50")).toBe("3000.50");
  });

  it("aceita number direto", () => {
    expect(normalizarValorBR(3000)).toBe("3000.00");
    expect(normalizarValorBR(1500.5)).toBe("1500.50");
    expect(normalizarValorBR(0)).toBe("0.00");
  });

  it("rejeita number não-finito", () => {
    expect(normalizarValorBR(NaN)).toBeNull();
    expect(normalizarValorBR(Infinity)).toBeNull();
    expect(normalizarValorBR(-Infinity)).toBeNull();
  });

  it("preserva negativos (operador pode usar pra estorno)", () => {
    expect(normalizarValorBR("-50")).toBe("-50.00");
    expect(normalizarValorBR("-1.500,00")).toBe("-1500.00");
  });

  it("regression: bug Beatriz — '3.000' → 3000, não 3", () => {
    expect(normalizarValorBR("3.000")).toBe("3000.00");
    expect(Number(normalizarValorBR("3.000"))).toBe(3000);
  });
});

describe("parseValorBR", () => {
  it("retorna 0 pra entrada inválida", () => {
    expect(parseValorBR(null)).toBe(0);
    expect(parseValorBR("")).toBe(0);
    expect(parseValorBR("abc")).toBe(0);
  });

  it("parseia formato BR legacy do banco", () => {
    expect(parseValorBR("3.000")).toBe(3000);
    expect(parseValorBR("1.500,00")).toBe(1500);
    expect(parseValorBR("R$ 2.500,99")).toBe(2500.99);
  });

  it("parseia formato US do banco (novos registros)", () => {
    expect(parseValorBR("3000.00")).toBe(3000);
    expect(parseValorBR("1500.50")).toBe(1500.5);
  });
});
