/**
 * Parâmetros corretos por modelo no OpenAI /v1/chat/completions.
 *
 * Os modelos de raciocínio (família GPT-5 e série o*) NÃO aceitam `max_tokens`
 * nem `temperature`: exigem `max_completion_tokens` e só rodam na temperatura
 * padrão. Mandar os parâmetros antigos devolve 400 ("Unsupported parameter").
 * Os modelos GPT-4/3.5 continuam usando `max_tokens` + `temperature`.
 *
 * Além disso, esses modelos gastam "reasoning tokens" (invisíveis) do mesmo
 * orçamento de `max_completion_tokens` ANTES da resposta. Com o effort padrão
 * (medium) e um teto baixo, o raciocínio consome tudo e o conteúdo volta vazio
 * — o agente "responde algumas vezes e para". Por isso forçamos
 * `reasoning_effort: "low"` e somamos uma folga ao teto.
 */

/** True para gpt-5+ e o1/o3/o4… (modelos de raciocínio com a API nova). */
export function isModeloOpenAIRaciocinio(modelo: string | null | undefined): boolean {
  const m = (modelo || "").toLowerCase();
  return /^(gpt-[5-9]|o[1-9])/.test(m);
}

interface BodyOpenAIChatOpts {
  model: string;
  messages: unknown[];
  maxTokens?: number | null;
  temperatura?: number | null;
  /** Campos extras passados direto (tools, tool_choice, response_format…). */
  extra?: Record<string, unknown>;
}

/** Folga somada ao teto dos modelos de raciocínio pra cobrir os reasoning
 *  tokens (invisíveis) sem comer o espaço da resposta visível. */
const RACIOCINIO_TOKEN_BUFFER = 2000;

/** Monta o corpo do chat/completions com os parâmetros certos pro modelo. */
export function montarBodyOpenAIChat(opts: BodyOpenAIChatOpts): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    ...(opts.extra ?? {}),
  };
  if (isModeloOpenAIRaciocinio(opts.model)) {
    if (opts.maxTokens != null) {
      body.max_completion_tokens = opts.maxTokens + RACIOCINIO_TOKEN_BUFFER;
    }
    if (body.reasoning_effort == null) body.reasoning_effort = "low";
  } else {
    if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
    if (opts.temperatura != null) body.temperature = opts.temperatura;
  }
  return body;
}
