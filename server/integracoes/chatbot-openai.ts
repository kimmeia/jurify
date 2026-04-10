import { createLogger } from "../_core/logger";
const log = createLogger("integracoes-chatbot-openai");
export interface ChatBotConfig { openaiApiKey: string; anthropicApiKey?: string; provider?: "openai" | "anthropic"; modelo: string; prompt: string; ativo: boolean; maxTokens?: number; temperatura?: number; nomeAgente?: string; }
export interface ChatBotMessage { role: "system" | "user" | "assistant"; content: string; }
export interface ChatBotResponse { resposta: string | null; transferir: boolean; tokensUsados: number; nomeAgente?: string; erro?: string; }

const TRANSFER_KEYWORDS = ["atendente","humano","pessoa real","falar com alguém","falar com alguem","atendimento humano","operador","suporte humano","me transfere","transferir","falar com advogado","falar com o doutor","falar com a doutora"];

function detectarTransferencia(msg: string) { const l = msg.toLowerCase().trim(); return TRANSFER_KEYWORDS.some(kw => l.includes(kw)); }

/** Gera resposta usando Anthropic Claude API */
export async function gerarRespostaAnthropic(apiKey: string, modelo: string, prompt: string, historico: ChatBotMessage[], msgCliente: string, maxTokens?: number, temperatura?: number): Promise<{ resposta: string | null; tokensUsados: number; erro?: string }> {
  try {
    const messages = [...historico.slice(-20).map(m => ({ role: m.role === "system" ? "user" as const : m.role, content: m.content })), { role: "user" as const, content: msgCliente }];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelo || "claude-sonnet-4-20250514", system: prompt, messages, max_tokens: maxTokens || 500, temperature: temperatura || 0.7 }),
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
  const messages: ChatBotMessage[] = [{ role: "system", content: config.prompt + "\n\nIMPORTANTE: Se o cliente pedir para falar com um humano, responda dizendo que vai transferir e finalize com [TRANSFERIR]." }, ...historico.slice(-20), { role: "user", content: msgCliente }];
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
    if (canalId) { const a = await obterAgenteParaCanal(escritorioId, canalId); if (a) return { openaiApiKey: a.openaiApiKey, modelo: a.modelo, prompt: a.prompt, ativo: true, maxTokens: a.maxTokens, temperatura: a.temperatura, nomeAgente: a.nome }; }
    const { getDb } = await import("../db"); const { agentesIa } = await import("../../drizzle/schema"); const { eq, and } = await import("drizzle-orm");
    const db = await getDb(); if (db) { const [g] = await db.select().from(agentesIa).where(and(eq(agentesIa.escritorioId, escritorioId), eq(agentesIa.ativo, true))).limit(1);
      if (g && g.openaiApiKey && g.apiKeyIv && g.apiKeyTag) { const crypto = await import("crypto"); const K = process.env.CANAIS_ENCRYPTION_KEY || "0".repeat(64); const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(K, "hex"), Buffer.from(g.apiKeyIv, "base64")); d.setAuthTag(Buffer.from(g.apiKeyTag, "base64")); let k = d.update(g.openaiApiKey, "base64", "utf8"); k += d.final("utf8"); return { openaiApiKey: k, modelo: g.modelo, prompt: g.prompt, ativo: true, maxTokens: g.maxTokens || 500, temperatura: parseFloat(g.temperatura || "0.70"), nomeAgente: g.nome }; }
    }
  } catch { log.info(`[ChatBot] agentes_ia indisponível, fallback legado`); }
  return null;
}

export function converterHistoricoParaChatBot(msgs: Array<{ direcao: string; conteudo: string | null; tipo: string }>): ChatBotMessage[] {
  return msgs.filter(m => m.tipo === "texto" && m.conteudo).map(m => ({ role: (m.direcao === "entrada" ? "user" : "assistant") as "user" | "assistant", content: m.conteudo! }));
}
