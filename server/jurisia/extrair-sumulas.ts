/**
 * Tira súmulas de uma listagem oficial — página, JSON ou texto colado.
 *
 * Por que súmula tem extrator próprio, separado do de ementa: o extrator de
 * ementa exige NÚMERO DE PROCESSO ao lado do texto (sem ele não dá pra citar
 * um acórdão), e súmula não tem processo nenhum — ela se identifica pelo
 * próprio número. Rodar o extrator de ementa numa página de súmulas devolve
 * zero, e o zero pareceria "a fonte não serve".
 *
 * O mesmo extrator serve para os três caminhos de propósito. O STJ barra a
 * faixa de IP do nosso servidor, então a lista dele pode ter que entrar por
 * texto colado à mão, uma vez — e súmula é material fechado, que muda poucas
 * vezes por ano, então uma vez basta. Fazer o robô e o caminho manual
 * compartilharem a mesma leitura é o que garante que o que entra colado é
 * idêntico ao que entraria sozinho.
 *
 * Súmula CANCELADA não entra. Quem cita súmula cancelada perde a causa, e o
 * sistema não pode ser o lugar de onde ela saiu — a contagem das que ficaram
 * de fora volta no resultado para ninguém achar que se perdeu texto.
 */

import { parseHtml } from "../processos/adapters/parse/dom";
import { repararMojibake } from "@shared/texto-mojibake";

export interface SumulaBruta {
  numero: number;
  vinculante: boolean;
  /** "Súmula 297/STJ" · "Súmula Vinculante 11/STF" — como se cita na peça. */
  identificador: string;
  texto: string;
}

export interface ColheitaSumulas {
  sumulas: SumulaBruta[];
  /** Quantas vinham marcadas como canceladas e ficaram fora, de propósito. */
  canceladas: number;
}

/**
 * O marcador do enunciado, nas formas que os dois tribunais imprimem:
 * "SÚMULA N. 297", "Súmula 297", "Súmula n.º 297", "SÚMULA VINCULANTE 11".
 */
const MARCADOR = /\bs[úu]mula\s*(vinculante)?\s*(?:n[.ºo°]{0,3}\s*)?(\d{1,4})\b/gi;

/** Menos que isto não é enunciado — é item de índice ou número de página. */
const MINIMO_TEXTO = 30;

/** Marca que o tribunal usa quando a súmula deixou de valer. */
const CANCELADA = /\(?\s*(cancelad[ao]|revogad[ao]|superad[ao]|sem efic[áa]cia)\s*\)?/i;

