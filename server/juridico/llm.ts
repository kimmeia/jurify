/**
 * Chamada de LLM no modelo que o ESCRITÓRIO configurou (OpenAI ou Anthropic),
 * com a chave dele (fallback plataforma). Usada pela avaliação, pela redação e
 * pela conversa do Agente Jurídico.
 */
import { resolverAPIKey, providerDoModelo } from "../integracoes/router-agentes-ia";
import { montarBodyOpenAIChat } from "../_core/openai-model-params";
import { createLogger } from "../_core/logger";

const log = createLogger("juridico-llm");

export type LLMResultado = { texto: string | null; erro?: string };
export type MensagemChat = { role: "user" | "assistant"; content: string };

/** Resolve provider + chave pro modelo; erro claro se a chave não bate. */
async function resolverProviderKey(
  escritorioId: number,
  modelo: string,
): Promise<{ provider: "openai" | "anthropic"; key: string } | { erro: string }> {
  const provider = providerDoModelo(modelo);
  const resolved = await resolverAPIKey(escritorioId, null, provider);
  if (!resolved) return { erro: "Nenhuma chave de IA configurada. Configure OpenAI ou Anthropic em Integrações." };
  if (resolved.provider !== provider) {
    const querido = provider === "anthropic" ? "Claude (Anthropic)" : "OpenAI";
    const tem = resolved.provider === "anthropic" ? "Claude" : "OpenAI";
    return { erro: `O modelo "${modelo}" exige ${querido}, mas só há chave ${tem} configurada.` };
  }
  return { provider, key: resolved.key };
}

/** Núcleo: chama o provider com system + histórico de mensagens. */
async function chamarChat(
  provider: "openai" | "anthropic",
  key: string,
  opts: { system: string; mensagens: MensagemChat[]; modelo: string; maxTokens: number; temperatura: number; timeoutMs: number },
): Promise<LLMResultado> {
  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: opts.modelo,
          system: opts.system,
          messages: opts.mensagens,
          max_tokens: opts.maxTokens,
          temperature: opts.temperatura,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (!res.ok) {
        const d = await res.text().catch(() => "");
        return { texto: null, erro: `Anthropic ${res.status}: ${d.slice(0, 200)}` };
      }
      const data = (await res.json()) as { content?: Array<{ text?: string }> };
      return { texto: (data.content?.[0]?.text || "").trim() || null };
    }

    // OpenAI
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(montarBodyOpenAIChat({
        model: opts.modelo,
        messages: [{ role: "system", content: opts.system }, ...opts.mensagens],
        maxTokens: opts.maxTokens,
        temperature: opts.temperatura,
      } as any)),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) {
      const d = await res.text().catch(() => "");
      return { texto: null, erro: `OpenAI ${res.status}: ${d.slice(0, 200)}` };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return { texto: (data.choices?.[0]?.message?.content || "").trim() || null };
  } catch (err: any) {
    log.warn({ err: err?.message }, "Falha na chamada de LLM");
    return { texto: null, erro: err?.message || "Falha na chamada de IA" };
  }
}

/** Chamada one-shot system + user (avaliação, redação). */
export async function chamarLLMEscritorio(
  escritorioId: number,
  opts: { system: string; user: string; modelo: string; maxTokens?: number; temperatura?: number; timeoutMs?: number },
): Promise<LLMResultado> {
  const rk = await resolverProviderKey(escritorioId, opts.modelo);
  if ("erro" in rk) return { texto: null, erro: rk.erro };
  return chamarChat(rk.provider, rk.key, {
    system: opts.system,
    mensagens: [{ role: "user", content: opts.user }],
    modelo: opts.modelo,
    maxTokens: opts.maxTokens ?? 2000,
    temperatura: opts.temperatura ?? 0.2,
    timeoutMs: opts.timeoutMs ?? 60000,
  });
}

/** Conversa multi-turno (Agente Jurídico em chat): system + histórico. */
export async function conversarLLMEscritorio(
  escritorioId: number,
  opts: { system: string; mensagens: MensagemChat[]; modelo: string; maxTokens?: number; temperatura?: number; timeoutMs?: number },
): Promise<LLMResultado> {
  const rk = await resolverProviderKey(escritorioId, opts.modelo);
  if ("erro" in rk) return { texto: null, erro: rk.erro };
  return chamarChat(rk.provider, rk.key, {
    system: opts.system,
    mensagens: opts.mensagens,
    modelo: opts.modelo,
    maxTokens: opts.maxTokens ?? 3000,
    temperatura: opts.temperatura ?? 0.3,
    timeoutMs: opts.timeoutMs ?? 90000,
  });
}

const INSTRUCAO_TRANSCRICAO =
  "Transcreva o CONTEÚDO RELEVANTE deste documento jurídico para uso em uma peça: " +
  "partes, CPF/CNPJ, valores, datas, número de contrato, cláusulas e encargos citados. " +
  "Seja fiel ao documento; não invente. Responda só com o conteúdo, sem comentários.";

/**
 * Lê um documento (imagem ou PDF escaneado) via Vision no modelo do escritório
 * e devolve a transcrição do conteúdo. Adaptativo ao provider:
 *  - Anthropic (Claude): lê imagem E PDF nativamente (bloco `document`).
 *  - OpenAI: lê imagem (image_url). PDF escaneado NÃO é suportado no
 *    chat/completions — devolve erro claro (use Claude ou envie como imagem).
 */
export async function transcreverDocumentoVision(
  escritorioId: number,
  opts: { modelo: string; base64: string; mime: string; ehPdf: boolean; instrucao?: string; maxTokens?: number; timeoutMs?: number },
): Promise<LLMResultado> {
  const rk = await resolverProviderKey(escritorioId, opts.modelo);
  if ("erro" in rk) return { texto: null, erro: rk.erro };
  const instrucao = opts.instrucao || INSTRUCAO_TRANSCRICAO;
  const maxTokens = opts.maxTokens ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 90000;

  try {
    if (rk.provider === "anthropic") {
      const bloco = opts.ehPdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: opts.base64 } }
        : { type: "image", source: { type: "base64", media_type: opts.mime, data: opts.base64 } };
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": rk.key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: opts.modelo,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: [bloco, { type: "text", text: instrucao }] }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const d = await res.text().catch(() => "");
        return { texto: null, erro: `Anthropic ${res.status}: ${d.slice(0, 200)}` };
      }
      const data = (await res.json()) as { content?: Array<{ text?: string }> };
      return { texto: (data.content?.[0]?.text || "").trim() || null };
    }

    // OpenAI — só imagem
    if (opts.ehPdf) {
      return { texto: null, erro: "PDF escaneado não é lido pelo modelo OpenAI. Use um modelo Claude ou anexe o documento como imagem (foto/print)." };
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${rk.key}` },
      body: JSON.stringify(montarBodyOpenAIChat({
        model: opts.modelo,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: instrucao },
            { type: "image_url", image_url: { url: `data:${opts.mime};base64,${opts.base64}` } },
          ],
        }],
        maxTokens,
        temperature: 0.1,
      } as any)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const d = await res.text().catch(() => "");
      return { texto: null, erro: `OpenAI ${res.status}: ${d.slice(0, 200)}` };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return { texto: (data.choices?.[0]?.message?.content || "").trim() || null };
  } catch (err: any) {
    log.warn({ err: err?.message }, "Falha na transcrição Vision");
    return { texto: null, erro: err?.message || "Falha ao ler o documento" };
  }
}
