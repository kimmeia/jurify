/**
 * Testes das funções puras de busca da base jurídica (RAG) — similaridade de
 * cosseno, parsing de embedding e ranqueamento top-K. Sem DB/API.
 */
import { describe, it, expect } from "vitest";
import { similaridadeCosseno, parseEmbedding, rankearPorSimilaridade } from "../juridico/busca";

describe("similaridadeCosseno", () => {
  it("vetores idênticos → 1", () => {
    expect(similaridadeCosseno([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it("vetores ortogonais → 0", () => {
    expect(similaridadeCosseno([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it("vetores opostos → -1", () => {
    expect(similaridadeCosseno([1, 1], [-1, -1])).toBeCloseTo(-1, 6);
  });
  it("mesma direção, magnitudes diferentes → 1 (cosseno ignora magnitude)", () => {
    expect(similaridadeCosseno([2, 4], [1, 2])).toBeCloseTo(1, 6);
  });
  it("tamanhos diferentes ou vazio → 0", () => {
    expect(similaridadeCosseno([1, 2, 3], [1, 2])).toBe(0);
    expect(similaridadeCosseno([], [1])).toBe(0);
  });
  it("vetor nulo (norma 0) → 0", () => {
    expect(similaridadeCosseno([0, 0], [1, 1])).toBe(0);
  });
});

describe("parseEmbedding", () => {
  it("JSON de floats válido → array", () => {
    expect(parseEmbedding("[0.1,0.2,0.3]")).toEqual([0.1, 0.2, 0.3]);
  });
  it("null/vazio → null", () => {
    expect(parseEmbedding(null)).toBeNull();
    expect(parseEmbedding("")).toBeNull();
  });
  it("JSON inválido ou não-numérico → null", () => {
    expect(parseEmbedding("{nao json")).toBeNull();
    expect(parseEmbedding('["a","b"]')).toBeNull();
  });
});

describe("rankearPorSimilaridade", () => {
  const itens = [
    { id: "a", embedding: [1, 0, 0] },
    { id: "b", embedding: [0.9, 0.1, 0] },
    { id: "c", embedding: [0, 1, 0] },
    { id: "sem", embedding: null }, // sem vetor → fora do ranking
  ];

  it("ordena do mais similar ao menos, e ignora itens sem embedding", () => {
    const r = rankearPorSimilaridade([1, 0, 0], itens, 10);
    expect(r.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(r.find((x) => x.id === "sem")).toBeUndefined();
    expect(r[0].score).toBeCloseTo(1, 6);
  });

  it("respeita o topK", () => {
    const r = rankearPorSimilaridade([1, 0, 0], itens, 2);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
  });
});
