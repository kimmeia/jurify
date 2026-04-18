import { createLogger } from "../_core/logger";
const log = createLogger("integracoes-chatbot-openai");

export interface ChatBotConfig {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  provider?: "openai" | "anthropic";
  modelo: string;
  prompt: string;
  ativo: boolean;
  maxTokens?: number;
  temperatura?: number;
  nomeAgente?: string;
  /** Bloco com documentos de treinamento prontos pra concatenar no system prompt */
  contextoDocumentos?: string;
}
export interface ChatBotMessage { role: "system" | "user" | "assistant"; content: string; }
export interface ChatBotResponse { resposta: string | null; transferir: boolean; tokensUsados: number; nomeAgente?: string; erro?: string; }

const TRANSFER_KEYWORDS = ["atendente","humano","pessoa real","falar com alguém","falar com alguem","atendimento humano","operador","suporte humano","me transfere","transferir","falar com advogado","falar com o doutor","falar com a doutora"];

function detectarTransferencia(msg: string) { const l = msg.toLowerCase().trim(); return TRANSFER_KEYWORDS.some(kw => l.includes(kw)); }

function providerDoConfig(config: ChatBotConfig): "openai" | "anthropic" {
  if (config.provider) return config.provider;
  const m = (config.modelo || "").toLowerCase();
  if (m.startsWith("claude") || m.includes("anthropic")) return "anthropic";
  return "openai";
}

/** Gera resposta usando Anthropic Claude API */
export async function gerarRespostaAnthropic(apiKey: string, modelo: string, prompt: string, historico: ChatBotMessage[], msgCliente: string, maxTokens?: number, temperatura?: number): Promise<{ resposta: string | null; tokensUsados: number; erro?: string }> {
  try {
    const messages = [...historico.slice(-20).map(m => ({ role: m.role === "system" ? "user" as const : m.role, content: m.content })), { role: "user" as const, content: msgCliente }];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelo || "claude-haiku-4-5-20251001", system: prompt, messages, max_tokens: maxTokens || 500, temperature: temperatura || 0.7 }),
    });
    if (!res.ok) { const err = await res.text(); log.error({ status: res.status, err }, "Anthropic retornou erro"); return { resposta: null, tokensUsados: 0, erro: `Claude ${res.status}` }; }
    const data = await res.json();
    const texto = data.content?.[0]?.text?.trim() || "";
    const tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
    return { resposta: texto, tokensUsados: tokens };
  } catch (err: any) { log.error(`[Claude] Erro:`, err.message); return { resposta: null, tokensUsados: 0, erro: err.message }; }
}

