/**
 * Testes do fix da invocação de LLM no SmartFlow (`chamarIA` e
 * `executarAgente` em `executores.ts`).
 *
 * Bugs corrigidos:
 * 1. `chamarIA` ignorava `provider` da config: tentava OpenAI primeiro
 *    se houvesse `openaiApiKey`, mesmo quando o agente ativo era Claude.
 *    Quando ambas as keys estavam configuradas no escritório, o agente
 *    Claude era acionado via endpoint OpenAI com `model="claude-..."` →
 *    erro 400.
 * 2. `chamarIA` hardcodava maxTokens=300 e temperature=0.3, ignorando a
 *    config do agente.
 * 3. `chamarIA` não incluía os docs RAG (`contextoDocumentos`).
 * 4. `gerarRespostaAnthropic` não tinha timeout — chat do WhatsApp podia
 *    pendurar indefinidamente em problema de rede.
 *
 * Os testes mockam `obterConfigChatBot` e `obterAgentePorId` (fontes da
 * config) + `fetch` global pra interceptar a chamada e validar URL/body.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks ANTES dos imports do código sob teste
const obterConfigChatBotMock = vi.fn();
const obterAgentePorIdMock = vi.fn();

vi.mock("../integracoes/chatbot-openai", async (importOriginal) => {
  const real = await importOriginal<typeof import("../integracoes/chatbot-openai")>();
  return {
    ...real,
    obterConfigChatBot: (...a: unknown[]) => obterConfigChatBotMock(...a),
  };
});

vi.mock("../integracoes/router-agentes-ia", async (importOriginal) => {
  const real = await importOriginal<typeof import("../integracoes/router-agentes-ia")>();
  return {
    ...real,
    obterAgentePorId: (...a: unknown[]) => obterAgentePorIdMock(...a),
  };
});

const { criarExecutoresReais } = await import("../smartflow/executores");

// Captura chamadas fetch pra inspeção
let fetchCalls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(responseBody: any, status = 200) {
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    fetchCalls.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body) : null,
      headers: init?.headers || {},
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(responseBody),
      json: async () => responseBody,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("chamarIA — provider Anthropic", () => {
  it("usa endpoint anthropic.com quando config.provider='anthropic'", async () => {
    obterConfigChatBotMock.mockResolvedValue({
      provider: "anthropic",
      modelo: "claude-sonnet-4-20250514",
      anthropicApiKey: "sk-ant-xxx",
      maxTokens: 800,
      temperatura: 0.5,
      contextoDocumentos: "",
      prompt: "ignored",
      ativo: true,
    });
    mockFetch({
      content: [{ text: "Resposta do Claude" }],
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const exec = criarExecutoresReais(1);
    const r = await exec.chamarIA("Você é assistente.", "Olá");

    expect(r).toBe("Resposta do Claude");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("anthropic.com");
    expect(fetchCalls[0].body.model).toBe("claude-sonnet-4-20250514");
    expect(fetchCalls[0].body.max_tokens).toBe(800);
    expect(fetchCalls[0].body.temperature).toBe(0.5);
  });

  it("ignora openaiApiKey se provider='anthropic' (bug fix do desambiguador)", async () => {
    // Cenário antes do fix: escritório com AMBAS as keys.
    // chamarIA antiga chamava OpenAI com model=claude-* → erro 400.
    obterConfigChatBotMock.mockResolvedValue({
      provider: "anthropic",
      modelo: "claude-haiku-4-5-20251001",
      openaiApiKey: "sk-also-openai", // ← presente mas IGNORADO
      anthropicApiKey: "sk-ant-real",
      maxTokens: 500,
      temperatura: 0.7,
      contextoDocumentos: "",
      prompt: "ignored",
      ativo: true,
    });
    mockFetch({
      content: [{ text: "ok claude" }],
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    const exec = criarExecutoresReais(1);
    await exec.chamarIA("prompt", "msg");

    expect(fetchCalls[0].url).toContain("anthropic.com");
    expect((fetchCalls[0].headers as any)["x-api-key"]).toBe("sk-ant-real");
  });
});

describe("chamarIA — provider OpenAI", () => {
  it("usa endpoint openai.com quando config.provider='openai'", async () => {
    obterConfigChatBotMock.mockResolvedValue({
      provider: "openai",
      modelo: "gpt-4o-mini",
      openaiApiKey: "sk-openai-test",
      maxTokens: 1200,
      temperatura: 0.3,
      contextoDocumentos: "",
      prompt: "ignored",
      ativo: true,
    });
    mockFetch({
      choices: [{ message: { content: "Resposta do GPT" } }],
    });

    const exec = criarExecutoresReais(1);
    const r = await exec.chamarIA("Você é assistente.", "Olá");

    expect(r).toBe("Resposta do GPT");
    expect(fetchCalls[0].url).toContain("openai.com");
    expect(fetchCalls[0].body.model).toBe("gpt-4o-mini");
    expect(fetchCalls[0].body.max_tokens).toBe(1200);
    expect(fetchCalls[0].body.temperature).toBe(0.3);
  });

  it("envia maxTokens/temperatura do agente (antes era hardcoded 300/0.3)", async () => {
    obterConfigChatBotMock.mockResolvedValue({
      provider: "openai",
      modelo: "gpt-4o",
      openaiApiKey: "sk-x",
      maxTokens: 2000, // ← agente quer respostas mais longas
      temperatura: 0.9, // ← mais criativo
      contextoDocumentos: "",
      prompt: "ignored",
      ativo: true,
    });
    mockFetch({ choices: [{ message: { content: "x" } }] });

    const exec = criarExecutoresReais(1);
    await exec.chamarIA("p", "m");

    expect(fetchCalls[0].body.max_tokens).toBe(2000);
    expect(fetchCalls[0].body.temperature).toBe(0.9);
  });
});

describe("chamarIA — inclusão de docs RAG", () => {
  it("anexa contextoDocumentos ao system prompt (antes ignorava no fluxo chamarIA)", async () => {
    obterConfigChatBotMock.mockResolvedValue({
      provider: "openai",
      modelo: "gpt-4o-mini",
      openaiApiKey: "sk-x",
      maxTokens: 500,
      temperatura: 0.5,
      contextoDocumentos: "\n\n--- CONHECIMENTO ---\nDoc 1: trabalhista...",
      prompt: "ignored",
      ativo: true,
    });
    mockFetch({ choices: [{ message: { content: "ok" } }] });

    const exec = criarExecutoresReais(1);
    await exec.chamarIA("Você é assistente jurídico.", "msg");

    const systemMsg = fetchCalls[0].body.messages.find(
      (m: any) => m.role === "system",
    );
    expect(systemMsg.content).toContain("Você é assistente jurídico.");
    expect(systemMsg.content).toContain("--- CONHECIMENTO ---");
    expect(systemMsg.content).toContain("Doc 1");
  });
});

describe("chamarIA — sem IA configurada", () => {
  it("lança erro claro quando obterConfigChatBot retorna null", async () => {
    obterConfigChatBotMock.mockResolvedValue(null);

    const exec = criarExecutoresReais(1);
    await expect(exec.chamarIA("p", "m")).rejects.toThrow(
      /Nenhuma IA configurada/i,
    );
  });
});

describe("executarAgente — respeita provider do agente", () => {
  it("agente Claude usa endpoint anthropic com modelo do agente", async () => {
    obterAgentePorIdMock.mockResolvedValue({
      id: 1,
      nome: "Bot Trabalhista",
      prompt: "Especialista em trabalhista.",
      modelo: "claude-sonnet-4-20250514",
      provider: "anthropic",
      anthropicApiKey: "sk-ant",
      maxTokens: 1500,
      temperatura: 0.4,
      contextoDocumentos: "doc xyz",
    });
    mockFetch({
      content: [{ text: "Resp" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const exec = criarExecutoresReais(1);
    await exec.executarAgente(1, "minha pergunta");

    expect(fetchCalls[0].url).toContain("anthropic.com");
    expect(fetchCalls[0].body.model).toBe("claude-sonnet-4-20250514");
    expect(fetchCalls[0].body.max_tokens).toBe(1500);
    expect(fetchCalls[0].body.system).toContain("Especialista em trabalhista");
    expect(fetchCalls[0].body.system).toContain("doc xyz");
  });

  it("agente OpenAI usa endpoint openai com modelo do agente", async () => {
    obterAgentePorIdMock.mockResolvedValue({
      id: 2,
      nome: "Bot Civil",
      prompt: "Especialista em civil.",
      modelo: "gpt-4o",
      provider: "openai",
      openaiApiKey: "sk-openai",
      maxTokens: 800,
      temperatura: 0.6,
      contextoDocumentos: "",
    });
    mockFetch({ choices: [{ message: { content: "ok" } }] });

    const exec = criarExecutoresReais(1);
    await exec.executarAgente(2, "x");

    expect(fetchCalls[0].url).toContain("openai.com");
    expect(fetchCalls[0].body.model).toBe("gpt-4o");
  });

  it("erro claro quando obterAgentePorId retorna null", async () => {
    obterAgentePorIdMock.mockResolvedValue(null);
    const exec = criarExecutoresReais(1);
    await expect(exec.executarAgente(999, "x")).rejects.toThrow(
      /não encontrado|inativo|sem API key/i,
    );
  });
});

describe("executarAgente — erro do upstream propaga", () => {
  it("OpenAI 401: erro com status no message", async () => {
    obterAgentePorIdMock.mockResolvedValue({
      id: 3,
      nome: "x",
      prompt: "p",
      modelo: "gpt-4o-mini",
      provider: "openai",
      openaiApiKey: "sk-invalid",
      maxTokens: 500,
      temperatura: 0.5,
      contextoDocumentos: "",
    });
    mockFetch({ error: { message: "Invalid API key" } }, 401);

    const exec = criarExecutoresReais(1);
    await expect(exec.executarAgente(3, "x")).rejects.toThrow(/401/);
  });
});
