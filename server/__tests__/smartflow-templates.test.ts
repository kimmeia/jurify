import { describe, it, expect } from "vitest";
import { TEMPLATES_SMARTFLOW } from "../../shared/smartflow-templates";
import { TIPO_PASSO_META, GATILHO_META } from "../../shared/smartflow-types";

const TIPOS_VALIDOS = new Set(TIPO_PASSO_META.map((t) => t.id));
const GATILHOS_VALIDOS = new Set(GATILHO_META.map((g) => g.id));

describe("TEMPLATES_SMARTFLOW", () => {
  it("todo template tem gatilho válido e id único", () => {
    const ids = new Set<string>();
    for (const tpl of TEMPLATES_SMARTFLOW) {
      expect(GATILHOS_VALIDOS.has(tpl.gatilho), `gatilho inválido em ${tpl.id}`).toBe(true);
      expect(ids.has(tpl.id), `id duplicado: ${tpl.id}`).toBe(false);
      ids.add(tpl.id);
      expect(tpl.passos.length, `${tpl.id} sem passos`).toBeGreaterThan(0);
    }
  });

  it("todo passo usa um tipo conhecido", () => {
    for (const tpl of TEMPLATES_SMARTFLOW) {
      for (const p of tpl.passos) {
        expect(TIPOS_VALIDOS.has(p.tipo), `tipo desconhecido "${p.tipo}" em ${tpl.id}`).toBe(true);
      }
    }
  });

  it("todo proximoSe aponta pra um clienteId que existe no template", () => {
    for (const tpl of TEMPLATES_SMARTFLOW) {
      const clienteIds = new Set(tpl.passos.map((p) => p.clienteId));
      for (const p of tpl.passos) {
        if (!p.proximoSe) continue;
        for (const [ramo, alvo] of Object.entries(p.proximoSe)) {
          expect(
            clienteIds.has(alvo),
            `${tpl.id}: ramo "${ramo}" aponta pra "${alvo}" que não existe`,
          ).toBe(true);
        }
      }
    }
  });

  it("condicional sempre tem ao menos uma saída em proximoSe", () => {
    for (const tpl of TEMPLATES_SMARTFLOW) {
      for (const p of tpl.passos) {
        if (p.tipo !== "condicional") continue;
        const saidas = p.proximoSe ? Object.keys(p.proximoSe).length : 0;
        expect(saidas, `${tpl.id}: condicional ${p.clienteId} sem saída`).toBeGreaterThan(0);
      }
    }
  });
});
