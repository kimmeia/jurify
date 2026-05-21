import { describe, expect, it } from "vitest";
import {
  extrairTextoDocumento,
  particionarContexto,
  truncarPalavra,
} from "./agente-doc-extracao";

describe("extrairTextoDocumento — arquivos texto puro", () => {
  it("extrai TXT UTF-8", async () => {
    const buf = Buffer.from("Conteúdo do documento.\nLinha 2.", "utf-8");
    const r = await extrairTextoDocumento(buf, "text/plain");
    expect(r.texto).toBe("Conteúdo do documento.\nLinha 2.");
    expect(r.erro).toBeNull();
  });

  it("extrai Markdown", async () => {
    const buf = Buffer.from("# Título\n\nConteúdo.", "utf-8");
    const r = await extrairTextoDocumento(buf, "text/markdown");
    expect(r.texto).toBe("# Título\n\nConteúdo.");
  });

  it("extrai CSV", async () => {
    const buf = Buffer.from("col1,col2\nvalor1,valor2", "utf-8");
    const r = await extrairTextoDocumento(buf, "text/csv");
    expect(r.texto).toContain("col1,col2");
  });

  it("extrai JSON como texto", async () => {
    const buf = Buffer.from('{"chave": "valor"}', "utf-8");
    const r = await extrairTextoDocumento(buf, "application/json");
    expect(r.texto).toBe('{"chave": "valor"}');
  });

  it("ignora charset extra no mimeType", async () => {
    const buf = Buffer.from("hello", "utf-8");
    const r = await extrairTextoDocumento(buf, "text/plain; charset=utf-8");
    expect(r.texto).toBe("hello");
  });
});

describe("extrairTextoDocumento — casos de erro", () => {
  it("buffer vazio devolve erro", async () => {
    const r = await extrairTextoDocumento(Buffer.alloc(0), "text/plain");
    expect(r.texto).toBeNull();
    expect(r.erro).toBe("Arquivo vazio");
  });

  it("mimeType desconhecido devolve erro descritivo", async () => {
    const buf = Buffer.from("abc", "utf-8");
    const r = await extrairTextoDocumento(buf, "image/png");
    expect(r.texto).toBeNull();
    expect(r.erro).toContain("não suportado");
  });

  it("arquivo de texto totalmente em branco devolve erro", async () => {
    const buf = Buffer.from("   \n  ", "utf-8");
    const r = await extrairTextoDocumento(buf, "text/plain");
    expect(r.texto).toBeNull();
    expect(r.erro).toBe("Arquivo sem texto");
  });
});

describe("truncarPalavra", () => {
  it("não trunca quando texto cabe", () => {
    expect(truncarPalavra("curto", 100)).toBe("curto");
  });

  it("corta no fim de frase quando possível", () => {
    const texto = "Primeira frase. Segunda frase. Terceira frase muito longa que estoura o limite.";
    const r = truncarPalavra(texto, 35);
    expect(r).toMatch(/\.\s*\[…\]$/);
    expect(r.length).toBeLessThanOrEqual(45);
  });

  it("corta na última palavra quando não tem fim de frase", () => {
    const texto = "palavra1 palavra2 palavra3 palavra4 palavra5";
    const r = truncarPalavra(texto, 20);
    expect(r).not.toContain("palavra5");
    expect(r).toMatch(/\[…\]$/);
  });

  it("fallback bruto quando nem palavra dá pra preservar", () => {
    const r = truncarPalavra("aaaaaaaaaaaaaaa", 5);
    expect(r).toBe("aaaaa…");
  });
});

describe("particionarContexto", () => {
  it("retorna vazio sem docs válidos", () => {
    expect(particionarContexto([])).toBe("");
    expect(particionarContexto([{ nome: "a", conteudo: null }])).toBe("");
    expect(particionarContexto([{ nome: "a", conteudo: "   " }])).toBe("");
  });

  it("inclui doc inteiro quando cabe no limite", () => {
    const r = particionarContexto(
      [{ nome: "contrato.pdf", conteudo: "texto curto" }],
      8000,
      3000,
    );
    expect(r).toBe("[contrato.pdf]\ntexto curto");
  });

  it("trunca doc que excede cota individual", () => {
    const conteudoLongo = "palavra ".repeat(1000); // ~8000 chars
    const r = particionarContexto(
      [{ nome: "longo.pdf", conteudo: conteudoLongo }],
      8000,
      500,
    );
    expect(r.length).toBeLessThan(600);
    expect(r).toMatch(/\[…\]$/);
  });

  it("distribui espaço entre múltiplos docs", () => {
    const r = particionarContexto(
      [
        { nome: "a", conteudo: "texto a curto" },
        { nome: "b", conteudo: "texto b curto" },
        { nome: "c", conteudo: "texto c curto" },
      ],
      8000,
      3000,
    );
    expect(r).toContain("[a]");
    expect(r).toContain("[b]");
    expect(r).toContain("[c]");
  });

  it("respeita limite total — para de adicionar quando atinge", () => {
    const conteudoLongo = "x".repeat(5000);
    const r = particionarContexto(
      [
        { nome: "a", conteudo: conteudoLongo },
        { nome: "b", conteudo: conteudoLongo },
        { nome: "c", conteudo: conteudoLongo },
      ],
      6000,
      4000,
    );
    expect(r.length).toBeLessThanOrEqual(7000); // margem pra nomes/separadores
  });

  it("pula docs com conteudo null/vazio", () => {
    const r = particionarContexto(
      [
        { nome: "tem", conteudo: "tem conteudo" },
        { nome: "vazio", conteudo: null },
        { nome: "branco", conteudo: "   " },
      ],
    );
    expect(r).toContain("[tem]");
    expect(r).not.toContain("[vazio]");
    expect(r).not.toContain("[branco]");
  });
});
