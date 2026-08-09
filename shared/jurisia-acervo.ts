/**
 * O que o acervo público contém, em vocabulário de advogado.
 *
 * Vive em `shared/` porque a TELA depende disto: sem saber quais classes e
 * assuntos existem, o módulo vira adivinhação — o advogado digita, erra, e
 * nunca descobre que o acervo só tem execução fiscal.
 */

import type { ComposicaoNatureza } from "./jurisia-grau";

export interface FatiaAcervo {
  nome: string;
  quantidade: number;
}

export interface ComposicaoAcervo {
  total: number;
  tribunais: Array<{ tribunal: string; processos: number }>;
  classes: FatiaAcervo[];
  assuntos: FatiaAcervo[];
  /** Quantas ficaram fora do topo — a tela diz "+ N tipos". */
  classesRestantes: number;
  assuntosRestantes: number;
  /** Quanto do acervo é acórdão e quanto é sentença de 1º grau. */
  natureza: ComposicaoNatureza;
}

export const ACERVO_VAZIO: ComposicaoAcervo = {
  total: 0,
  tribunais: [],
  classes: [],
  assuntos: [],
  classesRestantes: 0,
  assuntosRestantes: 0,
  natureza: { jurisprudencia: 0, estatistica: 0, indefinido: 0 },
};
