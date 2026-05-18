/**
 * Testes do mapeamento row → Plano em `planos-repo`.
 *
 * Foco em cobertura das funções puras (sem DB): parse de JSON arrays,
 * validação de módulos, normalização de tipos. Os testes que exercitam
 * o cache em memória ficam em integração (precisam de DB).
 */

import { describe, it, expect } from "vitest";
import { ehModuloValido, MODULOS_APP, MODULOS_APP_OBRIGATORIOS } from "@shared/modulos-app";
import { ehIlimitado, LIMITE_ILIMITADO, PLANOS_PADRAO_SLUGS } from "@shared/planos-types";

describe("MODULOS_APP", () => {
  it("tem ao menos os módulos obrigatórios (dashboard, configuracoes)", () => {
    expect(MODULOS_APP_OBRIGATORIOS).toContain("dashboard");
    expect(MODULOS_APP_OBRIGATORIOS).toContain("configuracoes");
  });

  it("todos os slugs são únicos", () => {
    const slugs = MODULOS_APP.map((m) => m.id);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("ehModuloValido reconhece slugs válidos", () => {
    expect(ehModuloValido("dashboard")).toBe(true);
    expect(ehModuloValido("atendimento")).toBe(true);
    expect(ehModuloValido("inexistente")).toBe(false);
  });

  it("ehModuloValido rejeita strings vazias/lixo", () => {
    expect(ehModuloValido("")).toBe(false);
    expect(ehModuloValido("  ")).toBe(false);
    expect(ehModuloValido("DASHBOARD")).toBe(false);
  });
});

describe("ehIlimitado", () => {
  it("null e undefined viram ilimitado", () => {
    expect(ehIlimitado(null)).toBe(true);
    expect(ehIlimitado(undefined)).toBe(true);
  });

  it("valores ≥ LIMITE_ILIMITADO viram ilimitado (compat retroativa)", () => {
    expect(ehIlimitado(LIMITE_ILIMITADO)).toBe(true);
    expect(ehIlimitado(LIMITE_ILIMITADO + 1)).toBe(true);
    expect(ehIlimitado(999999)).toBe(true);
  });

  it("zero e números pequenos NÃO são ilimitado", () => {
    expect(ehIlimitado(0)).toBe(false);
    expect(ehIlimitado(1)).toBe(false);
    expect(ehIlimitado(100)).toBe(false);
  });
});

describe("PLANOS_PADRAO_SLUGS", () => {
  it("contém os 4 planos do seed", () => {
    expect(PLANOS_PADRAO_SLUGS).toEqual(["free", "basico", "intermediario", "completo"]);
  });
});
