/**
 * O documento que o rótulo do PJe já entrega.
 *
 * A timeline do PJe escreve o movimento junto com o número e o tipo da peça:
 *
 *   "Embargos de Declaração Não-acolhidos 226220878 - Sentença"
 *   "Proferido despacho de mero expediente 226277277 - Despacho"
 *   "Juntada de Petição de Contra-razões 213403847 - Contrarrazões"
 *   "Publicado Intimação em 23/06/2026. Documento: 207819057"
 *
 * O scraper descarta os links da timeline quando são `javascript:void(0)` —
 * que é como o PJe monta os links JSF. Sem URL, o evento era gravado como
 * `sem_documento`, e a tela dizia "o tribunal não anexou peça nenhuma".
 * Falso: a peça está ali, o número dela está no próprio texto. O que faltava
 * era o caminho até o arquivo, não a peça.
 *
 * Ler o rótulo não custa requisição nenhuma e já muda o que a tela pode
 * afirmar: de "não existe" para "existe, ainda não lemos".
 */

export type DocumentoDoRotulo = {
  /** Id do documento no tribunal, como aparece no rótulo. */
  id: string;
  /** "Sentença", "Despacho", "Contrarrazões"… `null` quando o rótulo não diz. */
  tipo: string | null;
  /** O movimento sem a parte do documento — o que sobra pra exibir. */
  movimento: string;
};

/**
 * Id de documento do PJe tem 6 a 12 dígitos. O piso evita casar com número
 * pequeno solto no texto ("15 dias"); o teto evita casar com CNJ sem máscara,
 * que tem 20.
 */
const RE_ID_TIPO = /\s(\d{6,12})\s*[-–—]\s*([^\s].{0,48}?)\s*$/;
const RE_DOCUMENTO_LABEL = /\bdocumentos?\s*[:.]?\s*(\d{6,12})\b/i;

export function lerDocumentoNoRotulo(texto: string | null | undefined): DocumentoDoRotulo | null {
  const bruto = (texto ?? "").trim();
  if (!bruto) return null;

  // "… 226220878 - Sentença" — o formato mais comum, e o único que também
  // entrega o tipo da peça.
  const comTipo = bruto.match(RE_ID_TIPO);
  if (comTipo) {
    const tipo = comTipo[2].replace(/\s+/g, " ").trim();
    // Um tipo que é só número é sinal de que casamos com um intervalo
    // ("fls. 120 - 340"), não com documento.
    if (!/^\d+$/.test(tipo)) {
      return {
        id: comTipo[1],
        tipo: tipo.slice(0, 64),
        movimento: bruto.slice(0, comTipo.index).trim().replace(/[\s.,;:-]+$/, ""),
      };
    }
  }

  // "Publicado Intimação em 23/06/2026. Documento: 207819057" — sem tipo.
  const soId = bruto.match(RE_DOCUMENTO_LABEL);
  if (soId) {
    return {
      id: soId[1],
      tipo: null,
      movimento: bruto.slice(0, soId.index).trim().replace(/[\s.,;:-]+$/, "") || bruto,
    };
  }

  return null;
}
