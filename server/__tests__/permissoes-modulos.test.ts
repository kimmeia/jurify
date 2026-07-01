/**
 * Guarda anti-drift da fonte única de módulos de permissão.
 *
 * O bug original: "Modelos" não existia no sistema de permissões e "Tarefas"
 * existia no backend mas sumia da matriz do front, porque cada ponta tinha a
 * própria lista hardcoded. Centralizamos em shared/permissoes-modulos.ts —
 * estes testes garantem que a lista, os rótulos e a herança fiquem coerentes.
 */
import { describe, it, expect } from "vitest";
import { MODULOS, MODULOS_LABELS, MODULO_HERANCA } from "../../shared/permissoes-modulos";

describe("permissoes-modulos (fonte única)", () => {
  it("inclui os módulos que faltavam: modelos e tarefas", () => {
    expect(MODULOS).toContain("modelos");
    expect(MODULOS).toContain("tarefas");
  });

  it("todo módulo tem um rótulo (sem drift matriz × backend)", () => {
    for (const m of MODULOS) {
      expect(MODULOS_LABELS[m], `faltando rótulo para "${m}"`).toBeTruthy();
    }
  });

  it("não há rótulo órfão (label sem módulo correspondente)", () => {
    for (const chave of Object.keys(MODULOS_LABELS)) {
      expect(MODULOS, `rótulo "${chave}" sem módulo`).toContain(chave as any);
    }
  });

  it("sem módulos duplicados", () => {
    expect(new Set(MODULOS).size).toBe(MODULOS.length);
  });

  it("herança aponta modelos→clientes e tarefas→agenda", () => {
    expect(MODULO_HERANCA.modelos).toBe("clientes");
    expect(MODULO_HERANCA.tarefas).toBe("agenda");
  });

  it("herança referencia apenas módulos válidos (chave e base)", () => {
    for (const [mod, base] of Object.entries(MODULO_HERANCA)) {
      expect(MODULOS, `herança de módulo inexistente "${mod}"`).toContain(mod as any);
      expect(MODULOS, `herança para base inexistente "${base}"`).toContain(base as any);
    }
  });
});
