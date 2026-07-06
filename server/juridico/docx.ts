/**
 * Gera um .docx simples a partir de texto livre (a peça redigida) — sem
 * template e sem dependência nova: monta o OOXML mínimo com PizZip. Cada linha
 * vira um parágrafo; o advogado abre no Word e finaliza. Linhas que parecem
 * título de seção (curtas, sem ponto final) saem em negrito.
 */
import PizZip from "pizzip";

function escaparXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pareceTitulo(linha: string): boolean {
  const t = linha.trim();
  if (t.length === 0 || t.length > 60) return false;
  // Ex.: "Dos Fatos", "DO DIREITO", "Dos Pedidos" — sem pontuação final.
  return /^(d[oae]s?\s+|da\s+|do\s+)?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]+$/.test(t) && !/[.:;]$/.test(t);
}

function paragrafo(linha: string): string {
  const txt = escaparXml(linha);
  const bold = pareceTitulo(linha);
  const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${txt}</w:t></w:r></w:p>`;
}

/** Constrói o Buffer .docx a partir do texto (parágrafos separados por \n). */
export function montarDocxSimples(texto: string): Buffer {
  const linhas = String(texto).replace(/\r\n/g, "\n").split("\n");
  const corpo = linhas.map(paragrafo).join("");

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${corpo}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1701"/></w:sectPr></w:body></w:document>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const zip = new PizZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rels);
  zip.file("word/document.xml", documentXml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
