/**
 * A capa que dá pra montar com a TABELA DE RESULTADOS da busca do tribunal.
 *
 * A grade já mostra classe judicial, órgão julgador, data de autuação e os
 * nomes dos dois polos — tudo na tela que o robô abre pra chegar no processo.
 * Quando a página do processo não abre, é isso que impede o card de nascer
 * vazio. É resumo, não capa: não tem valor da causa, advogado, nem CPF das
 * partes, e por isso o card marca a procedência ("Lido na lista do tribunal").
 *
 * Funções puras de propósito: o mesmo cálculo é conferido no teste sem
 * navegador nem banco.
 */

import type { LinhaDaBusca } from "../../scripts/spike-motor-proprio/lib/types-spike";
import { parseDataBR, normalizarCnj } from "../../scripts/spike-motor-proprio/lib/parser-utils";
import { ehRotuloDeTabela } from "../../shared/nova-acao-capa";

export type CapaBrutaDaLista = {
  classe: string | null;
  assuntos: string[];
  orgaoJulgador: string | null;
  valorCausaCentavos: null;
  dataDistribuicao: string | null;
  partes: Array<{ nome: string; polo: "ativo" | "passivo"; documento: null }>;
};

/** A linha do CNJ pedido, comparando só os dígitos (a grade vem com máscara). */
export function linhaDoCnj(
  linhas: LinhaDaBusca[] | null | undefined,
  cnj: string,
): LinhaDaBusca | null {
  if (!Array.isArray(linhas)) return null;
  const alvo = normalizarCnj(cnj);
  if (alvo.length !== 20) return null;
  return linhas.find((l) => normalizarCnj(l.cnj) === alvo) ?? null;
}

/**
 * A capa que o scraper devolveu tem alguma coisa dentro?
 *
 * Rótulo de coluna não conta como conteúdo: era isso que fazia uma capa sem
 * nada passar por boa e sobrescrever a capa de verdade de um processo vigiado.
 */
export function capaDoScraperTemConteudo(
  capa: { classe?: string | null; orgaoJulgador?: string | null; partes?: unknown } | null | undefined,
): boolean {
  if (!capa) return false;
  const util = (v: string | null | undefined) => !!v && !!v.trim() && !ehRotuloDeTabela(v);
  const partes = Array.isArray(capa.partes) ? capa.partes : [];
  return util(capa.classe) || util(capa.orgaoJulgador) || partes.length > 0;
}

export function capaBrutaDaLinha(linha: LinhaDaBusca): CapaBrutaDaLista {
  const partes: CapaBrutaDaLista["partes"] = [];
  for (const nome of linha.poloAtivo ?? []) {
    if (nome.trim()) partes.push({ nome: nome.trim(), polo: "ativo", documento: null });
  }
  for (const nome of linha.poloPassivo ?? []) {
    if (nome.trim()) partes.push({ nome: nome.trim(), polo: "passivo", documento: null });
  }
  return {
    classe: linha.classe,
    // A grade não traz assunto: inventar um a partir da classe seria escrever
    // no card uma coisa que o tribunal não disse.
    assuntos: [],
    orgaoJulgador: linha.orgaoJulgador,
    valorCausaCentavos: null,
    dataDistribuicao: parseDataBR(linha.autuadoEm),
    partes,
  };
}
