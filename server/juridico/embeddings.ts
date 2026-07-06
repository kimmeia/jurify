/**
 * Geração de embeddings pra base jurídica (RAG). Usa a API de embeddings da
 * OpenAI (`text-embedding-3-small` — barata e boa). A chave é resolvida pelo
 * caller (chave do escritório → plataforma, via `resolverAPIKey`); templates e
 * redação usam o modelo que o escritório configura, mas embedding é sempre
 * OpenAI (é o índice compartilhado da base).
 */
import { createLogger } from "../_core/logger";

const log = createLogger("juridico-embeddings");

export const MODELO_EMBEDDING = "text-embedding-3-small";

/**
 * Gera o embedding de um texto. Lança em erro de rede/API pra o caller decidir
 * (no seed, logamos e seguimos; na busca, degradamos).
 */
export async function gerarEmbedding(texto: string, apiKey: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: MODELO_EMBEDDING, input: texto.slice(0, 8000) }),
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    throw new Error(`Embeddings OpenAI ${res.status}: ${detalhe.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const emb = json?.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length === 0) {
    throw new Error("Embeddings OpenAI: resposta sem vetor");
  }
  return emb;
}

/** Versão tolerante — retorna null (e loga) em vez de lançar. Usada na busca. */
export async function gerarEmbeddingSeguro(texto: string, apiKey: string): Promise<number[] | null> {
  try {
    return await gerarEmbedding(texto, apiKey);
  } catch (err: any) {
    log.warn({ err: err?.message }, "Falha ao gerar embedding");
    return null;
  }
}
