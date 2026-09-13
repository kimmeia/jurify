/**
 * Parsers PUROS das telas do PJe: recebem um Document e devolvem dados.
 *
 * São o espelho, fora do navegador, do que o `PjeTjceScraper` faz dentro de
 * `page.evaluate` — grade de resultados pelos TÍTULOS das colunas, capa por
 * `<dt>/<dd>` e `<th>/<td>` recusando rótulo de tabela, timeline do
 * `#divTimeLine`. Nascem ao lado do scraper, testados com fixture; a troca
 * do `evaluate` por eles é o passo seguinte.
 *
 * Regra que vale nos três: layout que mudou devolve VAZIO, nunca o campo
 * errado. Foi assim que "Polo ativo" virou natureza da ação num card.
 */

import type { LinhaDaBusca, MovimentacaoProcesso } from "../../../../scripts/spike-motor-proprio/lib/types-spike";
import { parseDataBR, parseValorBRLCentavos } from "../../../../scripts/spike-motor-proprio/lib/parser-utils";
import { ehRotuloDeTabela } from "../../../../shared/nova-acao-capa";

const trim = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/** Sem acento, sem caixa, sem os dois-pontos e sem espaço duplo. */
function chave(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[:\s]+$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const REGEX_CNJ = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;

// ── Grade de resultados ─────────────────────────────────────────────────────

/** Cada campo aceita mais de um título: o PJe varia entre graus e tribunais. */
const COLUNAS: Record<keyof Omit<LinhaDaBusca, "cnj"> | "cnj", string[]> = {
  cnj: ["numero do processo", "processo", "numero"],
  classe: ["classe judicial", "classe"],
  orgaoJulgador: ["orgao julgador", "vara", "juizo"],
  autuadoEm: ["autuado em", "autuacao", "data de autuacao", "distribuicao", "ultima distribuicao"],
  poloAtivo: ["polo ativo", "autor", "requerente", "exequente"],
  poloPassivo: ["polo passivo", "reu", "requerido", "executado"],
};

function linhaDeCabecalho(tabela: Element): Element | null {
  for (const tr of Array.from(tabela.querySelectorAll("tr"))) {
    if (tr.querySelectorAll("th").length >= 2) return tr;
  }
  return null;
}

/** Texto do nó com `<br>` virando quebra de linha (o `textContent` os engole). */
function textoComQuebras(no: Node): string {
  if (no.nodeType === 3) return (no as Text).data ?? "";
  if (no.nodeType !== 1) return "";
  const el = no as Element;
  if (el.tagName.toUpperCase() === "BR") return "\n";
  return Array.from(el.childNodes).map(textoComQuebras).join("");
}

function nomesDaCelula(el: Element | undefined): string[] {
  if (!el) return [];
  // Uma célula guarda várias partes separadas por quebra de linha ou <br>.
  return textoComQuebras(el)
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((l) => trim(l))
    .filter((l) => l.length > 2 && l.length < 200)
    .slice(0, 6);
}

function tabelasCandidatas(doc: Document): Element[] {
  const todas = Array.from(doc.querySelectorAll("table"));
  // A grade do PJe tem `processosTable` no id; quando ela existe, é ela.
  const grade = todas.filter((t) => /processosTable/i.test(t.getAttribute("id") ?? ""));
  return grade.length ? grade : todas;
}

/**
 * Linhas da grade de resultados, lidas pelo TÍTULO de cada coluna. Tabela sem
 * "Classe" e sem "Polo ativo" não é a grade; linha sem CNJ não é processo.
 */
export function lerLinhasDaBusca(doc: Document): LinhaDaBusca[] {
  const saida: LinhaDaBusca[] = [];
  for (const tabela of tabelasCandidatas(doc)) {
    const cabecalho = linhaDeCabecalho(tabela);
    if (!cabecalho) continue;
    const titulos = Array.from(cabecalho.querySelectorAll("th")).map((th) => chave(trim(th.textContent)));
    const indice: Partial<Record<keyof typeof COLUNAS, number>> = {};
    for (const campo of Object.keys(COLUNAS) as Array<keyof typeof COLUNAS>) {
      const i = titulos.findIndex((t) => COLUNAS[campo].includes(t));
      if (i >= 0) indice[campo] = i;
    }
    if (indice.classe === undefined && indice.poloAtivo === undefined) continue;

    for (const tr of Array.from(tabela.querySelectorAll("tr"))) {
      const tds = Array.from(tr.querySelectorAll("td"));
      if (tds.length === 0) continue;
      const celulaEl = (campo: keyof typeof COLUNAS): Element | undefined =>
        indice[campo] !== undefined ? tds[indice[campo] as number] : undefined;
      const celula = (campo: keyof typeof COLUNAS): string => trim(celulaEl(campo)?.textContent);
      const cnj = (celula("cnj").match(REGEX_CNJ) ?? trim(tr.textContent).match(REGEX_CNJ))?.[0];
      if (!cnj) continue;
      saida.push({
        cnj,
        classe: celula("classe") || null,
        orgaoJulgador: celula("orgaoJulgador") || null,
        autuadoEm: celula("autuadoEm") || null,
        poloAtivo: nomesDaCelula(celulaEl("poloAtivo")),
        poloPassivo: nomesDaCelula(celulaEl("poloPassivo")),
      });
    }
  }
  return saida;
}

// ── Capa do processo ────────────────────────────────────────────────────────

export type CapaPje = {
  classe: string | null;
  orgaoJulgador: string | null;
  assuntos: string[];
  /** Como o tribunal escreveu ("R$ 18.400,00"). */
  valorCausa: string | null;
  valorCausaCentavos: number | null;
  /** Como o tribunal escreveu ("11 ago 2025", "07/05/2026"). */
  dataDistribuicao: string | null;
  dataDistribuicaoIso: string | null;
};

const CELULAS_DE_VALOR = new Set(["DD", "TD"]);

function proximaCelulaDeValor(rotulo: Element): Element | null {
  let irmao: Element | null = rotulo.nextElementSibling;
  while (irmao && !CELULAS_DE_VALOR.has(irmao.tagName.toUpperCase())) {
    // Outro rótulo antes de qualquer valor: este campo está vazio. Seguir
    // adiante devolveria o valor do campo VIZINHO.
    if (["DT", "TH", "LABEL"].includes(irmao.tagName.toUpperCase())) return null;
    irmao = irmao.nextElementSibling;
  }
  if (irmao) return irmao;
  // Alguns layouts põem o rótulo dentro de um wrapper e o valor na célula
  // seguinte ao wrapper. Só célula de valor serve.
  const pai = rotulo.parentElement;
  const depoisDoPai = pai?.nextElementSibling ?? null;
  if (depoisDoPai && CELULAS_DE_VALOR.has(depoisDoPai.tagName.toUpperCase())) return depoisDoPai;
  return null;
}

/**
 * Valor de um campo pelo rótulo exato em `<dt>`, `<th>` ou `<label>`. Valor
 * que É um título de coluna/seção é recusado — numa linha de cabeçalho o
 * vizinho de "Classe judicial" é "Polo ativo".
 */
function lerEmListaDefinicao(doc: Document, rotulos: string[]): string | null {
  const chaves = rotulos.map(chave);
  for (const el of Array.from(doc.querySelectorAll("dt, th, label"))) {
    const tx = chave(trim(el.textContent));
    if (!chaves.includes(tx)) continue;
    const celula = proximaCelulaDeValor(el);
    if (!celula) continue;
    const v = trim(celula.textContent);
    if (v && !ehRotuloDeTabela(v)) return v;
  }
  return null;
}

function parseAssuntos(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]|\s+e\s+/)
    .map((a) => a.trim())
    .filter((a) => a.length > 2);
}

