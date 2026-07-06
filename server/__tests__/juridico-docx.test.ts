/**
 * Testa o gerador de .docx simples da peça: zip válido com as partes
 * obrigatórias, texto presente e XML devidamente escapado.
 */
import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import { montarDocxSimples } from "../juridico/docx";

describe("montarDocxSimples", () => {
  const buf = montarDocxSimples("Dos Fatos\nO autor <réu> pagou 5 & voltou.\n\nDos Pedidos");
  const zip = new PizZip(buf);

  it("gera um zip com as partes obrigatórias do docx", () => {
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(zip.file("_rels/.rels")).toBeTruthy();
    expect(zip.file("word/document.xml")).toBeTruthy();
  });

  it("inclui o texto e escapa caracteres XML", () => {
    const xml = zip.file("word/document.xml")!.asText();
    expect(xml).toContain("Dos Fatos");
    expect(xml).toContain("Dos Pedidos");
    expect(xml).toContain("&lt;réu&gt;");
    expect(xml).toContain("&amp;");
    // Não vaza < > & crus dentro do conteúdo do texto.
    expect(xml).not.toContain("<réu>");
  });

  it("um parágrafo por linha", () => {
    const xml = zip.file("word/document.xml")!.asText();
    const paras = (xml.match(/<w:p>/g) || []).length;
    expect(paras).toBe(4); // 3 linhas + 1 linha vazia
  });
});
