/**
 * Gera o .docx da peça no PADRÃO FORENSE, injetando os parágrafos num shell
 * .docx COMPLETO e válido do Word (peca-template-b64) — em vez de montar o
 * OOXML mínimo na mão, que o Word recusava abrir por faltar partes que ele
 * exige (docProps, settings, fontTable, theme…).
 *
 * Padrão do shell: A4, margens 3 cm (sup/esq) e 2 cm (inf/dir), Normal =
 * Times New Roman 12, entrelinha 1,5, justificado.
 *
 * Formatação por parágrafo (heurística sobre o texto que a IA devolve; o prompt
 * escreve endereçamento e seções em CAIXA ALTA):
 *   - endereçamento / título da ação (caixa alta) → centralizado, negrito
 *   - seções (DOS FATOS, DO DIREITO, DOS PEDIDOS…) → negrito
 *   - corpo → justificado, recuo de 1ª linha (herda fonte/entrelinha do Normal)
 */
import PizZip from "pizzip";
import { PECA_TEMPLATE_B64 } from "./peca-template-b64";

const RECUO_1A_LINHA = 709; // ~1,25 cm em twips
const RECUO_CITACAO = 2268; // 4 cm — recuo de citação longa (jurisprudência)
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

type Tipo = "titulo" | "secao" | "citacao" | "corpo" | "vazio";

function classificar(linha: string): Tipo {
  const t = linha.trim();
  if (!t) return "vazio";
  // Transcrição de jurisprudência marcada com guillemets/aspas → citação recuada.
  if (/^[«"“]/.test(t)) return "citacao";
  if (ehCaixaAlta(t)) {
    // Caixa alta curta abrindo com marcador de seção → título de seção (à
    // esquerda). Caso contrário (endereçamento, nome da ação) → centralizado.
    return RE_SECAO.test(t) && t.length <= 80 ? "secao" : "titulo";
  }
  return "corpo";
}

function paragrafo(linha: string): string {
  const tipo = classificar(linha);
  if (tipo === "vazio") return `<w:p></w:p>`;
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
  if (tipo === "citacao") {
    // Citação de jurisprudência (padrão ABNT/forense): recuo de 4 cm à
    // esquerda, fonte 10, espaçamento simples. Tira os guillemets marcadores.
    const limpo = escaparXml(linha.trim().replace(/^[«"“\s]+/, "").replace(/[»"”\s]+$/, ""));
    return (
      `<w:p><w:pPr><w:spacing w:before="60" w:after="60" w:line="240" w:lineRule="auto"/>` +
      `<w:jc w:val="both"/><w:ind w:left="${RECUO_CITACAO}"/></w:pPr>` +
      `<w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${limpo}</w:t></w:r></w:p>`
    );
  }
  // corpo: justificado, recuo de 1ª linha (fonte Times/entrelinha vêm do Normal)
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

/**
 * Constrói o Buffer .docx da peça. Injeta os parágrafos gerados no <w:body> do
 * shell válido, preservando o <w:sectPr> (margens) do template.
 */
export function montarPecaDocx(texto: string): Buffer {
  const corpo = normalizarLinhas(texto).map(paragrafo).join("");

  const zip = new PizZip(Buffer.from(PECA_TEMPLATE_B64, "base64"));
  const arq = zip.file("word/document.xml");
  if (!arq) throw new Error("Template de peça inválido: word/document.xml ausente.");
  const docXml = arq.asText();

  // Preserva o sectPr (margens/página) do template e injeta o corpo antes dele.
  const sect = (docXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/) || [""])[0];
  const novoDoc = docXml.replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${corpo}${sect}</w:body>`);

  zip.file("word/document.xml", novoDoc);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/** @deprecated use montarPecaDocx — mantido pra compat de import. */
export const montarDocxSimples = montarPecaDocx;
