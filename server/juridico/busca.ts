/**
 * Busca por similaridade na base jurídica (RAG).
 *
 * Funções puras (sem DB/API) — a recuperação em si carrega as fontes da área
 * e ranqueia por similaridade de cosseno contra o embedding da consulta. Como
 * a base é curada (centenas de itens), roda em memória — sem infra vetorial.
 */

/** Cosseno entre dois vetores. Retorna 0 quando algum é vazio/incompatível. */
export function similaridadeCosseno(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Converte o embedding salvo (JSON string) em array de floats. null se inválido. */
export function parseEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.every((n) => typeof n === "number") ? v : null;
  } catch {
    return null;
  }
}

export type ItemComEmbedding = { embedding: number[] | null };

/**
 * Ranqueia itens por similaridade ao vetor da consulta e devolve os `topK`
 * com maior score. Itens sem embedding ficam de fora (não dá pra ranquear).
 */
export function rankearPorSimilaridade<T extends ItemComEmbedding>(
  queryEmb: number[],
  itens: T[],
  topK: number,
): Array<T & { score: number }> {
  const comScore: Array<T & { score: number }> = [];
  for (const it of itens) {
    if (!it.embedding) continue;
    comScore.push({ ...it, score: similaridadeCosseno(queryEmb, it.embedding) });
  }
  comScore.sort((x, y) => y.score - x.score);
  return comScore.slice(0, Math.max(1, topK));
}
