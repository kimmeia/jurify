import { describe, it, expect } from "vitest";
import { mimeDoNome, chunkTexto } from "../juridico/leitura-documento";

describe("mimeDoNome", () => {
  it("detecta tipos por extensão", () => {
    expect(mimeDoNome("Contrato.pdf")).toBe("application/pdf");
    expect(mimeDoNome("peticao.DOCX")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(mimeDoNome("rg_cliente.jpg")).toBe("image/jpeg");
    expect(mimeDoNome("print.PNG")).toBe("image/png");
    expect(mimeDoNome("notas.txt")).toBe("text/plain");
  });

  it("desconhecido → octet-stream", () => {
    expect(mimeDoNome("arquivo.xyz")).toBe("application/octet-stream");
    expect(mimeDoNome("semextensao")).toBe("application/octet-stream");
  });
});

describe("chunkTexto", () => {
  it("texto curto → 1 trecho", () => {
    expect(chunkTexto("decisão curta")).toEqual(["decisão curta"]);
    expect(chunkTexto("")).toEqual([]);
  });

  it("texto longo → vários trechos que cobrem todo o conteúdo", () => {
    const paragrafo = "Este é um parágrafo de ementa com conteúdo jurídico relevante. ";
    const longo = paragrafo.repeat(120); // ~7200 chars
    const chunks = chunkTexto(longo, 1200, 150);
    expect(chunks.length).toBeGreaterThan(1);
    // cada trecho respeita o teto (com folga do corte de frase)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1300);
    // termina (não entra em loop) e cobre o começo
    expect(chunks[0]).toContain("ementa");
  });

  it("não entra em loop com texto sem pontuação", () => {
    const semPontos = "a".repeat(5000);
    const chunks = chunkTexto(semPontos, 1000, 100);
    expect(chunks.length).toBeGreaterThanOrEqual(5);
  });
});