export function lerCapaPje(doc: Document): CapaPje {
  const classe = lerEmListaDefinicao(doc, ["Classe judicial", "Classe"]);
  const orgaoJulgador = lerEmListaDefinicao(doc, ["Órgão julgador", "Vara", "Juízo"]);
  // Só "Valor da causa" — nunca "Valor" sozinho, que casa "Valor do bem".
  const valorCausa = lerEmListaDefinicao(doc, ["Valor da causa"]);
  const dataDistribuicao = lerEmListaDefinicao(doc, [
    "Última distribuição",
    "Autuação",
    "Autuado em",
    "Distribuído em",
    "Data de distribuição",
    "Data de autuação",
    "Distribuição",
  ]);
  const assuntos = parseAssuntos(lerEmListaDefinicao(doc, ["Assunto", "Assuntos"]));
  return {
    classe,
    orgaoJulgador,
    assuntos,
    valorCausa,
    valorCausaCentavos: parseValorBRLCentavos(valorCausa),
    dataDistribuicao,
    dataDistribuicaoIso: parseDataBR(dataDistribuicao),
  };
}

// ── Movimentações ───────────────────────────────────────────────────────────

const MESES_PT: Record<string, string> = {
  jan: "01", fev: "02", mar: "03", abr: "04", mai: "05", jun: "06",
  jul: "07", ago: "08", set: "09", out: "10", nov: "11", dez: "12",
};

