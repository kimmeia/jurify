import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  providerDoModelo,
  resumirMovimentacao,
  MODELO_DEFAULT,
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
});

describe("resumirMovimentacao (graceful degradation)", () => {
  const realFetch = global.fetch;
  const realOpenAIKey = process.env.OPENAI_API_KEY;
  const realAnthropicKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    global.fetch = realFetch;
    if (realOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = realOpenAIKey;
    if (realAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realAnthropicKey;
  });

  it("texto curto demais → null (não gasta token)", async () => {
    const r = await resumirMovimentacao("Conclusos", "gpt-4o-mini");
    expect(r).toBeNull();
  });

  it("texto vazio → null", async () => {
    expect(await resumirMovimentacao("", "gpt-4o-mini")).toBeNull();
    expect(await resumirMovimentacao("   ", "gpt-4o-mini")).toBeNull();
  });

  it("modelo desconhecido → null (não quebra cron)", async () => {
    const texto = "Despacho judicial expedido em " + "x".repeat(200);
    const r = await resumirMovimentacao(texto, "llama-3");
    expect(r).toBeNull();
  });

  it("OPENAI_API_KEY ausente → null (silent fallback)", async () => {
    delete process.env.OPENAI_API_KEY;
    const texto =
      "Despacho dos autos: defiro o pedido de tutela antecipada formulado pela parte autora, " +
      "determinando a suspensão da exigibilidade do crédito tributário até decisão final.";
    const r = await resumirMovimentacao(texto, "gpt-4o-mini");
    expect(r).toBeNull();
  });

  it("ANTHROPIC_API_KEY ausente → null (silent fallback)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const texto =
      "Despacho dos autos: defiro o pedido de tutela antecipada formulado pela parte autora, " +
      "determinando a suspensão da exigibilidade do crédito tributário até decisão final.";
    const r = await resumirMovimentacao(texto, "claude-haiku-4-5-20251001");
    expect(r).toBeNull();
  });

  it("OpenAI 200 OK → retorna conteúdo trimmed", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
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
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
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

  it("OpenAI HTTP 500 → null (não propaga erro)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
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
    process.env.OPENAI_API_KEY = "sk-test";
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network down"));
    const texto = "Despacho dos autos: defiro o pedido de tutela antecipada formulado pela parte autora.";
    const r = await resumirMovimentacao(texto, "gpt-4o-mini");
    expect(r).toBeNull();
  });

  it("AbortError (timeout) → null", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const abortErr: any = new Error("aborted");
    abortErr.name = "AbortError";
    global.fetch = vi.fn().mockRejectedValueOnce(abortErr);
    const texto = "Despacho dos autos: defiro o pedido de tutela antecipada formulado pela parte autora.";
    const r = await resumirMovimentacao(texto, "gpt-4o-mini");
    expect(r).toBeNull();
  });

  it("resposta com choices vazio → null", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [] }),
    } as any);
    const texto = "Despacho dos autos: defiro o pedido de tutela antecipada formulado pela parte autora.";
    const r = await resumirMovimentacao(texto, "gpt-4o-mini");
    expect(r).toBeNull();
  });

  it("trunca input >4000 chars antes de mandar (não gasta token à toa)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
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
