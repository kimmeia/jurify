import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A chave de IA agora vem do resolver compartilhado (admin_integracoes /
// escritório), não de process.env. Mockamos o resolver pra controlar
// provider+chave nos testes sem tocar em DB nem env.
const { resolverChaveIAEscritorioMock } = vi.hoisted(() => ({
  resolverChaveIAEscritorioMock: vi.fn(),
}));

vi.mock("../_core/ai-call", () => ({
  resolverChaveIAEscritorio: resolverChaveIAEscritorioMock,
}));

import {
  providerDoModelo,
  resumirMovimentacao,
  parseClassificacao,
  MODELO_DEFAULT,
  MODELO_DEFAULT_ANTHROPIC,
  pontoUtil,
  parseItens,
  parseAnalise,
} from "./resumir-movimentacao";

describe("providerDoModelo (dispatch por prefixo)", () => {
  it("modelos OpenAI → openai", () => {
    expect(providerDoModelo("gpt-4o-mini")).toBe("openai");
    expect(providerDoModelo("gpt-4o")).toBe("openai");
    expect(providerDoModelo("gpt-4-turbo")).toBe("openai");
    expect(providerDoModelo("o1-preview")).toBe("openai");
    expect(providerDoModelo("o3-mini")).toBe("openai");
    expect(providerDoModelo("o4-mini")).toBe("openai");
  });

  it("modelos Claude → anthropic", () => {
    expect(providerDoModelo("claude-haiku-4-5-20251001")).toBe("anthropic");
    expect(providerDoModelo("claude-opus-4-7")).toBe("anthropic");
    expect(providerDoModelo("claude-sonnet-4-6")).toBe("anthropic");
  });

  it("case-insensitive e tolerante a whitespace", () => {
    expect(providerDoModelo("  GPT-4o-mini  ")).toBe("openai");
    expect(providerDoModelo("Claude-Haiku-4-5")).toBe("anthropic");
  });

  it("modelos desconhecidos → desconhecido (graceful)", () => {
    expect(providerDoModelo("llama-3")).toBe("desconhecido");
    expect(providerDoModelo("mistral")).toBe("desconhecido");
    expect(providerDoModelo("")).toBe("desconhecido");
    expect(providerDoModelo("invalid")).toBe("desconhecido");
  });
});

describe("MODELO_DEFAULT", () => {
  it("default é GPT-4o-mini (escolha mais barata do user)", () => {
    expect(MODELO_DEFAULT).toBe("gpt-4o-mini");
  });
  it("default Anthropic é Haiku (barato pra alto volume)", () => {
    expect(MODELO_DEFAULT_ANTHROPIC).toBe("claude-haiku-4-5-20251001");
  });
});

describe("resumirMovimentacao (graceful degradation)", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    resolverChaveIAEscritorioMock.mockReset();
    // Default: chave OpenAI disponível. Testes que precisam de outra fonte
    // (ou de nenhuma) sobrescrevem.
    resolverChaveIAEscritorioMock.mockResolvedValue({ apiKey: "sk-test", provider: "openai" });
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("texto curto demais → null (não gasta token)", async () => {
    const r = await resumirMovimentacao("Conclusos", "gpt-4o-mini");
    expect(r).toBeNull();
  });

  it("texto vazio → null", async () => {
    expect(await resumirMovimentacao("", "gpt-4o-mini")).toBeNull();
    expect(await resumirMovimentacao("   ", "gpt-4o-mini")).toBeNull();
  });

  it("sem chave de IA configurada → null (silent fallback)", async () => {
    resolverChaveIAEscritorioMock.mockResolvedValue(null);
    const texto =
      "Despacho dos autos: defiro o pedido de tutela antecipada formulado pela parte autora, " +
      "determinando a suspensão da exigibilidade do crédito tributário até decisão final.";
    const r = await resumirMovimentacao(texto, "gpt-4o-mini");
    expect(r).toBeNull();
  });

  it("OpenAI 200 OK → retorna conteúdo trimmed", async () => {
    resolverChaveIAEscritorioMock.mockResolvedValue({ apiKey: "sk-test", provider: "openai" });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "  Tutela antecipada deferida.  " } }],
      }),
    } as any);
    const texto =
      "Despacho dos autos: defiro o pedido de tutela antecipada formulado pela parte autora, " +
      "determinando a suspensão da exigibilidade do crédito tributário até decisão final.";
    const r = await resumirMovimentacao(texto, "gpt-4o-mini");
    expect(r).toBe("Tutela antecipada deferida.");
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(call[1].headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("Anthropic 200 OK → retorna conteúdo trimmed", async () => {
    resolverChaveIAEscritorioMock.mockResolvedValue({ apiKey: "sk-ant-test", provider: "anthropic" });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: "  Sentença procedente.  " }] }),
    } as any);
    const texto =
      "Sentença: julgo procedente o pedido inicial, condenando a ré ao pagamento de R$ 50.000,00, " +
      "acrescido de correção monetária e juros legais desde a citação.";
    const r = await resumirMovimentacao(texto, "claude-haiku-4-5-20251001");
    expect(r).toBe("Sentença procedente.");
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(call[1].headers["x-api-key"]).toBe("sk-ant-test");
    expect(call[1].headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe("claude-haiku-4-5-20251001");
  });

  it("chave disponível não serve o modelo configurado → usa default do provider", async () => {
    // Escritório configurou modelo gpt-* mas só há chave Claude → a chave manda:
    // cai no default Anthropic em vez de falhar em silêncio.
    resolverChaveIAEscritorioMock.mockResolvedValue({ apiKey: "sk-ant-test", provider: "anthropic" });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: "resumo" }] }),
    } as any);
    const texto =
      "Despacho dos autos: defiro o pedido de tutela antecipada formulado pela parte autora, " +
      "determinando a suspensão da exigibilidade do crédito tributário.";
    await resumirMovimentacao(texto, "gpt-4o-mini");
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe(MODELO_DEFAULT_ANTHROPIC);
  });

  it("OpenAI HTTP 500 → null (não propaga erro)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "internal error",
    } as any);
    const texto = "Despacho dos autos: defiro o pedido de tutela antecipada formulado pela parte autora.";
    const r = await resumirMovimentacao(texto, "gpt-4o-mini");
    expect(r).toBeNull();
  });

  it("fetch lança exceção genérica → null (silent)", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network down"));
    const texto = "Despacho dos autos: defiro o pedido de tutela antecipada formulado pela parte autora.";
    const r = await resumirMovimentacao(texto, "gpt-4o-mini");
    expect(r).toBeNull();
  });

  it("AbortError (timeout) → null", async () => {
    const abortErr: any = new Error("aborted");
    abortErr.name = "AbortError";
    global.fetch = vi.fn().mockRejectedValueOnce(abortErr);
    const texto = "Despacho dos autos: defiro o pedido de tutela antecipada formulado pela parte autora.";
    const r = await resumirMovimentacao(texto, "gpt-4o-mini");
    expect(r).toBeNull();
  });

  it("resposta com choices vazio → null", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [] }),
    } as any);
    const texto = "Despacho dos autos: defiro o pedido de tutela antecipada formulado pela parte autora.";
    const r = await resumirMovimentacao(texto, "gpt-4o-mini");
    expect(r).toBeNull();
  });

  it("trunca input >4000 chars antes de mandar (não gasta token à toa)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "resumo" } }] }),
    } as any);
    const enorme = "Sentença: " + "x".repeat(10000);
    await resumirMovimentacao(enorme, "gpt-4o-mini");
    const call = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(call[1].body);
    const userMsg = body.messages.find((m: any) => m.role === "user");
    expect(userMsg.content.length).toBeLessThanOrEqual(4000);
  });
});

