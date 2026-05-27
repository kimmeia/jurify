/**
 * Helper compartilhado para chamadas Claude/OpenAI usando credenciais
 * do `admin_integracoes`. Preferência: Anthropic → OpenAI fallback.
 */
import { getDb } from "../db";
import { adminIntegracoes } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { decrypt as adminDecrypt } from "../escritorio/crypto-utils";
import { createLogger } from "./logger";

const log = createLogger("ai-call");

export type AIProvider = "anthropic" | "openai";

export interface AIKeys {
  apiKey: string;
  provider: AIProvider;
}

/** Resolve chave de IA do admin (preferência: Anthropic). Retorna null se nenhuma configurada. */
export async function resolverChaveIA(): Promise<AIKeys | null> {
  const db = await getDb();
  if (!db) return null;

  const [anthropicReg] = await db
    .select()
    .from(adminIntegracoes)
    .where(and(eq(adminIntegracoes.provedor, "anthropic"), eq(adminIntegracoes.status, "conectado")))
    .limit(1);

  if (anthropicReg?.apiKeyEncrypted && anthropicReg.apiKeyIv && anthropicReg.apiKeyTag) {
    try {
      const apiKey = adminDecrypt(anthropicReg.apiKeyEncrypted, anthropicReg.apiKeyIv, anthropicReg.apiKeyTag);
      return { apiKey, provider: "anthropic" };
    } catch (e) { log.warn({ e }, "falha decrypt anthropic"); }
  }

  const [openaiReg] = await db
    .select()
    .from(adminIntegracoes)
    .where(and(eq(adminIntegracoes.provedor, "openai"), eq(adminIntegracoes.status, "conectado")))
    .limit(1);

  if (openaiReg?.apiKeyEncrypted && openaiReg.apiKeyIv && openaiReg.apiKeyTag) {
    try {
      const apiKey = adminDecrypt(openaiReg.apiKeyEncrypted, openaiReg.apiKeyIv, openaiReg.apiKeyTag);
      return { apiKey, provider: "openai" };
    } catch (e) { log.warn({ e }, "falha decrypt openai"); }
  }

  return null;
}

/**
 * Resolve a chave priorizando a do CLIENTE (escritório): chave do agente /
 * canal ChatGPT ou Claude que o escritório configurou em Apps externos. Sem
 * chave própria, cai na chave global da plataforma (admin) — assim quem
 * configura passa a pagar o próprio uso, e quem não tem continua funcionando.
 */
export async function resolverChaveIAEscritorio(escritorioId?: number): Promise<AIKeys | null> {
  if (escritorioId) {
    try {
      const { resolverAPIKey } = await import("../integracoes/router-agentes-ia");
      const r = await resolverAPIKey(escritorioId, {}, undefined, { permitirGlobal: false });
      if (r?.key) return { apiKey: r.key, provider: r.provider };
    } catch (e) {
      log.warn({ e: String(e), escritorioId }, "falha ao resolver chave do escritório — usando a global");
    }
  }
  return resolverChaveIA();
}

export interface ChamadaIAOpts {
  /** Escritório dono da chamada — usa a chave do cliente (fallback: global). */
  escritorioId?: number;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Quando true, força resposta JSON (response_format pra OpenAI, instrução pra Claude) */
  json?: boolean;
  timeoutMs?: number;
}

/** Chama o provedor configurado e devolve o texto. Lança se nenhum provedor disponível ou se a chamada falhar. */
export async function chamarIA(opts: ChamadaIAOpts): Promise<string> {
  const keys = await resolverChaveIAEscritorio(opts.escritorioId);
  if (!keys) {
    throw new Error("Integração com IA não configurada. Configure OpenAI ou Anthropic em Admin → Integrações.");
  }

  const timeout = opts.timeoutMs ?? 25000;
  const maxTokens = opts.maxTokens ?? 1200;
  const temp = opts.temperature ?? 0.3;

  if (keys.provider === "anthropic") {
    const system = opts.json
      ? `${opts.system}\n\nRESPONDA APENAS COM JSON VÁLIDO, sem markdown, sem explicação extra.`
      : opts.system;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": keys.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        system,
        messages: [{ role: "user", content: opts.user }],
        max_tokens: maxTokens,
        temperature: temp,
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    return (data.content?.[0]?.text || "").trim();
  }

  const body: any = {
    model: "gpt-4o",
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    max_tokens: maxTokens,
    temperature: temp,
  };
  if (opts.json) body.response_format = { type: "json_object" };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${keys.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content || "").trim();
}

/** Parsing seguro do JSON da IA. Aceita o caso em que vem dentro de ```json ... ``` */
export function parseJsonIA<T = any>(raw: string): T | null {
  if (!raw) return null;
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try { return JSON.parse(stripped) as T; } catch { return null; }
}
