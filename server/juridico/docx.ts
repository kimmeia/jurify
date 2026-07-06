/**
 * Gera um .docx da peça no PADRÃO FORENSE (uso no Judiciário), sem template e
 * sem dependência nova — monta o OOXML com PizZip.
 *
 * Padrão aplicado (ABNT/uso forense corrente):
 *   - A4, margens 3 cm (superior/esquerda) e 2 cm (inferior/direita)
 *   - Times New Roman 12, entrelinha 1,5, parágrafos JUSTIFICADOS
 *   - Recuo de 1ª linha (1,25 cm) no corpo
 *   - Endereçamento e título da ação: CAIXA ALTA, centralizado, negrito
 *   - Títulos de seção (DOS FATOS, DO DIREITO, DOS PEDIDOS…): negrito
 *
 * A classificação é por heurística sobre o texto que a IA devolve (o prompt
 * instrui a escrever endereçamento e seções em caixa alta). O advogado abre no
 * Word e finaliza.
 */
import PizZip from "pizzip";

// twips: 1 cm ≈ 566,93 twips
const CM = 566.93;
const MARGEM_GRANDE = Math.round(3 * CM); // 3 cm → 1701
const MARGEM_PEQUENA = Math.round(2 * CM); // 2 cm → 1134
const RECUO_1A_LINHA = Math.round(1.25 * CM); // 1,25 cm → 709
const ENTRELINHA_1_5 = 360; // 240 = simples; 360 = 1,5

function escaparXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Sem nenhuma letra minúscula (acentos incluídos) e com ao menos uma letra. */
function ehCaixaAlta(t: string): boolean {
  return /[A-ZÀ-Ý]/.test(t) && !/[a-zà-ÿ]/.test(t);
}

const RE_SECAO = /^(D[OA]S?\s|DO\s|DA\s|DAS\s|DOS\s|DE\s|[IVXLC]+\s*[-–.)]|\d+\s*[-–.)])/;

type Tipo = "titulo" | "secao" | "corpo" | "vazio";

function classificar(linha: string): Tipo {
  const t = linha.trim();
  if (!t) return "vazio";
  if (ehCaixaAlta(t)) {
    // Caixa alta curta que abre com marcador de seção → título de seção (à
    // esquerda). Caso contrário (endereçamento, nome da ação) → centralizado.
    return RE_SECAO.test(t) && t.length <= 80 ? "secao" : "titulo";
  }
  return "corpo";
}

function paragrafo(linha: string): string {
  const tipo = classificar(linha);
  if (tipo === "vazio") {
    // Parágrafo em branco preserva a separação visual entre blocos.
    return `<w:p><w:pPr><w:spacing w:line="${ENTRELINHA_1_5}" w:lineRule="auto"/></w:pPr></w:p>`;
  }
  const txt = escaparXml(linha.trim());

  if (tipo === "titulo") {
    return (
      `<w:p><w:pPr><w:spacing w:before="120" w:after="120" w:line="${ENTRELINHA_1_5}" w:lineRule="auto"/>` +
      `<w:jc w:val="center"/></w:pPr>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${txt}</w:t></w:r></w:p>`
    );
  }
  if (tipo === "secao") {
    return (
      `<w:p><w:pPr><w:spacing w:before="240" w:after="60" w:line="${ENTRELINHA_1_5}" w:lineRule="auto"/>` +
      `<w:jc w:val="both"/></w:pPr>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${txt}</w:t></w:r></w:p>`
    );
  }
  // corpo: justificado, recuo de 1ª linha
  return (
    `<w:p><w:pPr><w:spacing w:line="${ENTRELINHA_1_5}" w:lineRule="auto"/>` +
    `<w:jc w:val="both"/><w:ind w:firstLine="${RECUO_1A_LINHA}"/></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${txt}</w:t></w:r></w:p>`
  );
}

/** Colapsa 2+ linhas em branco em uma só (evita buraco duplo). */
function normalizarLinhas(texto: string): string[] {
  const linhas = String(texto).replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const l of linhas) {
    if (l.trim() === "" && out.length > 0 && out[out.length - 1].trim() === "") continue;
    out.push(l);
  }
  return out;
}

/** Constrói o Buffer .docx da peça no padrão forense. */
export function montarPecaDocx(texto: string): Buffer {
  const corpo = normalizarLinhas(texto).map(paragrafo).join("");

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${corpo}<w:sectPr>` +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="${MARGEM_GRANDE}" w:right="${MARGEM_PEQUENA}" w:bottom="${MARGEM_PEQUENA}" w:left="${MARGEM_GRANDE}" w:header="708" w:footer="708" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`;

  // Fonte e entrelinha padrão do documento (Times New Roman 12, 1,5).
  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>` +
    `<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="pt-BR"/>` +
    `</w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${ENTRELINHA_1_5}" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault>` +
    `</w:docDefaults></w:styles>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const documentRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const zip = new PizZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rels);
  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", documentRels);
  zip.file("word/styles.xml", stylesXml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/** @deprecated use montarPecaDocx — mantido pra compat de import. */
export const montarDocxSimples = montarPecaDocx;
