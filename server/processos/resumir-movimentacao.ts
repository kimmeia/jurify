/**
 * Resumo IA de movimentações judiciais.
 *
 * Por que existe: o texto bruto de uma movimentação do PJe é jurídico
 * (cheio de "Despacho dos Autos", "Conclusos para decisão", "Distribuídos
 * por dependência"...) e a notificação atual mostra os primeiros 200
 * caracteres — que muitas vezes são metadata sem valor pro user. O resumo
 * IA transforma isso em 1-2 frases em pt-BR claro pro user decidir se
 * precisa abrir o processo.
 *
 * Provider-neutral: o modelo é configurável por escritório (coluna
 * `escritorios.motor_resumo_modelo`). O prefixo do nome decide qual API:
 *   - "gpt-*"    → OpenAI  (default: gpt-4o-mini)
 *   - "claude-*" → Anthropic
 *
 * Graceful degradation: qualquer falha (key ausente, timeout, erro HTTP,
 * provider desconhecido) retorna null. O caller usa `resumoIA ?? texto`
 * — comportamento atual preservado quando IA cai.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { escritorios } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("resumir-movimentacao");

/** Modelo default quando o escritório não configurou um. */
export const MODELO_DEFAULT = "gpt-4o-mini";

/** Timeout do request — não pode bloquear o cron de monitoramento. */
const TIMEOUT_MS = 8000;

/** Limite de chars do texto de entrada — corta antes de gastar tokens à toa. */
const MAX_INPUT_CHARS = 4000;

const SYSTEM_PROMPT = `Você é um assistente jurídico que resume movimentações de processos do PJe brasileiro.
Regras:
- Resuma em 1 frase curta (máx. 200 caracteres) em português do Brasil.
- Foque no que mudou no processo (ex: "Sentença julgou procedente o pedido", "Audiência designada para 15/03").
- Não use jargão desnecessário; escreva como pra um advogado ocupado entender em 3 segundos.
- Se a movimentação for puramente administrativa ("conclusos", "distribuído"), diga isso brevemente.
- Não invente dados que não estão no texto.
- Responda APENAS com o resumo, sem prefixos tipo "Resumo:" ou aspas.`;

export type Provider = "openai" | "anthropic" | "desconhecido";

/** Decide o provider a partir do nome do modelo. */
export function providerDoModelo(modelo: string): Provider {
  const m = modelo.toLowerCase().trim();
  if (m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) {
    return "openai";
  }
  if (m.startsWith("claude-")) {
    return "anthropic";
  }
  return "desconhecido";
}

/**
 * Busca o modelo configurado pelo escritório, ou retorna o default global.
 * Erros silenciosos (DB indisponível, escritório não existe) caem no default.
 */
export async function modeloParaEscritorio(escritorioId: number): Promise<string> {
  try {
    const db = await getDb();
    if (!db) return MODELO_DEFAULT;
    const rows = await db
      .select({ modelo: escritorios.motorResumoModelo })
      .from(escritorios)
      .where(eq(escritorios.id, escritorioId))
      .limit(1);
    const modelo = rows[0]?.modelo;
    if (modelo && modelo.trim().length > 0) return modelo;
    return MODELO_DEFAULT;
  } catch (err: any) {
    log.warn({ escritorioId, err: err?.message ?? String(err) }, "modeloParaEscritorio falhou, usando default");
    return MODELO_DEFAULT;
  }
}

/** Resumo via OpenAI Chat Completions. */
async function resumirComOpenAI(texto: string, modelo: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn("OPENAI_API_KEY não configurada");
    return null;
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelo,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: texto },
      ],
      max_tokens: 120,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const t = await res.text();
    log.warn({ status: res.status, body: t.slice(0, 200) }, "OpenAI retornou erro");
    return null;
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const out = data.choices?.[0]?.message?.content?.trim();
  return out && out.length > 0 ? out : null;
}

/** Resumo via Anthropic Messages API. */
async function resumirComAnthropic(texto: string, modelo: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log.warn("ANTHROPIC_API_KEY não configurada");
    return null;
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelo,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: texto }],
      max_tokens: 120,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const t = await res.text();
    log.warn({ status: res.status, body: t.slice(0, 200) }, "Anthropic retornou erro");
    return null;
  }
  const data = (await res.json()) as {
    content?: Array<{ text?: string }>;
  };
  const out = data.content?.[0]?.text?.trim();
  return out && out.length > 0 ? out : null;
}

/**
 * Gera resumo IA de uma movimentação. Retorna null quando:
 * - texto é vazio/curto demais pra valer resumir
 * - modelo desconhecido (nem gpt-* nem claude-*)
 * - API key do provider não configurada
 * - timeout / HTTP error / resposta vazia
 *
 * Nunca lança — caller pode assumir comportamento silencioso seguro.
 */
export async function resumirMovimentacao(
  texto: string,
  modelo: string = MODELO_DEFAULT,
): Promise<string | null> {
  const limpo = (texto ?? "").trim();
  // Movimentações muito curtas (< 40 chars) geralmente já são auto-explicativas
  // ("Conclusos", "Arquivado") — resumir não agrega valor e gasta token.
  if (limpo.length < 40) return null;
  const truncado = limpo.length > MAX_INPUT_CHARS ? limpo.slice(0, MAX_INPUT_CHARS) : limpo;

  const provider = providerDoModelo(modelo);
  try {
    if (provider === "openai") return await resumirComOpenAI(truncado, modelo);
    if (provider === "anthropic") return await resumirComAnthropic(truncado, modelo);
    log.warn({ modelo }, "modelo de provider desconhecido — pulando resumo");
    return null;
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      log.warn({ modelo, timeoutMs: TIMEOUT_MS }, "timeout no resumo IA");
      return null;
    }
    log.warn({ modelo, err: err?.message ?? String(err) }, "erro inesperado no resumo IA");
    return null;
  }
}