export async function gerarRespostaChatBot(config: ChatBotConfig, historico: ChatBotMessage[], msgCliente: string): Promise<ChatBotResponse> {
  if (detectarTransferencia(msgCliente)) return { resposta: null, transferir: true, tokensUsados: 0, nomeAgente: config.nomeAgente };

  const systemPrompt = config.prompt
    + (config.contextoDocumentos || "")
    + "\n\nIMPORTANTE: Se o cliente pedir para falar com um humano, responda dizendo que vai transferir e finalize com [TRANSFERIR].";

  const provider = providerDoConfig(config);

  // Roteamento Claude (Anthropic)
  if (provider === "anthropic") {
    if (!config.anthropicApiKey) {
      log.error("ChatBot provider=anthropic mas sem anthropicApiKey");
      return { resposta: null, transferir: false, tokensUsados: 0, erro: "API Key Claude não encontrada" };
    }
    const r = await gerarRespostaAnthropic(
      config.anthropicApiKey,
      config.modelo || "claude-haiku-4-5-20251001",
      systemPrompt,
      historico,
      msgCliente,
      config.maxTokens,
      config.temperatura,
    );
    if (r.erro || !r.resposta) return { resposta: null, transferir: false, tokensUsados: r.tokensUsados, erro: r.erro, nomeAgente: config.nomeAgente };
    if (r.resposta.includes("[TRANSFERIR]")) {
      return { resposta: r.resposta.replace("[TRANSFERIR]", "").trim() || "Vou transferir você para um atendente.", transferir: true, tokensUsados: r.tokensUsados, nomeAgente: config.nomeAgente };
    }
    return { resposta: r.resposta, transferir: false, tokensUsados: r.tokensUsados, nomeAgente: config.nomeAgente };
  }

  // Roteamento OpenAI
  if (!config.openaiApiKey) {
    log.error("ChatBot provider=openai mas sem openaiApiKey");
    return { resposta: null, transferir: false, tokensUsados: 0, erro: "API Key OpenAI não encontrada" };
  }

  const messages: ChatBotMessage[] = [
    { role: "system", content: systemPrompt },
    ...historico.slice(-20),
    { role: "user", content: msgCliente },
  ];
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.openaiApiKey}` }, body: JSON.stringify({ model: config.modelo || "gpt-4o-mini", messages, max_tokens: config.maxTokens || 500, temperature: config.temperatura || 0.7 }) });
    if (!res.ok) { const err = await res.text(); log.error({ status: res.status, err }, "OpenAI retornou erro"); return { resposta: null, transferir: false, tokensUsados: 0, erro: `OpenAI ${res.status}` }; }
    const data = await res.json();
    const texto = data.choices?.[0]?.message?.content?.trim() || "";
    const tokens = data.usage?.total_tokens || 0;
    if (texto.includes("[TRANSFERIR]")) { return { resposta: texto.replace("[TRANSFERIR]", "").trim() || "Vou transferir você para um atendente.", transferir: true, tokensUsados: tokens, nomeAgente: config.nomeAgente }; }
    return { resposta: texto, transferir: false, tokensUsados: tokens, nomeAgente: config.nomeAgente };
  } catch (err: any) { log.error(`[ChatBot] Erro:`, err.message); return { resposta: null, transferir: false, tokensUsados: 0, erro: err.message }; }
}

export async function obterConfigChatBot(escritorioId: number, canalId?: number): Promise<ChatBotConfig | null> {
  try {
    const { obterAgenteParaCanal } = await import("./router-agentes-ia");
    // 1. Agente vinculado ao canal (se tiver canalId)
    if (canalId) {
      const a = await obterAgenteParaCanal(escritorioId, canalId);
      if (a) {
        return {
          openaiApiKey: a.openaiApiKey,
          anthropicApiKey: a.anthropicApiKey,
          provider: a.provider,
          modelo: a.modelo,
          prompt: a.prompt,
          ativo: true,
          maxTokens: a.maxTokens,
          temperatura: a.temperatura,
          nomeAgente: a.nome,
          contextoDocumentos: a.contextoDocumentos,
        };
      }
    }
    // 2. Qualquer agente ativo do escritório (mesmo caminho do obterAgenteParaCanal fallback)
    const a = await obterAgenteParaCanal(escritorioId, -1);
    if (a) {
      return {
        openaiApiKey: a.openaiApiKey,
        anthropicApiKey: a.anthropicApiKey,
        provider: a.provider,
        modelo: a.modelo,
        prompt: a.prompt,
        ativo: true,
        maxTokens: a.maxTokens,
        temperatura: a.temperatura,
        nomeAgente: a.nome,
        contextoDocumentos: a.contextoDocumentos,
      };
    }
  } catch (err: any) {
    log.info({ err: err?.message }, "[ChatBot] obterConfigChatBot falhou, fallback null");
  }
  return null;
}

export function converterHistoricoParaChatBot(msgs: Array<{ direcao: string; conteudo: string | null; tipo: string }>): ChatBotMessage[] {
  return msgs.filter(m => m.tipo === "texto" && m.conteudo).map(m => ({ role: (m.direcao === "entrada" ? "user" : "assistant") as "user" | "assistant", content: m.conteudo! }));
}