function dataDeSeparador(txt: string): string | null {
  const m1 = txt.match(/(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+(\d{4})/i);
  if (m1) return `${m1[3]}-${MESES_PT[m1[2].toLowerCase()] ?? "01"}-${m1[1].padStart(2, "0")}`;
  const m2 = txt.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

function textoLimpo(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  // O `.media` aninhado é sub-documento da mesma petição: tem a própria
  // hora, e deixá-lo no texto do pai esconde a hora do pai do regex.
  clone.querySelectorAll("script, style, .media").forEach((s) => s.remove());
  return trim(clone.textContent);
}

const RE_DOC = /(documento|download|arquivo|anexo|conteudo|visualizar|inteiroTeor|pdf)/i;

function baseDoDocumento(doc: Document): string | undefined {
  const base = doc.querySelector("base[href]")?.getAttribute("href");
  if (base) return base;
  const uri = (doc as { baseURI?: string }).baseURI;
  return uri && /^https?:/i.test(uri) ? uri : undefined;
}

function linkDoDocumento(el: Element, base: string | undefined): { url: string; nome: string } | null {
  for (const a of Array.from(el.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    // Link JSF só dispara AJAX: não tem o que baixar por HTTP.
    if (!href || /^javascript:/i.test(href) || href === "#") continue;
    const classe = a.getAttribute("class") ?? "";
    const titulo = a.getAttribute("title") ?? "";
    if (!RE_DOC.test(href) && !RE_DOC.test(classe) && !RE_DOC.test(titulo)) continue;
    let url = href;
    try {
      url = new URL(href, base).toString();
    } catch {
      // sem base absoluta, o href relativo fica como está
    }
    return { url, nome: trim(titulo || a.textContent).slice(0, 200) };
  }
  return null;
}

const SELETORES_TIMELINE: Array<(doc: Document) => Element | null> = [
  (d) => d.getElementById("divTimeLine:eventosTimeLineElement"),
  (d) => porSufixoDeId(d, ":eventosTimeLineElement"),
  (d) => d.querySelector(".eventos-timeline"),
  (d) => porSufixoDeId(d, ":divEventosTimeLine"),
  (d) => d.querySelector(".timeline"),
  (d) => d.querySelector("#divTimeLine .timeline"),
  (d) => d.querySelector("#divTimeLine ol"),
  (d) => d.querySelector("#divTimeLine ul"),
  (d) => d.getElementById("divTimeLine"),
  (d) => porTrechoDeId(d, "timeline"),
];

function porSufixoDeId(doc: Document, sufixo: string): Element | null {
  return Array.from(doc.querySelectorAll("[id]")).find((e) => (e.getAttribute("id") ?? "").endsWith(sufixo)) ?? null;
}

function porTrechoDeId(doc: Document, trecho: string): Element | null {
  const alvo = trecho.toLowerCase();
  return Array.from(doc.querySelectorAll("[id]")).find((e) => (e.getAttribute("id") ?? "").toLowerCase().includes(alvo)) ?? null;
}

function movimentacoesDaTimeline(container: Element, base: string | undefined): MovimentacaoProcesso[] {
  const out: MovimentacaoProcesso[] = [];
  let dataAtual: string | null = null;
  // Só filhos diretos: o `.media` pai contém `.media` filhos (sub-documentos
  // da mesma petição) e lê-los duplicaria a movimentação.
  for (const el of Array.from(container.children)) {
    const tag = el.tagName.toUpperCase();
    if (!["DIV", "LI"].includes(tag)) continue;
    const classes = el.getAttribute("class") ?? "";

    const dataInterna = el.querySelector(".data-interna");
    if (dataInterna) {
      const d = dataDeSeparador(textoLimpo(dataInterna));
      if (d) {
        dataAtual = d;
        continue;
      }
    }
    if (/\bdata\b/.test(classes) && !el.querySelector(".media-body span:not(.text-muted)")) continue;

    const texto = textoLimpo(el);
    if (!texto || texto.length < 3) continue;

    const horaNoFim = texto.match(/(\d{2}):(\d{2})\s*$/);
    if (horaNoFim && dataAtual) {
      const semHora = texto.slice(0, horaNoFim.index).trim();
      if (semHora.length >= 3) {
        const doc1 = linkDoDocumento(el, base);
        out.push({
          data: `${dataAtual}T${horaNoFim[1]}:${horaNoFim[2]}:00`,
          texto: semHora,
          tipo: null,
          documento: doc1?.nome ?? null,
          documentoUrl: doc1?.url ?? null,
        });
        continue;
      }
    }

    const inicioBR = texto.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})?\s*[-:]?\s*(.+)/);
    if (inicioBR) {
      const [d, m, y] = inicioBR[1].split("/");
      const doc2 = linkDoDocumento(el, base);
      out.push({
        data: `${y}-${m}-${d}${inicioBR[2] ? `T${inicioBR[2]}:00` : ""}`,
        texto: inicioBR[3].trim(),
        tipo: null,
        documento: doc2?.nome ?? null,
        documentoUrl: doc2?.url ?? null,
      });
      continue;
    }

    const separadorSolto = /^(\d{1,2}\s+[a-z]{3}\s+\d{4}|\d{2}\/\d{2}\/\d{4})$/i.test(texto) ? dataDeSeparador(texto) : null;
    if (separadorSolto) {
      dataAtual = separadorSolto;
      continue;
    }

    if (dataAtual && texto.length > 10 && /[a-zA-Z]/.test(texto)) {
      const doc3 = linkDoDocumento(el, base);
      out.push({
        data: `${dataAtual}T00:00:00`,
        texto: texto.slice(0, 500),
        tipo: null,
        documento: doc3?.nome ?? null,
        documentoUrl: doc3?.url ?? null,
      });
    }
  }
  return out;
}

