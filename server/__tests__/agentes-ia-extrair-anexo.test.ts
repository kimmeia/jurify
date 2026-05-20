/**
 * Testes do helper `extrairTextoAnexo` — usado pelo chat dos Agentes IA
 * para extrair texto de anexos (PDF, TXT, MD, CSV, JSON) e injetar no
 * contexto da IA.
 *
 * Antes do fix, só TXT/MD/CSV/JSON eram extraídos — usuário anexava PDF
 * e a IA via apenas o nome do arquivo. Agora PDF também é parseado.
 */

import { describe, it, expect } from "vitest";
import { extrairTextoAnexo } from "../integracoes/router-agente-chat";

// PDF mínimo válido com texto "Hello World". Gerado à mão (xref correto).
// pdfkit gera PDFs com xref que o pdfjs lê parcialmente — esse PDF
// canônico cobre o caminho "PDF normal" com confiança.
const HELLO_WORLD_PDF_BASE64 =
  "JVBERi0xLjEKJcKlwrHDqwoKMSAwIG9iagogIDw8IC9UeXBlIC9DYXRhbG9nCiAgICAgL1BhZ2VzIDIgMCBSCiAgPj4KZW5kb2JqCgoyIDAgb2JqCiAgPDwgL1R5cGUgL1BhZ2VzCiAgICAgL0tpZHMgWzMgMCBSXQogICAgIC9Db3VudCAxCiAgICAgL01lZGlhQm94IFswIDAgMzAwIDE0NF0KICA+PgplbmRvYmoKCjMgMCBvYmoKICA8PCAgL1R5cGUgL1BhZ2UKICAgICAgL1BhcmVudCAyIDAgUgogICAgICAvUmVzb3VyY2VzCiAgICAgICA8PCAvRm9udAogICAgICAgICAgIDw8IC9GMQogICAgICAgICAgICAgICA8PCAvVHlwZSAvRm9udAogICAgICAgICAgICAgICAgICAvU3VidHlwZSAvVHlwZTEKICAgICAgICAgICAgICAgICAgL0Jhc2VGb250IC9UaW1lcy1Sb21hbgogICAgICAgICAgICAgICA+PgogICAgICAgICAgID4+CiAgICAgICA+PgogICAgICAvQ29udGVudHMgNCAwIFIKICA+PgplbmRvYmoKCjQgMCBvYmoKICA8PCAvTGVuZ3RoIDU1ID4+CnN0cmVhbQogIEJUCiAgICAvRjEgMTggVGYKICAgIDAgMCBUZAogICAgKEhlbGxvIFdvcmxkKSBUagogIEVUCmVuZHN0cmVhbQplbmRvYmoKCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxOCAwMDAwMCBuIAowMDAwMDAwMDc3IDAwMDAwIG4gCjAwMDAwMDAxNzggMDAwMDAgbiAKMDAwMDAwMDQ1NyAwMDAwMCBuIAp0cmFpbGVyCiAgPDwgIC9Sb290IDEgMCBSCiAgICAgIC9TaXplIDUKICA+PgpzdGFydHhyZWYKNTY1CiUlRU9G";

describe("extrairTextoAnexo — formatos texto", () => {
  it("text/plain: lê o buffer como UTF-8", async () => {
    const r = await extrairTextoAnexo("text/plain", Buffer.from("Olá mundo"));
    expect(r).toBe("Olá mundo");
  });

  it("text/markdown: lê normalmente", async () => {
    const md = "# Título\n\nParágrafo com **bold**";
    const r = await extrairTextoAnexo("text/markdown", Buffer.from(md));
    expect(r).toBe(md);
  });

  it("text/csv: lê linhas", async () => {
    const csv = "nome,idade\nAna,30\nBruno,25";
    const r = await extrairTextoAnexo("text/csv", Buffer.from(csv));
    expect(r).toBe(csv);
  });

  it("application/json: lê o conteúdo cru (sem parse)", async () => {
    const json = '{"foo":"bar","n":42}';
    const r = await extrairTextoAnexo("application/json", Buffer.from(json));
    expect(r).toBe(json);
  });

  it("trunca texto longo a 20000 chars", async () => {
    const txt = "x".repeat(25000);
    const r = await extrairTextoAnexo("text/plain", Buffer.from(txt));
    expect(r?.length).toBe(20000);
  });
});

describe("extrairTextoAnexo — PDF", () => {
  it("extrai texto de um PDF válido (Hello World)", async () => {
    const pdf = Buffer.from(HELLO_WORLD_PDF_BASE64, "base64");
    const r = await extrairTextoAnexo("application/pdf", pdf);
    expect(r).toBeTruthy();
    expect(r).toContain("Hello World");
  });

  it("PDF inválido retorna null sem lançar", async () => {
    const r = await extrairTextoAnexo("application/pdf", Buffer.from("not a pdf"));
    expect(r).toBeNull();
  });

  it("PDF acima do limite (>25MB) retorna null", async () => {
    // Buffer de 26MB qualquer — não precisa ser um PDF válido, o cheque
    // de tamanho acontece antes do parsing.
    const big = Buffer.alloc(26 * 1024 * 1024);
    const r = await extrairTextoAnexo("application/pdf", big);
    expect(r).toBeNull();
  });
});

describe("extrairTextoAnexo — DOCX (Word moderno)", () => {
  it("extrai texto de um DOCX válido", async () => {
    // Cria um DOCX mínimo válido em memória usando jszip (já está nas deps
    // — é usada pelo mammoth também). DOCX é só um zip com XMLs específicos.
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Minuta de petição — teste mammoth</w:t></w:r></w:p>
  </w:body>
</w:document>`,
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });

    const r = await extrairTextoAnexo(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buf,
    );
    expect(r).toBeTruthy();
    expect(r).toContain("Minuta de petição");
    expect(r).toContain("teste mammoth");
  });

  it("DOCX inválido (não é zip) retorna null sem lançar", async () => {
    const r = await extrairTextoAnexo(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      Buffer.from("not a docx"),
    );
    expect(r).toBeNull();
  });

  it("DOCX acima do limite (>25MB) retorna null", async () => {
    const big = Buffer.alloc(26 * 1024 * 1024);
    const r = await extrairTextoAnexo(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      big,
    );
    expect(r).toBeNull();
  });
});

describe("extrairTextoAnexo — formatos não suportados", () => {
  it("DOC antigo (Word 97-2003) retorna null — mammoth não suporta", async () => {
    const r = await extrairTextoAnexo("application/msword", Buffer.from("..."));
    expect(r).toBeNull();
  });

  it("mime desconhecido retorna null", async () => {
    const r = await extrairTextoAnexo("image/jpeg", Buffer.from("fake"));
    expect(r).toBeNull();
  });
});
