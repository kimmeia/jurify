/**
 * Teor do documento de uma movimentação.
 *
 * O que a timeline do PJe entrega é o RÓTULO do movimento ("Julgado
 * procedente o pedido", "Remetidos os Autos para Instância Superior"). O
 * documento assinado pelo juiz mora atrás de um link no item da timeline —
 * e é ele que responde "o que o juiz decidiu e o que exatamente escreveu".
 *
 * Este módulo cuida da parte determinística: decidir se vale buscar,
 * transformar PDF/HTML em texto limpo, e localizar no texto o trecho que
 * fundamenta um prazo (pra UI grifar em vez de o advogado caçar). A parte
 * que depende de sessão autenticada (navegar até a URL) fica no adapter.
 *
 * Buscar teor custa requisição no tribunal, e requisição demais foi o que
 * derrubou o motor antes. Por isso `deveBuscarTeor` é conservador: só
 * documentos que plausivelmente decidem algo, nunca expediente de rotina.
 */

import { createLogger } from "../_core/logger";

const log = createLogger("teor-documento");

/** Teto de caracteres persistidos. Sentença de 40 páginas não cabe (e não
 *  precisa) — o que importa está no dispositivo, que vem no fim, então
 *  cortamos preservando começo e fim. */
export const MAX_TEOR_CHARS = 60_000;

export type TeorStatus = "pendente" | "ok" | "sem_documento" | "indisponivel" | "erro";

/**
 * Rótulos que valem abrir o documento. Deliberadamente restrito: cada
 * entrada aqui vira tráfego extra no PJe pra todo escritório.
 *
 * Ordem não importa — é teste de inclusão sobre o texto normalizado.
 */
const GATILHOS_TEOR = [
  "decis",        // decisão, decisões, decidido
  "despach",      // despacho, despachos
  "senten",       // sentença
  "acordao", "acórdão",
  "julgad", "julgou", "julgamento",
  "intima",       // intimação, intimado
  "cita",         // citação, citado
  "audienc", "audiênc",
  "liminar",
  "tutela",
  "homolog",
  "determin",
  "manifest",
  "prazo",
  "mandado",
  "expedi",       // expedição de alvará, mandado...
] as const;

/**
 * Rótulos de puro expediente. Vencem os gatilhos acima quando batem — sem
 * isso "Juntada de petição de manifestação" (rotina) abriria documento por
 * causa do "manifest".
 */
const BLOQUEIOS_TEOR = [
  "conclus",             // conclusos para despacho/decisão
  "distribu",            // distribuído por sorteio/dependência
  "remessa", "remetid",  // remessa dos autos
  "recebiment dos autos",
  "juntada",
  "publicad", "publicac", "publicaç", "disponibiliza",
  "arquivad",
  "desarquivad",
  "baixa definitiva",
  "certidao", "certidão",
  "decurso de prazo",
] as const;

/** Normaliza pra comparação: minúsculo, sem acento, espaço colapsado. */
export function normalizarParaBusca(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Vale gastar uma requisição no tribunal por esta movimentação?
 *
 * Falso-negativo aqui é barato (o advogado pode pedir o teor manualmente no
 * painel); falso-positivo é caro (tráfego que aproxima o motor do bloqueio).
 */
export function deveBuscarTeor(textoMovimentacao: string): boolean {
  const t = normalizarParaBusca(textoMovimentacao);
  if (t.length < 8) return false;
  if (BLOQUEIOS_TEOR.some((b) => t.includes(b))) return false;
  return GATILHOS_TEOR.some((g) => t.includes(g));
}

/**
 * HTML → texto. O PJe serve muitos documentos como HTML dentro de um viewer,
 * com tabela de layout e cabeçalho institucional. Sem remover script/style e
 * sem preservar quebra de bloco, o texto sai como uma parede única onde não
 * dá pra distinguir dispositivo de relatório.
 */
export function extrairTextoDeHtml(html: string): string {
  if (!html) return "";
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ");
  // Blocos viram quebra de linha ANTES de as tags sumirem.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|section|article|blockquote)>/gi, "\n");
  s = s.replace(/<\/t[dh]>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodificarEntidades(s);
  return normalizarTeor(s);
}

const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  aacute: "á", agrave: "à", atilde: "ã", acirc: "â",
  eacute: "é", ecirc: "ê", iacute: "í",
  oacute: "ó", otilde: "õ", ocirc: "ô",
  uacute: "ú", ccedil: "ç",
  Aacute: "Á", Atilde: "Ã", Ccedil: "Ç", Eacute: "É", Oacute: "Ó",
};

function decodificarEntidades(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, nome) => ENTIDADES[nome] ?? m);
}

/**
 * Limpa o texto vindo de PDF/HTML: colapsa espaço, remove linha em branco
 * repetida e tira numeração de página solta, que o pdf-parse intercala no
 * meio das frases e atrapalha tanto a leitura quanto a citação literal.
 */
