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
import { resolverChaveIAEscritorio, type AIProvider } from "../_core/ai-call";

const log = createLogger("resumir-movimentacao");

/** Modelo default quando o escritório não configurou um. */
export const MODELO_DEFAULT = "gpt-4o-mini";

/** Default Anthropic quando a chave disponível é Claude mas o modelo
 *  configurado é de outro provider (Haiku: barato pra tarefa de alto volume). */
export const MODELO_DEFAULT_ANTHROPIC = "claude-haiku-4-5-20251001";

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

/**
 * Dispatcher por provider. A CHAVE vem do mesmo lugar que o resto da
 * plataforma usa (agentes de IA, `chamarIA`): `admin_integracoes` no banco,
 * via `resolverChaveIAEscritorio` (chave do escritório/agente → chave global
 * admin). Antes isto lia `process.env.OPENAI_API_KEY`/`ANTHROPIC_API_KEY`
 * direto — que fica vazio em produção porque a chave é configurada pela UI
 * (Admin → Integrações) e persiste criptografada no DB, não em env var. Efeito
 * do bug: a classificação era a ÚNICA feature de IA que nunca enxergava a
 * chave, então nenhuma movimentação recebia selo/resumo.
 *
 * O provider passa a vir da CHAVE resolvida, não do nome do modelo: se a chave
 * disponível não serve o modelo configurado pelo escritório, cai no default
 * daquele provider (a chave manda).
 */
async function chamarProvider(
  system: string,
  user: string,
  modeloPreferido: string,
  maxTokens: number,
  escritorioId?: number,
): Promise<string | null> {
  const keys = await resolverChaveIAEscritorio(escritorioId);
  if (!keys) {
    log.warn(
      { escritorioId },
      "classificação IA: nenhuma chave configurada (admin_integracoes / escritório) — pulando",
    );
    return null;
  }
  const modelo = modeloCompativel(modeloPreferido, keys.provider);
  if (keys.provider === "anthropic") return chamarAnthropic(system, user, modelo, maxTokens, keys.apiKey);
  return chamarOpenAI(system, user, modelo, maxTokens, keys.apiKey);
}

/** Usa o modelo configurado se o provider da chave o serve; senão, o default
 *  daquele provider — evita "configurei gpt-* mas só tenho chave Claude" = silêncio. */
function modeloCompativel(modeloPreferido: string, provider: AIProvider): string {
  if (providerDoModelo(modeloPreferido) === provider) return modeloPreferido;
  return provider === "anthropic" ? MODELO_DEFAULT_ANTHROPIC : MODELO_DEFAULT;
}

/** OpenAI Chat Completions. */
async function chamarOpenAI(system: string, user: string, modelo: string, maxTokens: number, apiKey: string): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelo,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
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

/** Anthropic Messages API. */
async function chamarAnthropic(system: string, user: string, modelo: string, maxTokens: number, apiKey: string): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelo,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: maxTokens,
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
  escritorioId?: number,
): Promise<string | null> {
  const limpo = (texto ?? "").trim();
  // Movimentações muito curtas (< 40 chars) geralmente já são auto-explicativas
  // ("Conclusos", "Arquivado") — resumir não agrega valor e gasta token.
  if (limpo.length < 40) return null;
  const truncado = limpo.length > MAX_INPUT_CHARS ? limpo.slice(0, MAX_INPUT_CHARS) : limpo;

  try {
    return await chamarProvider(SYSTEM_PROMPT, truncado, modelo, 120, escritorioId);
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      log.warn({ modelo, timeoutMs: TIMEOUT_MS }, "timeout no resumo IA");
      return null;
    }
    log.warn({ modelo, err: err?.message ?? String(err) }, "erro inesperado no resumo IA");
    return null;
  }
}

// ─── Classificação estruturada (resumo + desfecho + relevância) ──────────────

export type Desfecho = "favoravel" | "desfavoravel" | "parcial" | "neutro";
export type Relevancia = "relevante" | "rotina";
export type LadoCliente = "autor" | "reu" | "desconhecido";
export type ResumoClassificado = {
  resumo: string;
  desfecho: Desfecho | null;
  relevancia: Relevancia;
};

const DESFECHOS: Desfecho[] = ["favoravel", "desfavoravel", "parcial", "neutro"];

