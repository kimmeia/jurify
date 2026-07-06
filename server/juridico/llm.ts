/**
 * Chamada de LLM no modelo que o ESCRITÓRIO configurou (OpenAI ou Anthropic),
 * com a chave dele (fallback plataforma). Uma chamada "one-shot" system+user
 * que devolve o texto — usada pela avaliação de sucesso e pela redação.
 */
import { resolverAPIKey, providerDoModelo } from "../integracoes/router-agentes-ia";
import { montarBodyOpenAIChat } from "../_core/openai-model-params";
import { createLogger } from "../_core/logger";

const log = createLogger("juridico-llm");

export type LLMResultado = { texto: string | null; erro?: string };

/**
 * Chama o modelo do escritório com um prompt system + user. Resolve provider
 * pelo nome do modelo e a chave via `resolverAPIKey`. Se a chave disponível
 * não bate com o provider do modelo, retorna erro claro (não silencia).
 */
export async function chamarLLMEscritorio(
  escritorioId: number,
  opts: { system: string; user: string; modelo: string; maxTokens?: number; temperatura?: number; timeoutMs?: number },
): Promise<LLMResultado> {
  const provider = providerDoModelo(opts.modelo);
  const resolved = await resolverAPIKey(escritorioId, null, provider);
  if (!resolved) {
    return { texto: null, erro: "Nenhuma chave de IA configurada. Configure OpenAI ou Anthropic em Integrações." };
  }
  if (resolved.provider !== provider) {
    const querido = provider === "anthropic" ? "Claude (Anthropic)" : "OpenAI";
    const tem = resolved.provider === "anthropic" ? "Claude" : "OpenAI";
    return { texto: null, erro: `O modelo "${opts.modelo}" exige ${querido}, mas só há chave ${tem} configurada.` };
  }

  const maxTokens = opts.maxTokens ?? 2000;
  const temperatura = opts.temperatura ?? 0.2;
  const timeoutMs = opts.timeoutMs ?? 60000;

  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": resolved.key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: opts.modelo,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
          max_tokens: maxTokens,
          temperature: temperatura,
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

    // OpenAI
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolved.key}` },
      body: JSON.stringify(montarBodyOpenAIChat({
        model: opts.modelo,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        maxTokens,
        temperature: temperatura,
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
    log.warn({ err: err?.message }, "Falha na chamada de LLM");
    return { texto: null, erro: err?.message || "Falha na chamada de IA" };
  }
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
  const provider = providerDoModelo(opts.modelo);
  const resolved = await resolverAPIKey(escritorioId, null, provider);
  if (!resolved) return { texto: null, erro: "Nenhuma chave de IA configurada." };
  if (resolved.provider !== provider) {
    return { texto: null, erro: `O modelo "${opts.modelo}" exige ${provider === "anthropic" ? "Claude" : "OpenAI"}, mas a chave configurada é de outro provider.` };
  }
  const instrucao = opts.instrucao || INSTRUCAO_TRANSCRICAO;
  const maxTokens = opts.maxTokens ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 90000;

  try {
    if (provider === "anthropic") {
      const bloco = opts.ehPdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: opts.base64 } }
        : { type: "image", source: { type: "base64", media_type: opts.mime, data: opts.base64 } };
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": resolved.key, "anthropic-version": "2023-06-01" },
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
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolved.key}` },
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
