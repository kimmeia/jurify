/**
 * Tira ementas da resposta de um portal de jurisprudência.
 *
 * Por que o extrator é GENÉRICO em vez de um parser escrito à mão por
 * tribunal: daqui não dá para ver a resposta de nenhum deles (o proxy do
 * ambiente bloqueia os portais), e parser escrito sem ver o corpo real é
 * ficção — ele passa no teste que eu mesmo inventei e quebra no primeiro dia.
 * O genérico procura o que TODO portal de jurisprudência tem: um campo (ou um
 * bloco) cujo nome ou rótulo é "ementa", com um identificador do julgado ao
 * lado.
 *
 * A consequência está no desenho do produto, não escondida aqui: fonte nasce
 * desligada, a sondagem mostra o corpo de verdade, e quem liga confere o que
 * a primeira coleta trouxe. O extrator devolve o que achou; ele nunca inventa
 * campo que não veio.
 */

import { parseHtml } from "../processos/adapters/parse/dom";
import { repararMojibake } from "@shared/texto-mojibake";

export interface EmentaBruta {
  identificador: string;
  orgao: string | null;
  relator: string | null;
  /** ISO (YYYY-MM-DD) ou null. */
  julgadoEm: string | null;
  ementa: string;
  url: string | null;
}

/** Nomes de campo que carregam o texto da decisão, em JSON de portal. */
const CAMPO_EMENTA = /^(ementa|ementa_texto|ementatexto|textoementa|acordao|ac[oó]rd[aã]o|inteiroteor|textointegral|decisao|tese)$/i;
const CAMPO_IDENTIFICADOR = /^(titulo|title|identificacao|identificador|processo|numeroprocesso|numero|classe|nomeprocesso)$/i;
const CAMPO_ORGAO = /^(orgao|org[aã]o|orgaojulgador|colegiado|camara|c[aâ]mara|turma|secao|se[cç][aã]o)$/i;
const CAMPO_RELATOR = /^(relator|ministro|desembargador|relatornome)$/i;
const CAMPO_DATA = /^(datajulgamento|dtjulgamento|julgamento|datadecisao|data|publicacao|datapublicacao)$/i;
const CAMPO_URL = /^(url|link|urlacordao|inteiroteorurl|href|permalink)$/i;

/** Texto com jeito de ementa: começa a valer a partir de um tamanho mínimo. */
const MINIMO_EMENTA = 60;