function limpar(v: unknown): string {
  if (typeof v !== "string") return "";
  return repararMojibake(v)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function identificadorDaSumula(numero: number, vinculante: boolean, tribunal: string): string {
  const nome = vinculante ? "Súmula Vinculante" : "Súmula";
  return tribunal ? `${nome} ${numero}/${tribunal}` : `${nome} ${numero}`;
}

/**
 * Lê uma listagem em texto corrido.
 *
 * O enunciado é o que vem DEPOIS de um marcador e ANTES do próximo — é assim
 * que as listas oficiais são impressas, e é o que sobrevive à conversão de PDF
 * pra texto, que embaralha coluna mas preserva a ordem.
 */
export function extrairSumulasDeTexto(bruto: string, tribunal: string): ColheitaSumulas {
  const texto = limpar(bruto);
  const sumulas: SumulaBruta[] = [];
  const vistos = new Set<string>();
  let canceladas = 0;

  const marcas: Array<{ inicio: number; fim: number; numero: number; vinculante: boolean }> = [];
  MARCADOR.lastIndex = 0;
  for (let m = MARCADOR.exec(texto); m !== null; m = MARCADOR.exec(texto)) {
    marcas.push({
      inicio: m.index,
      fim: m.index + m[0].length,
      numero: Number(m[2]),
      vinculante: Boolean(m[1]),
    });
  }

  for (let i = 0; i < marcas.length; i++) {
    const marca = marcas[i];
    const ate = i + 1 < marcas.length ? marcas[i + 1].inicio : texto.length;
    const corpo = texto
      .slice(marca.fim, ate)
      // Lista oficial costuma trazer a referência legislativa e a data de
      // julgamento depois do enunciado, separadas por parêntese — o enunciado
      // é o que interessa pra citação.
      .replace(/^[\s.:\-–—]+/, "")
      .trim();

    if (corpo.length < MINIMO_TEXTO) continue;
    if (CANCELADA.test(corpo.slice(0, 120))) {
      canceladas++;
      continue;
    }

    const chave = `${marca.vinculante ? "v" : "s"}${marca.numero}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    sumulas.push({
      numero: marca.numero,
      vinculante: marca.vinculante,
      identificador: identificadorDaSumula(marca.numero, marca.vinculante, tribunal),
      texto: corpo.slice(0, 4_000),
    });
  }

  return { sumulas, canceladas };
}

/**
 * Lê a página de uma listagem.
 *
 * Passa pelo DOM antes do texto porque `<script>`/`<style>` de portal têm
 * número solto que casaria com o marcador; e porque a página que lista SÓ os
 * números (índice com link) tem que devolver vazio em vez de enunciado picado.
 */
export function extrairSumulasDeHtml(html: string, tribunal: string): ColheitaSumulas {
  const document = parseHtml(html);
  for (const fora of document.querySelectorAll("script, style, noscript")) fora.remove();
  // `body` pode não existir: quando o corpo vem como pedaço de página (sem
  // `<html>`), o parser não inventa a moldura — e ler só o body devolveria
  // vazio, que se confundiria com "a fonte não trouxe nada".
  const texto = document.body?.textContent || document.documentElement?.textContent || "";
  return extrairSumulasDeTexto(texto, tribunal);
}

const CAMPO_TEXTO = /^(texto|enunciado|sumula|s[úu]mula|titulo|title|ementa|conteudo)$/i;
const CAMPO_NUMERO = /^(numero|num|n|codigo|sequencial|identificacao)$/i;
const CAMPO_VINCULANTE = /^(vinculante|sumulavinculante|tipo|base)$/i;

/**
 * Lê a resposta de uma API de súmulas.
 *
 * Vale a mesma escolha do extrator de ementa: percorre o JSON inteiro em vez de
 * exigir um caminho fixo, porque cada portal aninha o resultado no seu lugar e
 * fixar o caminho de um quebra em todos os outros.
 */
export function extrairSumulasDeJson(corpo: unknown, tribunal: string): ColheitaSumulas {
  const sumulas: SumulaBruta[] = [];
  const vistos = new Set<string>();
  let canceladas = 0;

  const fila: unknown[] = [corpo];
  let passos = 0;
  while (fila.length && passos < 20_000 && sumulas.length < 2_000) {
    passos++;
    const atual = fila.shift();
    if (Array.isArray(atual)) {
      fila.push(...atual);
      continue;
    }
    if (!atual || typeof atual !== "object") continue;
    const reg = atual as Record<string, unknown>;

    let texto = "";
    let numero = 0;
    let vinculante = false;
    for (const [k, v] of Object.entries(reg)) {
      const chave = k.replace(/[_\s-]/g, "");
      if (!texto && CAMPO_TEXTO.test(chave)) texto = limpar(v);
      if (!numero && CAMPO_NUMERO.test(chave)) {
        const n = Number(String(v ?? "").replace(/\D/g, ""));
        if (Number.isFinite(n) && n > 0) numero = n;
      }
      if (CAMPO_VINCULANTE.test(chave)) {
        vinculante = vinculante || v === true || /vinculante/i.test(String(v ?? ""));
      }
      if (v && typeof v === "object") fila.push(v);
    }

    // O número às vezes só existe DENTRO do texto ("Súmula 297. O Código…").
    if (!numero && texto) {
      MARCADOR.lastIndex = 0;
      const m = MARCADOR.exec(texto);
      if (m) {
        numero = Number(m[2]);
        vinculante = vinculante || Boolean(m[1]);
      }
    }
    if (!numero || texto.length < MINIMO_TEXTO) continue;
    if (CANCELADA.test(texto.slice(0, 120))) {
      canceladas++;
      continue;
    }

    const chave = `${vinculante ? "v" : "s"}${numero}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    // O enunciado guardado não repete o próprio marcador: quem cita já recebe
    // o identificador separado, e "Súmula 297/STJ — Súmula 297. O Código…"
    // entraria na peça com a repetição.
    const semMarcador = texto.replace(/^\s*s[úu]mula\s*(?:vinculante)?\s*(?:n[.ºo°]{0,3}\s*)?\d{1,4}\s*[.:\-–—]?\s*/i, "");
    sumulas.push({
      numero,
      vinculante,
      identificador: identificadorDaSumula(numero, vinculante, tribunal),
      texto: (semMarcador.length >= MINIMO_TEXTO ? semMarcador : texto).slice(0, 4_000),
    });
  }

  return { sumulas, canceladas };
}

/** Escolhe o leitor pelo que o corpo parece ser, não pelo que a fonte prometeu. */
export function colherSumulas(corpo: string, tribunal: string): ColheitaSumulas {
  const começo = corpo.trimStart();
  if (começo.startsWith("{") || começo.startsWith("[")) {
    try {
      return extrairSumulasDeJson(JSON.parse(corpo), tribunal);
    } catch {
      // Portal que promete JSON e devolve HTML de erro é comum demais pra
      // tratar como falha.
    }
  }
  if (/<\s*(html|body|div|table|p)\b/i.test(começo.slice(0, 2_000))) {
    return extrairSumulasDeHtml(corpo, tribunal);
  }
  return extrairSumulasDeTexto(corpo, tribunal);
}