const SYSTEM_PROMPT_CLASSIFICACAO = `Você é um assistente jurídico que analisa UMA movimentação de processo do PJe brasileiro.
Responda APENAS com JSON válido (sem markdown, sem crases), exatamente neste formato:
{"resumo": "...", "relevancia": "relevante"|"rotina", "desfecho": "favoravel"|"desfavoravel"|"parcial"|"neutro"|null}

Regras:
- "resumo": 1 frase curta (máx. 200 caracteres) em pt-BR claro, focando no que mudou no processo. Sem jargão, sem prefixos, sem aspas.
- "relevancia": "rotina" para movimentação administrativa/de expediente (conclusos, distribuído, juntada de petição, remessa, mero despacho de impulso, publicação). "relevante" para decisões, sentenças, despachos que exijam providência, intimações e audiências.
- "desfecho": preencha SOMENTE quando a movimentação for uma DECISÃO/SENTENÇA/ACÓRDÃO/DESPACHO DECISÓRIO que resolve algo a favor ou contra uma parte. Avalie do ponto de vista do NOSSO cliente (informado na mensagem): "favoravel" se beneficia nosso cliente, "desfavoravel" se prejudica, "parcial" se procedente em parte, "neutro" se decisão sem vencedor claro. Use null quando NÃO for decisão de mérito (intimação, juntada, audiência designada, conclusos, etc.).
- Não invente dados que não estão no texto.`;

/**
 * Classifica uma movimentação: resumo + desfecho (favorável/desfavorável do
 * ponto de vista do NOSSO cliente) + relevância (relevante/rotina). Nunca
 * lança; retorna null quando não vale classificar ou a IA cai. Se a IA
 * responder algo que não é JSON, cai num fallback que ao menos aproveita o
 * texto como resumo (sem classificar).
 */
export async function classificarMovimentacao(
  texto: string,
  modelo: string = MODELO_DEFAULT,
  opts?: { ladoCliente?: LadoCliente; escritorioId?: number },
): Promise<ResumoClassificado | null> {
  const limpo = (texto ?? "").trim();
  if (limpo.length < 40) return null;
  const truncado = limpo.length > MAX_INPUT_CHARS ? limpo.slice(0, MAX_INPUT_CHARS) : limpo;

  const lado = opts?.ladoCliente ?? "desconhecido";
  const ladoTxt =
    lado === "autor" ? "O NOSSO cliente é o AUTOR (polo ativo) da ação."
    : lado === "reu" ? "O NOSSO cliente é o RÉU (polo passivo) da ação."
    : "Não se sabe de que lado o nosso cliente está — se não der pra inferir com segurança, use desfecho null.";
  const user = `${ladoTxt}\n\nMovimentação:\n${truncado}`;

  let raw: string | null;
  try {
    raw = await chamarProvider(SYSTEM_PROMPT_CLASSIFICACAO, user, modelo, 320, opts?.escritorioId);
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") log.warn({ modelo }, "timeout na classificação IA");
    else log.warn({ modelo, err: err?.message ?? String(err) }, "erro inesperado na classificação IA");
    return null;
  }
  if (!raw) return null;
  return parseClassificacao(raw);
}

/** Extrai o JSON da resposta (tolerante a crases/texto ao redor) e valida. */
export function parseClassificacao(raw: string): ResumoClassificado | null {
  const ini = raw.indexOf("{");
  const fim = raw.lastIndexOf("}");
  if (ini >= 0 && fim > ini) {
    try {
      const obj = JSON.parse(raw.slice(ini, fim + 1)) as Record<string, unknown>;
      const resumo = typeof obj.resumo === "string" ? obj.resumo.trim() : "";
      if (resumo) {
        const desfecho = DESFECHOS.includes(obj.desfecho as Desfecho) ? (obj.desfecho as Desfecho) : null;
        const relevancia: Relevancia = obj.relevancia === "rotina" ? "rotina" : "relevante";
        return { resumo: resumo.slice(0, 240), desfecho, relevancia };
      }
    } catch {
      // cai no fallback abaixo
    }
  }
  // Fallback: IA ignorou o JSON — aproveita o texto cru como resumo, sem selo.
  const fallback = raw.replace(/[`{}]/g, "").trim();
  if (fallback.length < 3) return null;
  return { resumo: fallback.slice(0, 240), desfecho: null, relevancia: "relevante" };
}
