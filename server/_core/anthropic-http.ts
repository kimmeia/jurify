/**
 * Parâmetros corretos por modelo no Anthropic /v1/messages.
 *
 * A partir do Opus 4.7 (e em toda a família Claude 5) a API RECUSA
 * `temperature`, `top_p` e `top_k`: mandar qualquer um devolve 400 e a
 * chamada inteira falha. Sonnet 4.x e Haiku 4.5 continuam aceitando.
 *
 * Na família Claude 5 o modelo também PENSA por padrão (adaptive thinking):
 * os tokens de raciocínio saem do MESMO `max_tokens` da resposta, e o bloco
 * de raciocínio vem ANTES do texto em `content`. Por isso: folga no teto,
 * `effort: "low"` quando ninguém pediu outro, e a leitura da resposta procura
 * o bloco de texto em vez de pegar `content[0]` às cegas.
 */

/**
 * Modelos RETIRADOS pela Anthropic (a API recusa a chamada) → substituto que a
 * própria página de descontinuação recomenda. Agente gravado com um desses
 * continua funcionando sem recadastro; o valor no banco não muda.
 */
const SUBSTITUTO_DE_MODELO_RETIRADO: Record<string, string> = {
  "claude-sonnet-4-20250514": "claude-sonnet-4-6",
  "claude-opus-4-20250514": "claude-opus-4-8",
  "claude-opus-4-1-20250805": "claude-opus-4-8",
  "claude-3-7-sonnet-20250219": "claude-sonnet-4-6",
  "claude-3-5-sonnet-20240620": "claude-sonnet-4-6",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-6",
  "claude-3-sonnet-20240229": "claude-sonnet-4-6",
  "claude-3-opus-20240229": "claude-opus-4-8",
  "claude-3-5-haiku-20241022": "claude-haiku-4-5-20251001",
  "claude-3-haiku-20240307": "claude-haiku-4-5-20251001",
};

/** O modelo que a API ainda serve: o próprio, ou o substituto oficial se foi retirado. */
export function modeloAnthropicVigente(modelo: string): string {
  return SUBSTITUTO_DE_MODELO_RETIRADO[modelo.toLowerCase()] ?? modelo;
}

const OPUS_4_7_OU_MAIS = /^claude-opus-4-[7-9](?:[-.]|$)/;
const FAMILIA_5_OU_MAIS = /^claude-(?:[a-z]+-)?[5-9](?:[-.]|$)/;

/** True quando o modelo recusa `temperature`/`top_p`/`top_k` (Opus 4.7+ e Claude 5+). */
export function modeloAnthropicSemSampling(modelo: string | null | undefined): boolean {
  const m = (modelo || "").toLowerCase();
  return OPUS_4_7_OU_MAIS.test(m) || FAMILIA_5_OU_MAIS.test(m);
}

/** True quando o modelo roda adaptive thinking mesmo sem pedir (Claude 5+). */
export function modeloAnthropicPensaPorPadrao(modelo: string | null | undefined): boolean {
  return FAMILIA_5_OU_MAIS.test((modelo || "").toLowerCase());
}

/** Folga somada ao teto dos modelos que pensam por padrão, pra o raciocínio
 *  não comer o espaço da resposta visível (mesma ideia do helper da OpenAI). */
export const PENSAMENTO_TOKEN_BUFFER = 2000;

interface BodyAnthropicOpts {
  model: string;
  messages: unknown[];
  system?: string;
  maxTokens?: number | null;
  temperatura?: number | null;
  /** Campos extras passados direto (tools, tool_choice, thinking, output_config…). */
  extra?: Record<string, unknown>;
}

/** Monta o corpo do /v1/messages com os parâmetros certos pro modelo. */
export function montarBodyAnthropic(opts: BodyAnthropicOpts): Record<string, unknown> {
  const model = modeloAnthropicVigente(opts.model);
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    ...(opts.extra ?? {}),
  };
  if (opts.system != null) body.system = opts.system;

  const pensa = modeloAnthropicPensaPorPadrao(model);
  if (opts.maxTokens != null) {
    body.max_tokens = pensa && body.thinking == null
      ? opts.maxTokens + PENSAMENTO_TOKEN_BUFFER
      : opts.maxTokens;
  }
  if (pensa && body.output_config == null) body.output_config = { effort: "low" };

  if (modeloAnthropicSemSampling(model)) {
    delete body.temperature;
    delete body.top_p;
    delete body.top_k;
  } else if (opts.temperatura != null) {
    body.temperature = opts.temperatura;
  }
  return body;
}

/** Texto da resposta: junta os blocos de texto, ignorando raciocínio/tool_use. */
export function textoDaRespostaAnthropic(data: unknown): string {
  const content = (data as { content?: unknown } | null | undefined)?.content;
  if (!Array.isArray(content)) return "";
  const textos: string[] = [];
  for (const bloco of content) {
    if (!bloco || typeof bloco !== "object") continue;
    const b = bloco as { type?: unknown; text?: unknown };
    if (typeof b.text !== "string") continue;
    if (b.type != null && b.type !== "text") continue;
    textos.push(b.text);
  }
  return textos.join("\n").trim();
}
