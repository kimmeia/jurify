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
