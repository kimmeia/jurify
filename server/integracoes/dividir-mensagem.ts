/**
 * Divisão de respostas automáticas em mensagens menores ("bolhas"),
 * simulando um atendente humano — comportamento aprovado via mockup.
 *
 * Regras (do mockup):
 *  - Resposta curta (< minCharsParaDividir, default 200) NÃO divide.
 *  - Quebra primeiro por parágrafos; parágrafo longo quebra por frases,
 *    agrupadas em chunks de tamanho conversacional.
 *  - NUNCA quebra no meio: blocos de lista (linhas com -, *, 1., a))
 *    ficam inteiros; valores (R$ 1.234,56), datas (12/06), horas (14h) e
 *    links não casam o padrão de fim de frase (ponto sem espaço), então
 *    permanecem intactos; abreviações comuns (Dr., Av., nº) não terminam
 *    frase.
 *  - Frase muito curta (saudação, pergunta final) gruda na vizinha.
 *  - Cap de mensagens (default 4): excedente é concatenado na última.
 *
 * O delay entre bolhas é proporcional ao tamanho do texto SEGUINTE
 * (simula o tempo de digitação), com faixas por ritmo.
 */

export type RitmoDivisao = "rapido" | "natural" | "calmo";

export interface OpcoesDivisao {
  /** Máximo de mensagens que uma resposta pode virar. Default 4. */
  maxMensagens?: number;
  /** Abaixo disso a resposta sai inteira. Default 200. */
  minCharsParaDividir?: number;
}

const MAX_MENSAGENS_DEFAULT = 4;
const MIN_CHARS_DIVIDIR_DEFAULT = 200;
/** Parágrafo acima disso tenta sub-dividir por frases. */
const PARAGRAFO_LONGO = 240;
/** Alvo de tamanho de um chunk ao agrupar frases. */
const ALVO_CHUNK_FRASES = 100;
/** Frase abaixo disso sempre gruda na vizinha (pergunta final, "Ok?"). */
const FRASE_MUITO_CURTA = 40;
/** Resíduo final menor que isso gruda no chunk anterior. */
const RESIDUO_MIN = 25;

/** Linha de item de lista: -, *, •, "1.", "2)", "a)". */
const RE_LINHA_LISTA = /^\s*(?:[-*•]|\d{1,2}[.)]|[a-z][.)])\s+/i;

/** Abreviações pt-BR comuns que terminam em "." sem encerrar a frase. */
const RE_ABREVIACAO =
  /\b(?:dr|dra|sr|sra|srta|prof|profa|av|art|inc|par|tel|obs|exmo|exma|n[ºo°]|p|pg|fl|fls|cód|min|máx|seg|ter|qua|qui|sex|sáb|dom)\.$/i;

interface Chunk {
  texto: string;
  /** Separador que liga este chunk ao ANTERIOR ao re-concatenar (cap). */
  sepAntes: " " | "\n\n";
}

function ehBlocoLista(paragrafo: string): boolean {
  const linhas = paragrafo.split("\n");
  return linhas.some((l) => RE_LINHA_LISTA.test(l));
}

/** Emoji(s) no início de um pedaço — pertencem ao fecho da frase ANTERIOR
 *  ("Tudo bem? 😊 Recebi..." → o 😊 fica com "Tudo bem?"). */
const RE_EMOJI_INICIO = /^((?:[\p{Extended_Pictographic}‍️]\s*)+)(.*)$/u;

/** Divide um parágrafo corrido em frases, sem quebrar abreviações. */
export function dividirFrases(texto: string): string[] {
  const brutas = texto.split(/(?<=[.!?…])\s+/);
  const out: string[] = [];
  for (let f of brutas) {
    const anterior = out[out.length - 1];
    if (anterior) {
      const emoji = f.match(RE_EMOJI_INICIO);
      if (emoji) {
        out[out.length - 1] = `${anterior} ${emoji[1].trim()}`;
        f = emoji[2];
        if (!f.trim()) continue;
      }
    }
    const anterior2 = out[out.length - 1];
    if (anterior2 && RE_ABREVIACAO.test(anterior2.trim())) {
      out[out.length - 1] = `${anterior2} ${f}`;
    } else {
      out.push(f);
    }
  }
  return out.map((f) => f.trim()).filter(Boolean);
}

