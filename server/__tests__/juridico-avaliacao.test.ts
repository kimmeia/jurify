/**
 * Testes das funções puras da avaliação de sucesso (viabilidade): parsing do
 * JSON do modelo, composição/normalização e grounding das citações, e o
 * orquestrador com LLM injetado (sem API).
 */
import { describe, it, expect } from "vitest";
import {
  montarPromptViabilidade,
  parseAvaliacaoBruta,
  comporAvaliacao,
  avaliarViabilidade,
  type FonteContexto,
} from "../juridico/avaliacao";

const FONTES: FonteContexto[] = [
  { identificador: "Súmula 297/STJ", titulo: "CDC aplica-se aos bancos", texto: "O CDC é aplicável às instituições financeiras." },
  { identificador: "art. 42, § único, CDC", titulo: "Repetição em dobro", texto: "Repetição do indébito em dobro." },
];

describe("montarPromptViabilidade", () => {
  it("system proíbe inventar e exige JSON; user traz fatos + fontes", () => {
    const { system, user } = montarPromptViabilidade({ fatos: "contrato com capitalização", area: "revisional_bancaria" }, FONTES);
    expect(system).toMatch(/N[ÃA]O invente/i);
    expect(system).toMatch(/JSON/i);
    expect(user).toContain("contrato com capitalização");
    expect(user).toContain("Súmula 297/STJ");
  });
});

describe("parseAvaliacaoBruta", () => {
  it("JSON puro", () => {
    expect(parseAvaliacaoBruta('{"nota":"alta"}')).toEqual({ nota: "alta" });
  });
  it("JSON em cerca ```json", () => {
    expect(parseAvaliacaoBruta('```json\n{"nota":"media"}\n```')).toEqual({ nota: "media" });
  });
  it("JSON com texto em volta", () => {
    expect(parseAvaliacaoBruta('Segue a análise: {"nota":"baixa"} — fim')).toEqual({ nota: "baixa" });
  });
  it("inválido → null", () => {
    expect(parseAvaliacaoBruta("sem json aqui")).toBeNull();
    expect(parseAvaliacaoBruta(null)).toBeNull();
  });
});

describe("comporAvaliacao — normaliza e faz grounding das citações", () => {
  const bruta = {
    nota: "média-alta",
    resumo: "Boa chance",
    fatoresFavor: [
      { texto: "CDC aplicável", fonte: "Súmula 297/STJ" },
      { texto: "", fonte: "y" }, // sem texto → descartado
    ],
    fatoresContra: [{ texto: "Precedente contrário", fonte: "Súmula 999/STJ (inventada)" }],
    teses: [{ nome: "Capitalização", forca: "ALTA", observacao: "ok" }, { nome: "", forca: "x" }],
  };
  const av = comporAvaliacao(bruta, FONTES.map((f) => f.identificador));

  it('nota "média-alta" normaliza pra "alta"', () => {
    expect(av.nota).toBe("alta");
  });
  it("citação existente na base → verificada; inventada → não verificada", () => {
    expect(av.fatoresFavor[0]).toMatchObject({ fonte: "Súmula 297/STJ", fonteVerificada: true });
    expect(av.fatoresContra[0].fonteVerificada).toBe(false);
  });
  it("fatores sem texto são descartados; teses sem nome também", () => {
    expect(av.fatoresFavor).toHaveLength(1);
    expect(av.teses).toHaveLength(1);
    expect(av.teses[0]).toMatchObject({ nome: "Capitalização", forca: "alta" });
  });
});

describe("avaliarViabilidade (orquestrador com LLM injetado)", () => {
  it("sem fontes → erro claro (não chama LLM)", async () => {
    let chamou = false;
    const r = await avaliarViabilidade({ fatos: "x", area: "revisional_bancaria" }, [], async () => { chamou = true; return "{}"; });
    expect(r.avaliacao).toBeNull();
    expect(r.erro).toMatch(/base/i);
    expect(chamou).toBe(false);
  });

  it("LLM retorna JSON válido → avaliação com grounding", async () => {
    const raw = JSON.stringify({
      nota: "alta", resumo: "ok",
      fatoresFavor: [{ texto: "CDC", fonte: "Súmula 297/STJ" }],
      fatoresContra: [], teses: [{ nome: "Capitalização", forca: "alta" }],
    });
    const r = await avaliarViabilidade({ fatos: "caso", area: "revisional_bancaria" }, FONTES, async () => raw);
    expect(r.avaliacao?.nota).toBe("alta");
    expect(r.avaliacao?.fatoresFavor[0].fonteVerificada).toBe(true);
  });

  it("LLM retorna lixo → erro", async () => {
    const r = await avaliarViabilidade({ fatos: "caso", area: "revisional_bancaria" }, FONTES, async () => "desculpe, não sei");
    expect(r.avaliacao).toBeNull();
    expect(r.erro).toBeTruthy();
  });
});
