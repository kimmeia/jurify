/**
 * Testa o gerador de .docx simples da peça: zip válido com as partes
 * obrigatórias, texto presente e XML devidamente escapado.
 */
import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import { montarDocxSimples, montarPecaDocx } from "../juridico/docx";

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

describe("montarPecaDocx — padrão forense", () => {
  const peca =
    "EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO\n\n" +
    "Fulano de Tal, brasileiro, vem propor a presente\n\n" +
    "AÇÃO REVISIONAL DE CONTRATO\n\n" +
    "DOS FATOS\n\n" +
    "O autor <réu> pagou 5 & voltou.\n\n" +
    "DOS PEDIDOS\n\n" +
    "Requer a citação do réu.";
  const zip = new PizZip(montarPecaDocx(peca));
  const doc = zip.file("word/document.xml")!.asText();
  const sty = zip.file("word/styles.xml")!.asText();

  it("inclui styles.xml com Times New Roman 12", () => {
    expect(zip.file("word/styles.xml")).toBeTruthy();
    expect(sty).toContain("Times New Roman");
    expect(sty).toContain('w:sz w:val="24"'); // 12pt = 24 meio-pontos
  });

  it("é um pacote Word COMPLETO (não o mínimo que o Word recusa abrir)", () => {
    // Regressão: injetamos num shell válido do Word. Estas partes precisam
    // existir — sem elas o Word não abre (bug que motivou a mudança).
    expect(zip.file("docProps/core.xml")).toBeTruthy();
    expect(zip.file("docProps/app.xml")).toBeTruthy();
    expect(zip.file("word/settings.xml")).toBeTruthy();
    expect(zip.file("word/fontTable.xml")).toBeTruthy();
  });

  it("margens 3 cm (sup/esq) e 2 cm (inf/dir)", () => {
    expect(doc).toContain('w:top="1701"');
    expect(doc).toContain('w:left="1701"');
    expect(doc).toContain('w:right="1134"');
    expect(doc).toContain('w:bottom="1134"');
  });

  it("corpo justificado com recuo de 1ª linha e entrelinha 1,5", () => {
    expect(doc).toContain('w:jc w:val="both"');
    expect(doc).toContain('w:firstLine="709"');
    expect(doc).toContain('w:line="360"');
  });

  it("endereçamento/título em caixa alta ficam centralizados e em negrito", () => {
    expect(doc).toContain('w:jc w:val="center"');
    expect(doc).toContain("<w:b/>");
  });

  it("escapa XML e não vaza caracteres crus", () => {
    expect(doc).toContain("&lt;réu&gt;");
    expect(doc).not.toContain("<réu>");
  });

  it("transcrição de jurisprudência (« ») vira citação recuada 4 cm, fonte 10", () => {
    const zip2 = new PizZip(
      montarPecaDocx("DO DIREITO\n\n«A capitalização mensal é vedada sem pactuação. (STJ)»\n\nProsseguindo."),
    );
    const doc2 = zip2.file("word/document.xml")!.asText();
    expect(doc2).toContain('w:ind w:left="2268"'); // recuo de 4 cm
    expect(doc2).toContain('w:sz w:val="20"'); // fonte 10 na citação
    expect(doc2).toContain("A capitalização mensal é vedada"); // texto sem os guillemets
    expect(doc2).not.toContain("«"); // marcadores removidos
  });
});
