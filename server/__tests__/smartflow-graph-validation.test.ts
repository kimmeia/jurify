/**
 * Testes de `validarGrafo` — função pura usada pelo editor antes de salvar.
 */

import { describe, it, expect } from "vitest";
import {
  validarGrafo,
  type PassoValidar,
  type EdgeValidar,
} from "../../shared/smartflow-graph-validation";

function passo(nodeId: string, clienteId: string, tipo: PassoValidar["tipo"] = "whatsapp_enviar"): PassoValidar {
  return { nodeId, clienteId, tipo, config: {}, temProximoSe: false };
}

describe("validarGrafo", () => {
  it("aceita cenário vazio como erro (bloqueia)", () => {
    const r = validarGrafo("gat", [], []);
    expect(r.erros).toContain("Adicione pelo menos um passo ao cenário.");
    expect(r.avisos).toEqual([]);
  });

  it("aceita fluxo linear válido sem avisos nem erros", () => {
    const passos = [passo("p1", "c1"), passo("p2", "c2"), passo("p3", "c3")];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "p2" },
      { source: "p2", target: "p3" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it("detecta ciclo — passo que aponta pra si mesmo", () => {
    const passos = [passo("p1", "c1")];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "p1" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros.join("|")).toContain("Ciclo detectado");
  });

  it("detecta ciclo indireto — A → B → A", () => {
    const passos = [passo("p1", "c1"), passo("p2", "c2")];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "p2" },
      { source: "p2", target: "p1" }, // volta
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros.join("|")).toContain("Ciclo detectado");
  });

  it("detecta ciclo em grafo longo — A → B → C → D → B", () => {
    const passos = [passo("p1", "c1"), passo("p2", "c2"), passo("p3", "c3"), passo("p4", "c4")];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "p2" },
      { source: "p2", target: "p3" },
      { source: "p3", target: "p4" },
      { source: "p4", target: "p2" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros.join("|")).toContain("Ciclo detectado");
  });

  it("aviso — passo órfão (desconectado do gatilho)", () => {
    const passos = [passo("p1", "c1"), passo("p2", "c2")];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      // p2 não é alcançável
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros).toEqual([]);
    expect(r.avisos.join("|")).toContain("desconectado");
  });

  it("aviso — condicional sem saídas conectadas", () => {
    const passos = [
      passo("p1", "c1"),
      { nodeId: "pcond", clienteId: "cc", tipo: "condicional" as const, config: {}, temProximoSe: true },
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "pcond" },
      // pcond sem saída
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros).toEqual([]);
    expect(r.avisos.some((a) => a.includes("condicional"))).toBe(true);
  });

  it("condicional com saída não gera aviso", () => {
    const passos = [
      { nodeId: "pcond", clienteId: "cc", tipo: "condicional" as const, config: {}, temProximoSe: true },
      passo("p1", "c1"),
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "pcond" },
      { source: "pcond", target: "p1", sourceHandle: "fallback" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.avisos).toEqual([]);
  });

  it("grafo com ramos paralelos é válido (não é ciclo)", () => {
    // gat → cond; cond → p1 (cond_a); cond → p2 (fallback); ambos levam a p3
    const passos = [
      { nodeId: "pcond", clienteId: "cc", tipo: "condicional" as const, config: {}, temProximoSe: true },
      passo("p1", "c1"),
      passo("p2", "c2"),
      passo("p3", "c3"),
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "pcond" },
      { source: "pcond", target: "p1", sourceHandle: "cond_a" },
      { source: "pcond", target: "p2", sourceHandle: "fallback" },
      { source: "p1", target: "p3" },
      { source: "p2", target: "p3" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it("combina erros e avisos quando aplicável", () => {
    const passos = [passo("p1", "c1"), passo("p2", "c2"), passo("p3", "c3")];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "p1" }, // ciclo → erro
      // p2, p3 órfãos → aviso
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros.length).toBeGreaterThan(0);
    expect(r.avisos.length).toBeGreaterThan(0);
  });
});
