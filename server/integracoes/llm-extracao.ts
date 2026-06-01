/**
 * Extração estruturada via LLM — usa **tool calling** (function calling) pra
 * forçar a IA a devolver JSON validado em vez de texto livre. Suporta
 * Anthropic Claude e OpenAI.
 *
 * Por que tool calling em vez de "JSON-mode": tool calling é mais rigoroso
 * — a IA é obrigada a chamar a função com argumentos que batem com o schema.
 * JSON-mode genérico tem mais alucinação de campos não pedidos.
 *
 * Usado pelo passo `ia_extrair_campos` do SmartFlow.
 */

import { createLogger } from "../_core/logger";
import { montarBodyOpenAIChat } from "../_core/openai-model-params";

const log = createLogger("llm-extracao");

const TIMEOUT_MS = 30000;

/** Turno de conversa pro contexto da extração (mesmo shape do chatbot). */
export interface MensagemHistorico {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Tipos suportados de campo. Mapeiam para JSON Schema:
 *   - texto/email/cpf/cnpj/telefone/data → string (string livre; IA cuida do formato)
 *   - numero → number
 *   - boolean → boolean
 *   - lista_texto → array<string>
 *
 * Pra adicionar tipo novo: ajustar `mapearTipoParaSchema` abaixo + criar
 * descrição no `descreverTipo` (passada pra IA no campo `description`).
 */
export type TipoCampoExtracao =
  | "texto"
  | "numero"
  | "boolean"
  | "data"
  | "email"
  | "cpf"
  | "cnpj"
  | "telefone"
  | "lista_texto";

export interface CampoParaExtrair {
  /** Chave do campo no objeto retornado. Ex: "cpf", "dataNascimento". */
  chave: string;
  /** Tipo do campo — informa o schema e a descrição passada pra IA. */
  tipo: TipoCampoExtracao;
  /** Descrição livre passada pra IA. Ex: "data de nascimento no formato DD/MM/AAAA". */
  descricao?: string;
  /** Se obrigatório, vai no required[] do schema. Ainda pode vir omitido se IA não achou. */
  obrigatorio?: boolean;
}

export interface ConfigLLMExtracao {
  provider: "openai" | "anthropic";
  modelo: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  /** Default 0.0 — extração não deve ser criativa. */
  temperatura?: number;
  maxTokens?: number;
}

export interface ResultadoExtracao {
  /** Map chave→valor extraído. Chaves omitidas pela IA não aparecem aqui. */
  campos: Record<string, unknown>;
  /** Tokens consumidos na chamada (input + output). */
  tokensUsados: number;
}

/** Mapeia tipo lógico → JSON Schema parcial. */
function mapearTipoParaSchema(tipo: TipoCampoExtracao): Record<string, unknown> {
  switch (tipo) {
    case "numero":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "lista_texto":
      return { type: "array", items: { type: "string" } };
    case "data":
      return { type: "string", description: "Data no formato YYYY-MM-DD (ISO 8601)" };
    case "email":
      return { type: "string", format: "email" };
    default:
      // texto / cpf / cnpj / telefone — string sem pattern (IA formata se descrição pedir)
      return { type: "string" };
  }
}

/** Descrição padrão que reforça o tipo na mensagem pra IA. */
function descreverTipo(tipo: TipoCampoExtracao): string {
  const m: Record<TipoCampoExtracao, string> = {
    texto: "valor de texto livre",
    numero: "número (sem separadores de milhar nem moeda)",
    boolean: "verdadeiro ou falso (true/false)",
    data: "data no formato YYYY-MM-DD",
    email: "endereço de email válido",
    cpf: "CPF, mantenha o formato exato (com ou sem pontuação) como o usuário enviou",
    cnpj: "CNPJ, mantenha o formato exato como o usuário enviou",
    telefone: "número de telefone com DDD",
    lista_texto: "lista de strings",
  };
  return m[tipo];
}

/**
 * Monta o JSON Schema das propriedades a partir da lista de campos.
 * Cada campo vira uma property com type + description (concatenando a
 * `descricao` do usuário com a `descreverTipo` automática).
 */
function montarSchemaCampos(campos: CampoParaExtrair[]): {
  properties: Record<string, unknown>;
  required: string[];
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const c of campos) {
    const base = mapearTipoParaSchema(c.tipo);
    const descPartes = [c.descricao, `(${descreverTipo(c.tipo)})`].filter(Boolean);
    properties[c.chave] = { ...base, description: descPartes.join(" ") };
    if (c.obrigatorio) required.push(c.chave);
  }
  return { properties, required };
}

/**
 * Extrai campos estruturados de uma mensagem usando LLM com tool calling.
 *
 * @param cfg config do provider (key + modelo)
 * @param mensagem texto a analisar
 * @param campos lista de campos esperados
 * @param contextoExtra texto opcional adicionado ao system prompt (ex: campos
 *   já capturados em interações anteriores — evita IA pedir info repetida)
 * @param historico mensagens anteriores da conversa. Sem isso, a extração só
 *   enxerga a última mensagem — e perde dados que o cliente informou antes
 *   (ex: disse o nome 3 mensagens atrás e a data agora).
 *
 * Retorna `{ campos: {}, tokensUsados }` se a IA não achou nenhum campo —
 * NÃO joga erro; o caller decide o que fazer com extração vazia (pode estar
 * tudo bem se nenhum campo era obrigatório).
 */
