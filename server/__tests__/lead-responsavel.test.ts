/**
 * Testes — decisão do responsável de um lead novo (puro).
 */
import { describe, it, expect } from "vitest";
import { decidirResponsavelLead } from "../escritorio/db-crm";

describe("decidirResponsavelLead", () => {
  it("usa o responsável escolhido quando válido (colaborador do escritório)", () => {
    expect(decidirResponsavelLead({ escolhido: 7, escolhidoValido: true, rodizio: 3, criador: 1 })).toBe(7);
  });

  it("escolhido inválido (fora do escritório) → cai no criador", () => {
    expect(decidirResponsavelLead({ escolhido: 99, escolhidoValido: false, rodizio: null, criador: 1 })).toBe(1);
  });

  it("sem escolha explícita → usa o rodízio", () => {
    expect(decidirResponsavelLead({ escolhido: null, escolhidoValido: false, rodizio: 5, criador: 1 })).toBe(5);
  });

  it("sem escolha e rodízio sem resultado → criador (fallback)", () => {
    expect(decidirResponsavelLead({ escolhido: null, escolhidoValido: false, rodizio: null, criador: 1 })).toBe(1);
  });
});
