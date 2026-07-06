/**
 * Testes das funções puras do redator de peças: prompt, extração/parse de
 * citações, verificação anti-invenção (grounding) e orquestração com LLM
 * injetado (sem API).
 */
import { describe, it, expect } from "vitest";
import {
  montarPromptPeca,
  extrairCitacoes,
  tokensCitacao,
  verificarCitacoesPeca,
  gerarPeca,
  TIPOS_PECA,
} from "../juridico/peca";
import type { FonteContexto } from "../juridico/avaliacao";

const TIPO = TIPOS_PECA.peticao_inicial_revisional;
const FONTES: FonteContexto[] = [
  { identificador: "Súmula 297/STJ", titulo: "CDC aplica-se aos bancos", texto: "O CDC é aplicável às instituições financeiras." },
  { identificador: "art. 42 CDC", titulo: "Repetição em dobro", texto: "Repetição do indébito em dobro." },
];

describe("montarPromptPeca", () => {
  it("system: padrão forense (caixa alta + citação recuada), proíbe invenção; user traz fatos + fontes", () => {
    const { system, user } = montarPromptPeca({ fatos: "contrato abusivo" }, FONTES, TIPO);
    expect(system).toMatch(/N[ÃA]O invente/i);
    expect(system).toContain("DOS FATOS"); // seções em CAIXA ALTA (padrão forense)
    expect(system).toMatch(/CAIXA ALTA/);
    expect(system).toContain("«"); // marcador de transcrição de jurisprudência (recuo)
    expect(user).toContain("contrato abusivo");
    expect(user).toContain("Súmula 297/STJ");
  });

  it("injeta o dossiê real (qualificação, processo, documentos) no user", () => {
    const { user } = montarPromptPeca(
      {
        fatos: "capitalização indevida",
        qualificacao: "MARIA SILVA, brasileira, casada, CPF 123",
        processo: "CNJ 0801234-56.2024.8.06.0001, valor R$ 45.000",
        documentos: "Contrato nº 4455-A; parcela subiu de 1200 para 1890",
      },
      FONTES,
      TIPO,
    );
    expect(user).toContain("QUALIFICAÇÃO DO AUTOR");
    expect(user).toContain("MARIA SILVA");
    expect(user).toContain("PROCESSO:");
    expect(user).toContain("0801234-56");
    expect(user).toContain("DOCUMENTOS ANEXADOS");
    expect(user).toContain("4455-A");
  });
});

describe("extrairCitacoes / tokensCitacao", () => {
  it("acha súmula e REsp, ignora texto comum", () => {
    const cs = extrairCitacoes("Conforme a Súmula 297/STJ e o REsp 1.061.530/RS, e um texto qualquer.");
    expect(cs.some((c) => /297/.test(c))).toBe(true);
    expect(cs.some((c) => /1\.061\.530/.test(c))).toBe(true);
  });
  it("tokeniza por tipo+número", () => {
    expect(tokensCitacao("Súmula 297/STJ")).toEqual({ tipo: "sumula", num: "297" });
    expect(tokensCitacao("REsp 1.061.530/RS")).toEqual({ tipo: "resp", num: "1061530" });
    expect(tokensCitacao("art. 42 CDC")).toBeNull();
  });
});

describe("verificarCitacoesPeca — grounding anti-invenção", () => {
  const texto =
    "Do Direito: aplica-se a Súmula 297/STJ e o art. 42 CDC ao caso. " +
    "Cita-se ainda a Súmula 999/STJ, que ampara a tese.";
  const v = verificarCitacoesPeca(texto, FONTES);

  it("marca as fontes recuperadas realmente usadas", () => {
    expect(v.fontesUsadas).toContain("Súmula 297/STJ");
    expect(v.fontesUsadas).toContain("art. 42 CDC");
  });
  it("acusa citação sem respaldo (súmula inventada)", () => {
    expect(v.suspeitas.some((s) => /999/.test(s))).toBe(true);
    // A 297 é legítima → não entra em suspeitas.
    expect(v.suspeitas.some((s) => /297/.test(s))).toBe(false);
  });
});

describe("gerarPeca (orquestrador com LLM injetado)", () => {
  it("sem fontes → erro (não chama LLM)", async () => {
    let chamou = false;
    const r = await gerarPeca({ fatos: "x" }, [], TIPO, async () => { chamou = true; return "peça"; });
    expect(r.texto).toBeNull();
    expect(r.erro).toBeTruthy();
    expect(chamou).toBe(false);
  });
  it("LLM retorna a peça → texto + verificação", async () => {
    const r = await gerarPeca({ fatos: "caso" }, FONTES, TIPO, async () => "Peça citando a Súmula 297/STJ.");
    expect(r.texto).toContain("Súmula 297/STJ");
    expect(r.verificacao?.fontesUsadas).toContain("Súmula 297/STJ");
    expect(r.verificacao?.suspeitas).toHaveLength(0);
  });
  it("LLM nulo → erro", async () => {
    const r = await gerarPeca({ fatos: "caso" }, FONTES, TIPO, async () => null);
    expect(r.texto).toBeNull();
    expect(r.erro).toBeTruthy();
  });
});