export async function extrairCamposEstruturados(
  cfg: ConfigLLMExtracao,
  mensagem: string,
  campos: CampoParaExtrair[],
  contextoExtra?: string,
  historico: MensagemHistorico[] = [],
): Promise<ResultadoExtracao> {
  if (campos.length === 0) {
    throw new Error("Lista de campos vazia — informe pelo menos 1 campo a extrair.");
  }
  if (!mensagem || typeof mensagem !== "string") {
    throw new Error("Mensagem vazia — não há texto pra extrair.");
  }

  const schema = montarSchemaCampos(campos);
  const temperatura = cfg.temperatura ?? 0;
  const maxTokens = cfg.maxTokens ?? 1024;

  const systemPrompt = [
    "Você é um extrator de dados. Analise a CONVERSA do usuário e extraia apenas os campos pedidos.",
    "Considere TODAS as mensagens do usuário na conversa — não só a última. O dado pode ter sido informado antes.",
    "Regras:",
    "  - Se um campo não foi informado em nenhum momento da conversa, NÃO inclua no resultado (omita a chave).",
    "  - Não invente valores. Só extraia o que o usuário realmente informou.",
    "  - Mantenha o formato exato que o usuário usou (ex: se ele digitou CPF com pontuação, mantenha).",
    contextoExtra ? `\nContexto adicional do cliente:\n${contextoExtra}` : "",
  ].join("\n");

  if (cfg.provider === "anthropic") {
    if (!cfg.anthropicApiKey) throw new Error("anthropicApiKey ausente.");
    return invocarAnthropicComTool(cfg.anthropicApiKey, cfg.modelo, systemPrompt, mensagem, schema, temperatura, maxTokens, historico);
  }

  if (!cfg.openaiApiKey) throw new Error("openaiApiKey ausente.");
  return invocarOpenAIComTool(cfg.openaiApiKey, cfg.modelo, systemPrompt, mensagem, schema, temperatura, maxTokens, historico);
}

async function invocarAnthropicComTool(
  apiKey: string,
  modelo: string,
  systemPrompt: string,
  mensagem: string,
  schema: { properties: Record<string, unknown>; required: string[] },
  temperatura: number,
  maxTokens: number,
  historico: MensagemHistorico[] = [],
): Promise<ResultadoExtracao> {
  const msgsHist = historico
    .slice(-20)
    .map((m) => ({ role: m.role === "system" ? ("user" as const) : m.role, content: m.content }));
  const body = {
    model: modelo || "claude-haiku-4-5-20251001",
    max_tokens: maxTokens,
    temperature: temperatura,
    system: systemPrompt,
    tools: [
      {
        name: "salvar_campos_extraidos",
        description: "Salva os campos que o usuário informou em qualquer momento da conversa. Omita campos que não foram informados.",
        input_schema: {
          type: "object",
          properties: schema.properties,
          required: schema.required,
        },
      },
    ],
    tool_choice: { type: "tool", name: "salvar_campos_extraidos" },
    messages: [...msgsHist, { role: "user" as const, content: mensagem }],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const txt = await res.text();
    log.error({ status: res.status, txt: txt.slice(0, 300) }, "Anthropic erro");
    throw new Error(`Claude ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  // Procura o bloco type="tool_use". Anthropic pode retornar múltiplos blocos
  // (text + tool_use) — só o tool_use nos interessa.
  const toolBlock = data.content?.find((c) => c.type === "tool_use");
  if (!toolBlock || !toolBlock.input) {
    log.warn({ data }, "Anthropic não retornou tool_use — extração vazia");
    return { campos: {}, tokensUsados: 0 };
  }

  const tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
  return { campos: toolBlock.input, tokensUsados: tokens };
}

async function invocarOpenAIComTool(
  apiKey: string,
  modelo: string,
  systemPrompt: string,
  mensagem: string,
  schema: { properties: Record<string, unknown>; required: string[] },
  temperatura: number,
  maxTokens: number,
  historico: MensagemHistorico[] = [],
): Promise<ResultadoExtracao> {
  const msgsHist = historico
    .slice(-20)
    .map((m) => ({ role: m.role === "system" ? ("user" as const) : m.role, content: m.content }));
  const body = montarBodyOpenAIChat({
    model: modelo || "gpt-4o-mini",
    maxTokens,
    temperatura,
    messages: [
      { role: "system", content: systemPrompt },
      ...msgsHist,
      { role: "user", content: mensagem },
    ],
    extra: {
      tools: [
        {
          type: "function",
          function: {
            name: "salvar_campos_extraidos",
            description: "Salva os campos que o usuário informou em qualquer momento da conversa. Omita campos que não foram informados.",
            parameters: {
              type: "object",
              properties: schema.properties,
              required: schema.required,
            },
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "salvar_campos_extraidos" },
      },
    },
  });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const txt = await res.text();
    log.error({ status: res.status, txt: txt.slice(0, 300) }, "OpenAI erro");
    throw new Error(`OpenAI ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
    usage?: { total_tokens?: number };
  };

  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    log.warn({ data }, "OpenAI não retornou tool_call — extração vazia");
    return { campos: {}, tokensUsados: 0 };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch (e: any) {
    log.error({ args: toolCall.function.arguments, err: e.message }, "OpenAI tool args invalid JSON");
    throw new Error(`OpenAI retornou JSON inválido: ${e.message}`);
  }

  const tokens = data.usage?.total_tokens || 0;
  return { campos: parsed, tokensUsados: tokens };
}
