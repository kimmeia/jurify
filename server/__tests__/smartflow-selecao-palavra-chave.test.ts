import { describe, it, expect } from "vitest";
import { selecionarCenarioPorPalavraChave } from "../smartflow/dispatcher";

type Cen = { nome: string; configGatilho: Record<string, unknown> };

const cen = (nome: string, configGatilho: Record<string, unknown> = {}): Cen => ({ nome, configGatilho });

describe("selecionarCenarioPorPalavraChave", () => {
  it("lista vazia → null", () => {
    expect(selecionarCenarioPorPalavraChave([], "oi")).toBeNull();
  });

  it("match exato vence 'começa com' (empate → exato)", () => {
    const flows = [
      cen("comeca", { palavrasChave: ["quero"], modoPalavraChave: "comeca_com" }),
      cen("exato", { palavrasChave: ["quero"], modoPalavraChave: "exato" }),
    ];
    expect(selecionarCenarioPorPalavraChave(flows, "quero")?.nome).toBe("exato");
  });

  it("usa 'começa com' quando não há exato", () => {
    const flows = [
      cen("padrao", { gatilhoPadrao: true }),
      cen("campanha", { palavrasChave: ["promo"], modoPalavraChave: "comeca_com" }),
    ];
    expect(selecionarCenarioPorPalavraChave(flows, "promo verão 2026")?.nome).toBe("campanha");
  });

  it("palavra mais longa (mais específica) vence no mesmo modo", () => {
    const flows = [
      cen("curta", { palavrasChave: ["promo"], modoPalavraChave: "comeca_com" }),
      cen("longa", { palavrasChave: ["promo verao"], modoPalavraChave: "comeca_com" }),
    ];
    expect(selecionarCenarioPorPalavraChave(flows, "promo verao black")?.nome).toBe("longa");
  });

  it("sem match → fluxo padrão", () => {
    const flows = [
      cen("campanha", { palavrasChave: ["QUERO50"], modoPalavraChave: "exato" }),
      cen("padrao", { gatilhoPadrao: true }),
    ];
    expect(selecionarCenarioPorPalavraChave(flows, "boa tarde, tudo bem?")?.nome).toBe("padrao");
  });

  it("é case-insensitive e ignora espaços nas pontas", () => {
    const flows = [cen("campanha", { palavrasChave: ["Quero50"], modoPalavraChave: "exato" })];
    expect(selecionarCenarioPorPalavraChave(flows, "  QUERO50  ")?.nome).toBe("campanha");
  });

  it("sem match e sem padrão, mas há fluxo sem palavra-chave → esse (catch-all legado)", () => {
    const flows = [
      cen("campanha", { palavrasChave: ["QUERO50"], modoPalavraChave: "exato" }),
      cen("geral", {}),
    ];
    expect(selecionarCenarioPorPalavraChave(flows, "oi")?.nome).toBe("geral");
  });

  it("sem match, sem padrão, todos com palavra-chave → null (não dispara)", () => {
    const flows = [
      cen("a", { palavrasChave: ["X"], modoPalavraChave: "exato" }),
      cen("b", { palavrasChave: ["Y"], modoPalavraChave: "comeca_com" }),
    ];
    expect(selecionarCenarioPorPalavraChave(flows, "oi")).toBeNull();
  });

  it("compat: fluxos sem config nenhuma → roda o primeiro (comportamento legado)", () => {
    const flows = [cen("primeiro", {}), cen("segundo", {})];
    expect(selecionarCenarioPorPalavraChave(flows, "qualquer coisa")?.nome).toBe("primeiro");
  });

  it("padrão explícito vence catch-all sem palavra-chave", () => {
    const flows = [
      cen("geral", {}),
      cen("padrao", { gatilhoPadrao: true }),
    ];
    expect(selecionarCenarioPorPalavraChave(flows, "oi")?.nome).toBe("padrao");
  });
});