describe("parseClassificacao (JSON estruturado + fallback)", () => {
  it("JSON válido → resumo + desfecho + relevancia", () => {
    const r = parseClassificacao('{"resumo":"Sentença procedente","relevancia":"relevante","desfecho":"favoravel"}');
    expect(r).toEqual({ resumo: "Sentença procedente", desfecho: "favoravel", relevancia: "relevante" });
  });

  it("tolera crases/markdown ao redor do JSON", () => {
    const raw = "```json\n{\"resumo\":\"Conclusos\",\"relevancia\":\"rotina\",\"desfecho\":null}\n```";
    const r = parseClassificacao(raw);
    expect(r).toEqual({ resumo: "Conclusos", desfecho: null, relevancia: "rotina" });
  });

  it("desfecho inválido → null (não quebra)", () => {
    const r = parseClassificacao('{"resumo":"X","relevancia":"relevante","desfecho":"ganhamos"}');
    expect(r?.desfecho).toBeNull();
  });

  it("relevancia ausente/estranha → default 'relevante'", () => {
    const r = parseClassificacao('{"resumo":"X"}');
    expect(r?.relevancia).toBe("relevante");
    expect(r?.desfecho).toBeNull();
  });

  it("resposta não-JSON → fallback usa o texto como resumo, sem selo", () => {
    const r = parseClassificacao("Apenas texto solto sem json aqui");
    expect(r?.resumo).toBe("Apenas texto solto sem json aqui");
    expect(r?.desfecho).toBeNull();
    expect(r?.relevancia).toBe("relevante");
  });

  it("vazio → null", () => {
    expect(parseClassificacao("")).toBeNull();
    expect(parseClassificacao("{}")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Placar por pedido e barreira anti-enchimento
//
// O painel exibia, sob o selo RESUMO IA, quatro frases que só diziam que a
// IA não tinha o documento ("não há informações sobre valores", "a decisão
// pode impactar a estratégia das partes"). O prompt já pedia pra não fazer
// isso e o modelo fez assim mesmo — por isso a barreira aqui é código, não
// instrução.
// ─────────────────────────────────────────────────────────────────────────

describe("pontoUtil", () => {
  it("derruba as frases que só dizem que não se sabe", () => {
    const enchimento = [
      "Não há informações sobre valores ou condições específicas.",
      "Detalhes adicionais não estão disponíveis no rótulo.",
      "A decisão pode impactar a estratégia das partes.",
      "Não foram informados os valores da condenação.",
      "Recomenda-se a consulta aos autos para mais detalhes.",
      "É necessário consultar os autos para entender a decisão.",
      "Sem mais informações disponíveis.",
    ];
    for (const p of enchimento) {
      expect(pontoUtil(p), p).toBe(false);
    }
  });

  it("mantém o que afirma alguma coisa", () => {
    const uteis = [
      "O juiz afastou a capitalização mensal de juros e determinou a devolução em dobro.",
      "Dano moral negado: o magistrado classificou a cobrança como mero aborrecimento.",
      "Perícia contábil deferida, com honorários de R$ 3.200 a cargo do banco.",
      "Prazo de 15 dias úteis para apelar, contados da intimação.",
    ];
    for (const p of uteis) {
      expect(pontoUtil(p), p).toBe(true);
    }
  });

  it("derruba frase curta demais pra afirmar qualquer coisa", () => {
    expect(pontoUtil("Sentença publicada")).toBe(false);
    expect(pontoUtil("Ok")).toBe(false);
  });

  it("não confunde negação legítima com enchimento", () => {
    // "não há prova" é uma afirmação do juiz sobre o mérito, não sobre a
    // ausência do documento.
    expect(pontoUtil("Não há prova do dano alegado, segundo o juiz.")).toBe(true);
  });
});

describe("parseItens", () => {
  it("aceita o placar completo", () => {
    const itens = parseItens([
      { pedido: "Revisão dos juros", status: "deferido", razao: "Capitalização afastada", valor: 12480 },
      { pedido: "Dano moral", status: "negado", razao: "Mero aborrecimento", valor: null },
    ]);
    expect(itens).toHaveLength(2);
    expect(itens[0]).toEqual({
      pedido: "Revisão dos juros", status: "deferido", razao: "Capitalização afastada", valor: 12480,
    });
    expect(itens[1].valor).toBeNull();
  });

  it("descarta item sem pedido ou com status inventado", () => {
    expect(parseItens([{ pedido: "", status: "deferido" }])).toEqual([]);
    expect(parseItens([{ pedido: "Dano moral", status: "ganhou" }])).toEqual([]);
    expect(parseItens([{ pedido: "Dano moral" }])).toEqual([]);
  });

  it("recusa valor que não é número — 'R$ 12.480,00' somaria errado", () => {
    const [item] = parseItens([{ pedido: "Juros", status: "deferido", valor: "R$ 12.480,00" }]);
    expect(item.valor).toBeNull();
  });

  it("recusa valor zero ou negativo", () => {
    expect(parseItens([{ pedido: "X", status: "deferido", valor: 0 }])[0].valor).toBeNull();
    expect(parseItens([{ pedido: "X", status: "deferido", valor: -50 }])[0].valor).toBeNull();
  });

  it("arredonda pra centavos", () => {
    expect(parseItens([{ pedido: "X", status: "deferido", valor: 1234.5678 }])[0].valor).toBe(1234.57);
  });

  it("devolve lista vazia pro que não é lista", () => {
    expect(parseItens(undefined)).toEqual([]);
    expect(parseItens(null)).toEqual([]);
    expect(parseItens("procedente")).toEqual([]);
  });

  it("limita a 12 itens", () => {
    const muitos = Array.from({ length: 30 }, (_, i) => ({ pedido: `Pedido ${i}`, status: "deferido" }));
    expect(parseItens(muitos)).toHaveLength(12);
  });
});

describe("parseAnalise com placar", () => {
  const base = {
    titulo: "Banco condenado a devolver R$ 18.402",
    ato: "sentenca",
    desfecho: "parcial",
    relevancia: "relevante",
    providencia: { exigida: false },
  };

  it("traz os itens junto da análise", () => {
    const r = parseAnalise(JSON.stringify({
      ...base,
      pontos: ["O juiz afastou a capitalização mensal e mandou devolver em dobro."],
      itens: [
        { pedido: "Revisão dos juros", status: "deferido", valor: 12480 },
        { pedido: "Dano moral", status: "negado", razao: "Mero aborrecimento" },
      ],
    }));
    expect(r?.itens).toHaveLength(2);
    expect(r?.itens[0].valor).toBe(12480);
  });

  it("análise sem itens continua válida — despacho não julga pedido", () => {
    const r = parseAnalise(JSON.stringify({ ...base, ato: "despacho", pontos: [], itens: [] }));
    expect(r?.itens).toEqual([]);
  });

  it("filtra o enchimento antes de chegar na tela", () => {
    const r = parseAnalise(JSON.stringify({
      ...base,
      pontos: [
        "O pedido foi julgado procedente em parte.",
        "Não há informações sobre valores ou condições específicas.",
        "A decisão pode impactar a estratégia das partes.",
        "Detalhes adicionais não estão disponíveis no rótulo.",
      ],
      itens: [],
    }));
    // Sobra só a frase que afirma algo — as outras três eram sobre a
    // ausência do documento, não sobre a decisão.
    expect(r?.pontos).toEqual(["O pedido foi julgado procedente em parte."]);
  });

  it("resposta só com enchimento vira lista vazia, e a UI cai no estado sem resumo", () => {
    const r = parseAnalise(JSON.stringify({
      ...base,
      pontos: [
        "Não há informações sobre valores.",
        "Detalhes adicionais não estão disponíveis no rótulo.",
      ],
      itens: [],
    }));
    expect(r?.pontos).toEqual([]);
  });
});
