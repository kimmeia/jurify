import { describe, expect, it } from "vitest";
import { coercaoPorTipo } from "./agente-captura-campos";

describe("coercaoPorTipo — edição inline de campos capturados", () => {
  describe("vazio/null", () => {
    it.each([null, undefined, "", "   "])("retorna null para entrada %p", (entrada) => {
      expect(coercaoPorTipo(entrada, "texto", null)).toBeNull();
    });
  });

  describe("numero", () => {
    it("aceita inteiro ISO", () => {
      expect(coercaoPorTipo("50000", "numero", null)).toBe(50000);
    });

    it("aceita decimal ISO", () => {
      expect(coercaoPorTipo("50000.50", "numero", null)).toBe(50000.5);
    });

    it("aceita formato BR (ponto milhar + vírgula decimal)", () => {
      expect(coercaoPorTipo("1.234,56", "numero", null)).toBeCloseTo(1234.56);
    });

    it("rejeita string não numérica", () => {
      expect(() => coercaoPorTipo("abc", "numero", null)).toThrow(/não é um número/);
    });
  });

  describe("boolean", () => {
    it.each([
      ["true", true],
      ["sim", true],
      ["1", true],
      ["false", false],
      ["não", false],
      ["nao", false],
      ["0", false],
    ] as const)("converte %s pra %s", (entrada, esperado) => {
      expect(coercaoPorTipo(entrada, "boolean", null)).toBe(esperado);
    });

    it("rejeita string inválida", () => {
      expect(() => coercaoPorTipo("talvez", "boolean", null)).toThrow(/boolean/);
    });
  });

  describe("data", () => {
    it("aceita ISO YYYY-MM-DD", () => {
      expect(coercaoPorTipo("2026-05-21", "data", null)).toBe("2026-05-21");
    });

    it("converte BR DD/MM/YYYY pra ISO", () => {
      expect(coercaoPorTipo("21/05/2026", "data", null)).toBe("2026-05-21");
    });

    it("rejeita formato inválido", () => {
      expect(() => coercaoPorTipo("21-5-26", "data", null)).toThrow(/inválida/);
    });
  });

  describe("select", () => {
    const opcoes = JSON.stringify(["online", "presencial"]);

    it("aceita opção válida", () => {
      expect(coercaoPorTipo("online", "select", opcoes)).toBe("online");
    });

    it("rejeita opção fora da lista", () => {
      expect(() => coercaoPorTipo("híbrido", "select", opcoes)).toThrow(/não está nas opções/);
    });

    it("aceita qualquer string quando opcoesJson é null", () => {
      expect(coercaoPorTipo("qualquer coisa", "select", null)).toBe("qualquer coisa");
    });

    it("tolera opcoesJson inválido (string crua)", () => {
      expect(coercaoPorTipo("qualquer", "select", "{lixo")).toBe("qualquer");
    });
  });

  describe("texto/textarea", () => {
    it.each(["texto", "textarea"])("retorna string trimada para tipo %s", (tipo) => {
      expect(coercaoPorTipo("  oi  ", tipo, null)).toBe("oi");
    });

    it("coerce número pra string em texto", () => {
      expect(coercaoPorTipo(123, "texto", null)).toBe("123");
    });
  });
});