function tabelaDeMovimentacoes(doc: Document): Element | null {
  return (
    Array.from(doc.querySelectorAll("table")).find((t) => {
      const id = (t.getAttribute("id") ?? "").toLowerCase();
      const classe = (t.getAttribute("class") ?? "").toLowerCase();
      return id.includes("movimenta") || id.includes("movimento") || classe.includes("movimentacoes");
    }) ?? null
  );
}

function movimentacoesDaTabela(tabela: Element, base: string | undefined): MovimentacaoProcesso[] {
  const out: MovimentacaoProcesso[] = [];
  for (const tr of Array.from(tabela.querySelectorAll("tr"))) {
    const tds = Array.from(tr.querySelectorAll("td"));
    if (tds.length === 0) continue;
    // Célula por célula: o `textContent` da linha cola "Petição" em "baixar".
    const texto = tds.map(textoLimpo).join(" ").trim();
    const m = texto.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::\d{2})?)?/);
    if (!m) continue;
    const resto = texto.replace(m[0], "").replace(/^[\s\-:]+/, "").trim();
    if (resto.length < 3) continue;
    const link = linkDoDocumento(tr, base);
    out.push({
      // Mesmo formato da timeline (sem fuso): o tribunal escreve hora local.
      data: `${m[3]}-${m[2]}-${m[1]}${m[4] ? `T${m[4]}:${m[5]}:00` : ""}`,
      texto: resto,
      tipo: null,
      documento: link?.nome ?? null,
      documentoUrl: link?.url ?? null,
    });
  }
  return out;
}

/**
 * Movimentações da timeline (`#divTimeLine`) ou, sem ela, da tabela de
 * movimentações. Sem nenhum dos dois devolve vazio — nunca lê o `body`
 * inteiro, que renderia menu e rodapé como movimentação.
 */
export function lerMovimentacoesPje(doc: Document): MovimentacaoProcesso[] {
  const base = baseDoDocumento(doc);
  for (const acha of SELETORES_TIMELINE) {
    let container: Element | null = null;
    try {
      container = acha(doc);
    } catch {
      container = null;
    }
    if (container) return movimentacoesDaTimeline(container, base);
  }
  const tabela = tabelaDeMovimentacoes(doc);
  return tabela ? movimentacoesDaTabela(tabela, base) : [];
}