/** Agrupa frases consecutivas em chunks de tamanho conversacional. */
function agruparFrases(frases: string[]): string[] {
  const chunks: string[] = [];
  let atual = "";
  for (const frase of frases) {
    if (!atual) {
      atual = frase;
      continue;
    }
    const candidato = `${atual} ${frase}`;
    // Frase muito curta nunca abre bolha própria (pergunta final, "Ok?").
    if (frase.length < FRASE_MUITO_CURTA || candidato.length <= ALVO_CHUNK_FRASES) {
      atual = candidato;
    } else {
      chunks.push(atual);
      atual = frase;
    }
  }
  if (atual) chunks.push(atual);
  return chunks;
}

export function dividirMensagemNatural(
  texto: string,
  opts?: OpcoesDivisao,
): string[] {
  const max = Math.max(1, opts?.maxMensagens ?? MAX_MENSAGENS_DEFAULT);
  const minDividir = opts?.minCharsParaDividir ?? MIN_CHARS_DIVIDIR_DEFAULT;

  const limpo = (texto || "").trim();
  if (!limpo) return [texto];
  if (limpo.length < minDividir || max === 1) return [limpo];

  const paragrafos = limpo.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: Chunk[] = [];

  for (const par of paragrafos) {
    // Lista ou parágrafo com quebras internas simples ficam inteiros —
    // "nunca quebra no meio".
    if (par.length <= PARAGRAFO_LONGO || ehBlocoLista(par) || par.includes("\n")) {
      chunks.push({ texto: par, sepAntes: "\n\n" });
      continue;
    }
    const agrupadas = agruparFrases(dividirFrases(par));
    agrupadas.forEach((t, i) =>
      chunks.push({ texto: t, sepAntes: i === 0 ? "\n\n" : " " }),
    );
  }

  // Resíduos: chunk minúsculo gruda no anterior.
  const consolidados: Chunk[] = [];
  for (const c of chunks) {
    const ant = consolidados[consolidados.length - 1];
    if (ant && c.texto.length < RESIDUO_MIN) {
      ant.texto = `${ant.texto}${c.sepAntes}${c.texto}`;
    } else {
      consolidados.push({ ...c });
    }
  }

  if (consolidados.length <= 1) return [limpo];

  // Cap: excedente concatenado na última mensagem, preservando o
  // separador de origem de cada pedaço.
  if (consolidados.length > max) {
    const visiveis = consolidados.slice(0, max - 1);
    const resto = consolidados.slice(max - 1);
    const ultima = resto
      .map((c, i) => (i === 0 ? c.texto : `${c.sepAntes}${c.texto}`))
      .join("");
    return [...visiveis.map((c) => c.texto), ultima];
  }

  return consolidados.map((c) => c.texto);
}

/**
 * Delay antes de enviar a PRÓXIMA bolha, proporcional ao tamanho dela
 * (simula digitação). Faixas em ms por ritmo (mockup: natural = 1–3s).
 */
export function calcularDelayDigitacaoMs(
  proximoTexto: string,
  ritmo: RitmoDivisao = "natural",
): number {
  const len = (proximoTexto || "").length;
  const faixas: Record<RitmoDivisao, { porChar: number; min: number; max: number }> = {
    rapido: { porChar: 12, min: 500, max: 1500 },
    natural: { porChar: 25, min: 1000, max: 3000 },
    calmo: { porChar: 40, min: 2000, max: 5000 },
  };
  const f = faixas[ritmo] ?? faixas.natural;
  return Math.min(f.max, Math.max(f.min, Math.round(len * f.porChar)));
}
