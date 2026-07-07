import { describe, it, expect } from "vitest";
import { montarSystemPromptAgente } from "../juridico/agente-conversa";

describe("montarSystemPromptAgente", () => {
  it("inclui persona, regras anti-invenção e padrão forense", () => {
    const s = montarSystemPromptAgente({});
    expect(s).toMatch(/ASSISTENTE JUR[ÍI]DICO/i);
    expect(s).toMatch(/NUNCA invente/i);
    expect(s).toMatch(/ESTRAT[ÉE]GIA/i);
    expect(s).toMatch(/CAIXA ALTA/);
    expect(s).toContain("«");
  });

  it("injeta timbre do escritório, dossiê, movimentação e jurisprudência", () => {
    const s = montarSystemPromptAgente({
      escritorio: { nome: "Escritório Boyadjian", endereco: "Av. Central, 1000", cnpj: "00.000.000/0001-00", telefone: "(85) 3333-4444", email: "x@y.com" },
      advogado: "Dr. Bruno",
      oab: "CE 12.345",
      dossie: { qualificacao: "Nome: Maria", processo: "CNJ 0801234", fatosContexto: "Anotações: X" },
      movimentacao: "- 03/07/2026 [sentenca]: improcedente",
      jurisprudencia: [{ identificador: "Súmula 297/STJ", titulo: "CDC", texto: "aplica-se aos bancos" }],
    });
    expect(s).toContain("Escritório Boyadjian");
    expect(s).toContain("CNPJ 00.000.000/0001-00");
    expect(s).toContain("Dr. Bruno");
    expect(s).toContain("OAB CE 12.345");
    expect(s).toContain("Nome: Maria");
    expect(s).toContain("MOVIMENTAÇÃO PROCESSUAL");
    expect(s).toContain("improcedente");
    expect(s).toContain("Súmula 297/STJ");
  });

  it("sem jurisprudência → orienta a não inventar", () => {
    const s = montarSystemPromptAgente({ dossie: { qualificacao: "Nome: X" } });
    expect(s).toMatch(/nenhuma fonte da base/i);
  });

  it("advogado sem OAB → placeholder pra preencher", () => {
    const s = montarSystemPromptAgente({ advogado: "Dra. Ana" });
    expect(s).toContain("Dra. Ana");
    expect(s).toMatch(/OAB _____/);
  });
});