export function normalizarTeor(texto: string): string {
  if (!texto) return "";
  return texto
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    // "3", "- 3 -", "Página 3 de 12"
    .filter((l) => !/^[-–—\s]*(p[áa]g(ina)?\.?\s*)?\d+(\s*(de|\/)\s*\d+)?[-–—\s]*$/i.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Corta preservando início e fim. O dispositivo ("Ante o exposto,
 * JULGO...") mora no fim — truncar só pela frente jogaria fora justamente
 * a parte que decide.
 */
export function truncarTeor(texto: string, max = MAX_TEOR_CHARS): string {
  if (texto.length <= max) return texto;
  const cabeca = Math.floor(max * 0.6);
  const cauda = max - cabeca - 40;
  return `${texto.slice(0, cabeca).trim()}\n\n[… trecho omitido …]\n\n${texto.slice(-cauda).trim()}`;
}

/**
 * Acha no teor a frase que contém a agulha (o trecho que a IA citou), pra UI
 * grifar. Compara normalizado porque a IA reescreve acento/caixa/espaço ao
 * copiar, e uma comparação literal falharia justamente nos casos em que ela
 * acertou o conteúdo.
 *
 * Retorna o trecho ORIGINAL (com acentuação do documento), não o normalizado.
 */
export function localizarTrecho(teor: string, agulha: string): string | null {
  if (!teor || !agulha) return null;
  const alvo = normalizarParaBusca(agulha).replace(/^["“”']|["“”']$/g, "");
  if (alvo.length < 12) return null;

  const normDoc = normalizarParaBusca(teor);
  let pos = normDoc.indexOf(alvo);

  // A IA costuma citar cortando o fim ("...sob pena de preclusão." vira
  // "...sob pena de preclusao"). Tenta de novo com um prefixo do alvo.
  if (pos < 0 && alvo.length > 40) pos = normDoc.indexOf(alvo.slice(0, 40));
  if (pos < 0) return null;

  // O índice do texto normalizado não bate com o do original (acento e
  // espaço colapsado deslocam). Reconstrói caminhando os dois em paralelo.
  const inicioOriginal = mapearIndice(teor, pos);
  const fimOriginal = mapearIndice(teor, pos + Math.min(alvo.length, 400));
  if (inicioOriginal == null || fimOriginal == null) return null;

  return teor.slice(inicioOriginal, fimOriginal).trim() || null;
}

/**
 * Converte um índice do texto normalizado no índice equivalente do original,
 * andando caractere a caractere e contando só o que sobrevive à normalização.
 */
function mapearIndice(original: string, indiceNormalizado: number): number | null {
  let vistos = 0;
  let espacoPendente = false;
  for (let i = 0; i < original.length; i++) {
    if (vistos >= indiceNormalizado) return i;
    const c = original[i];
    if (/\s/.test(c)) {
      // Espaço vira 1 char no normalizado, mas só se não for do início nem
      // repetido — daí o "pendente" em vez de contar na hora.
      espacoPendente = vistos > 0;
      continue;
    }
    if (espacoPendente) {
      vistos++;
      espacoPendente = false;
      if (vistos >= indiceNormalizado) return i;
    }
    // "ç" vira "c" (1 char) e "ﬁ" pode virar 2 — conta o que sobra do NFD.
    vistos += c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").length;
  }
  return vistos >= indiceNormalizado ? original.length : null;
}

/**
 * Traduz a falha em `teorStatus`. A distinção importa na UI: "segredo de
 * justiça" é um fato do processo (não adianta tentar de novo) enquanto
 * timeout é transitório (vale re-tentar).
 */
export function classificarFalhaTeor(erro: unknown): { status: TeorStatus; motivo: string } {
  const msg = normalizarParaBusca(erro instanceof Error ? erro.message : String(erro ?? ""));
  if (!msg) return { status: "erro", motivo: "falha desconhecida" };

  if (/segredo de justica|sigilos|nivel de sigilo|acesso negado|sem permissao|403|forbidden|unauthorized|401/.test(msg)) {
    return { status: "indisponivel", motivo: "documento sigiloso ou sem permissão de acesso" };
  }
  if (/404|nao encontrad|not found/.test(msg)) {
    return { status: "indisponivel", motivo: "documento não encontrado no tribunal" };
  }
  if (/escanead|sem texto extraivel|imagem/.test(msg)) {
    return { status: "erro", motivo: "PDF sem texto (documento escaneado)" };
  }
  if (/timeout|timedout|abort|etimedout|econnreset|network/.test(msg)) {
    return { status: "erro", motivo: "tempo esgotado ao baixar o documento" };
  }
  return { status: "erro", motivo: (erro instanceof Error ? erro.message : String(erro)).slice(0, 200) };
}

/**
 * Converte o corpo baixado em texto. `contentType` decide o parser; quando o
 * tribunal mente no header (acontece), cai no sniff do magic number do PDF.
 */
export async function textoDoDocumento(
  corpo: Buffer,
  contentType: string | null,
): Promise<string> {
  if (!corpo || corpo.length === 0) throw new Error("documento vazio");

  const ct = (contentType ?? "").toLowerCase();
  const ehPdf = ct.includes("pdf") || corpo.subarray(0, 5).toString("latin1") === "%PDF-";

  if (ehPdf) {
    const { extrairTextoDocumento } = await import("../_core/agente-doc-extracao");
    const { texto, erro } = await extrairTextoDocumento(corpo, "application/pdf");
    if (!texto) throw new Error(erro ?? "PDF sem texto extraível");
    return truncarTeor(normalizarTeor(texto));
  }

  if (ct.includes("html") || ct.includes("xml") || ct === "") {
    const texto = extrairTextoDeHtml(corpo.toString("utf-8"));
    if (texto.length < 40) throw new Error("HTML sem texto útil");
    return truncarTeor(texto);
  }

  if (ct.includes("text/")) {
    const texto = normalizarTeor(corpo.toString("utf-8"));
    if (!texto) throw new Error("documento sem texto");
    return truncarTeor(texto);
  }

  log.warn({ contentType }, "content-type de documento não reconhecido — tentando como HTML");
  const fallback = extrairTextoDeHtml(corpo.toString("utf-8"));
  if (fallback.length < 40) throw new Error(`formato não suportado (${ct || "desconhecido"})`);
  return truncarTeor(fallback);
}