function limpar(v: unknown): string {
  if (typeof v !== "string") return "";
  return repararMojibake(v)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Data em qualquer das formas que os portais usam → ISO, ou null. */
export function dataIso(v: unknown): string | null {
  const t = limpar(v);
  if (!t) return null;
  const br = t.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function achar(obj: Record<string, unknown>, padrao: RegExp): unknown {
  for (const [k, v] of Object.entries(obj)) {
    if (padrao.test(k.replace(/[_\s-]/g, ""))) return v;
  }
  return undefined;
}

/**
 * Um registro vira ementa quando tem texto de decisão E alguma identificação.
 * Sem identificador não dá pra citar; sem texto não é ementa.
 */
function registroParaEmenta(reg: Record<string, unknown>): EmentaBruta | null {
  const ementa = limpar(achar(reg, CAMPO_EMENTA));
  if (ementa.length < MINIMO_EMENTA) return null;
  const identificador = limpar(achar(reg, CAMPO_IDENTIFICADOR)).slice(0, 250);
  if (!identificador) return null;
  return {
    identificador,
    orgao: limpar(achar(reg, CAMPO_ORGAO)).slice(0, 180) || null,
    relator: limpar(achar(reg, CAMPO_RELATOR)).slice(0, 180) || null,
    julgadoEm: dataIso(achar(reg, CAMPO_DATA)),
    ementa,
    url: limpar(achar(reg, CAMPO_URL)) || null,
  };
}

/**
 * Varre o JSON inteiro atrás de registros com cara de julgado.
 *
 * Percorre em vez de exigir um caminho fixo porque cada portal aninha o
 * resultado num lugar (`result.hits`, `data.items`, `documentos`…), e fixar o
 * caminho de um quebra em todos os outros.
 */
export function extrairEmentasDeJson(corpo: unknown, limite = 50): EmentaBruta[] {
  const achados: EmentaBruta[] = [];
  const vistos = new Set<string>();
  const fila: unknown[] = [corpo];
  let passos = 0;

  while (fila.length && achados.length < limite && passos < 20_000) {
    passos++;
    const atual = fila.shift();
    if (Array.isArray(atual)) {
      fila.push(...atual);
      continue;
    }
    if (!atual || typeof atual !== "object") continue;

    const reg = atual as Record<string, unknown>;
    const e = registroParaEmenta(reg);
    if (e && !vistos.has(e.identificador)) {
      vistos.add(e.identificador);
      achados.push(e);
    }
    for (const v of Object.values(reg)) {
      if (v && typeof v === "object") fila.push(v);
    }
  }
  return achados;
}

/**
 * Tira ementas de uma página de resultados.
 *
 * A âncora é a palavra EMENTA no texto — é o rótulo que os portais imprimem
 * antes do teor, e o único que se repete entre eles. De cada bloco que a
 * contém, sobe até o container do resultado e lê o que estiver lá.
 */
export function extrairEmentasDeHtml(html: string, baseUrl: string, limite = 50): EmentaBruta[] {
  const document = parseHtml(html);

  const achados: EmentaBruta[] = [];
  const vistos = new Set<string>();

  // O bloco do resultado é o MENOR que tem as duas coisas: o texto da ementa e
  // o número que identifica o julgado. O parágrafo da ementa sozinho não serve
  // (não dá pra citar sem o número), e a página inteira serve menos ainda.
  const SELETOR = "tr, td, li, article, section, div";
  const comAsDuas = [...document.querySelectorAll(SELETOR)].filter((el) => {
    const t = el.textContent || "";
    if (!/\bEMENTA\b/i.test(t) || t.length <= MINIMO_EMENTA || t.length >= 12_000) return false;
    return identificadorNoTexto(t) !== null;
  });
  const candidatos = comAsDuas.filter(
    (el) => !comAsDuas.some((outro) => outro !== el && el.contains(outro as never)),
  );

  for (const el of candidatos) {
    if (achados.length >= limite) break;

    const texto = limpar(el.textContent);
    const depoisDoRotulo = texto.replace(/^.*?\bEMENTA\b[:\s-]*/i, "").trim();
    const ementa = (depoisDoRotulo.length >= MINIMO_EMENTA ? depoisDoRotulo : texto).slice(0, 6_000);
    if (ementa.length < MINIMO_EMENTA) continue;

    const identificador = identificadorNoTexto(texto);
    if (!identificador || vistos.has(identificador)) continue;
    vistos.add(identificador);

    const link = el.querySelector("a[href]")?.getAttribute("href") || null;
    achados.push({
      identificador,
      orgao: rotuloNoTexto(texto, /(?:Órg[aã]o Julgador|C[aâ]mara|Turma|Se[cç][aã]o)[:\s]+([^·|\n]{3,80})/i),
      relator: rotuloNoTexto(texto, /(?:Relator[a]?|Ministro[a]?|Des\.)[:\s]+([^·|\n]{3,80})/i),
      julgadoEm: dataIso(texto.match(/\d{2}\/\d{2}\/\d{4}/)?.[0]),
      ementa,
      url: link ? absolutizar(link, baseUrl) : null,
    });
  }
  return achados;
}

/** O número do processo, que é como o julgado se identifica em qualquer portal. */
export function identificadorNoTexto(texto: string): string | null {
  const cnj = texto.match(/\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/);
  if (cnj) return cnj[0].slice(0, 250);
  const classe = texto.match(
    /((?:Apela[cç][aã]o|Agravo|Recurso Especial|Recurso Extraordin[aá]rio|Embargos|Habeas Corpus|Mandado de Seguran[cç]a)[^,.;]{0,60}\d[\d.\-/]{3,})/i,
  );
  return classe ? limpar(classe[1]).slice(0, 250) : null;
}

function rotuloNoTexto(texto: string, padrao: RegExp): string | null {
  const m = texto.match(padrao);
  return m ? limpar(m[1]).slice(0, 180) : null;
}

/** Link relativo do portal vira absoluto — senão o "ver no tribunal" não abre. */
export function absolutizar(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString().slice(0, 500);
  } catch {
    return href.slice(0, 500);
  }
}
