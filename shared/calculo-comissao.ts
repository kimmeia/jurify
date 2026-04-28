/**
 * Cálculo de comissão de atendentes — helper puro.
 *
 * Suporta dois modos:
 * - "flat": uma única alíquota global aplicada sobre o total comissionável.
 * - "faixas": tabela cumulativa — a faixa cuja cota superior cobre a base define
 *   a alíquota aplicada sobre TODA a base comissionável (não-marginal). A base
 *   que classifica a faixa pode ser o recebido bruto ou apenas o comissionável.
 *
 * Elegibilidade resolve numa cascata:
 *   1) override manual (true/false na própria cobrança)
 *   2) flag da categoria (comissionável sim/não)
 *   3) cobrança sem categoria → comissionável por padrão
 *   4) corte por valor mínimo (cobrança abaixo do piso nunca comissiona)
 *
 * O helper não conhece DB nem datas como string: quem chama converte
 * `valor` (string varchar) → number e `dataPagamento` (varchar YYYY-MM-DD) → Date,
 * e filtra previamente cobranças fora do período / sem pagamento.
 */

export type MotivoExclusao =
  | "override_manual"
  | "categoria_nao_comissionavel"
  | "abaixo_minimo";

export interface CobrancaParaComissao {
  id: number;
  valor: number;
  /** Data efetiva do pagamento — quem chama garante que está dentro do período. */
  dataPagamento: Date;
  atendenteId: number | null;
  /** TRUE/FALSE quando a cobrança tem categoria; NULL = sem categoria. */
  categoriaComissionavel: boolean | null;
  /** TRUE/FALSE força a regra; NULL = obedece a categoria. */
  comissionavelOverride: boolean | null;
}

/** Faixa progressiva: cota superior (inclusiva) e alíquota correspondente. */
export interface FaixaComissao {
  /** NULL/Infinity = sem teto (última faixa). */
  limiteAte: number | null;
  aliquotaPercent: number;
}

export type ModoComissao = "flat" | "faixas";
export type BaseFaixa = "bruto" | "comissionavel";

export interface RegraComissao {
  modo?: ModoComissao;
  /** Usada quando modo='flat'. */
  aliquotaPercent: number;
  /** Cobranças com valor estritamente abaixo deste piso são excluídas. */
  valorMinimo: number;
  /** Usadas quando modo='faixas'. Devem estar ordenadas por limiteAte crescente. */
  faixas?: FaixaComissao[];
  /** Define qual valor classifica a faixa quando modo='faixas'. */
  baseFaixa?: BaseFaixa;
}

export interface ItemNaoComissionavel {
  cobranca: CobrancaParaComissao;
  motivo: MotivoExclusao;
}

export interface FaixaAplicada {
  ordem: number;
  limiteAte: number | null;
  aliquotaPercent: number;
  /** Valor da base usado pra classificar a faixa (bruto ou comissionável). */
  valorBaseClassificacao: number;
}

export interface ResultadoComissao {
  comissionaveis: CobrancaParaComissao[];
  naoComissionaveis: ItemNaoComissionavel[];
  totais: {
    bruto: number;
    comissionavel: number;
    naoComissionavel: number;
    valorComissao: number;
  };
  /** Alíquota efetivamente aplicada (no modo flat = regra.aliquotaPercent; no modo faixas = a da faixa atingida). */
  aliquotaAplicada: number;
  /** Detalhe da faixa atingida, presente apenas no modo "faixas". */
  faixaAplicada?: FaixaAplicada;
}

/**
 * Decide se uma cobrança específica entra na comissão.
 * Exposto separadamente para uso em UI (preview por linha) e testes.
 */
export function classificarCobranca(
  cobranca: CobrancaParaComissao,
  regra: { valorMinimo: number },
): { comissionavel: true } | { comissionavel: false; motivo: MotivoExclusao } {
  if (cobranca.comissionavelOverride === false) {
    return { comissionavel: false, motivo: "override_manual" };
  }
  if (cobranca.comissionavelOverride !== true) {
    if (cobranca.categoriaComissionavel === false) {
      return { comissionavel: false, motivo: "categoria_nao_comissionavel" };
    }
  }
  if (cobranca.valor < regra.valorMinimo) {
    return { comissionavel: false, motivo: "abaixo_minimo" };
  }
  return { comissionavel: true };
}

/** Soma um array com 2 casas de precisão para evitar drift de ponto flutuante. */
function somar(valores: number[]): number {
  const totalEmCentavos = valores.reduce(
    (acc, v) => acc + Math.round(v * 100),
    0,
  );
  return totalEmCentavos / 100;
}

/**
 * Encontra a faixa que "cobre" o valor base. Cumulativo: usa a primeira faixa
 * (em ordem crescente) cujo `limiteAte` ≥ valorBase. Se nenhuma cobrir
 * (valorBase > maior teto), usa a última faixa. Se a tabela estiver vazia,
 * retorna null.
 */
export function selecionarFaixa(
  faixas: FaixaComissao[],
  valorBase: number,
): { ordem: number; faixa: FaixaComissao } | null {
  if (faixas.length === 0) return null;

  const ordenadas = [...faixas].sort((a, b) => {
    const la = a.limiteAte ?? Infinity;
    const lb = b.limiteAte ?? Infinity;
    return la - lb;
  });

  for (let i = 0; i < ordenadas.length; i++) {
    const faixa = ordenadas[i];
    const teto = faixa.limiteAte ?? Infinity;
    if (valorBase <= teto) {
      return { ordem: i, faixa };
    }
  }
  // Fallback: valor maior que o teto da última faixa explícita.
  return { ordem: ordenadas.length - 1, faixa: ordenadas[ordenadas.length - 1] };
}

export function calcularComissao(
  cobrancas: CobrancaParaComissao[],
  regra: RegraComissao,
): ResultadoComissao {
  const comissionaveis: CobrancaParaComissao[] = [];
  const naoComissionaveis: ItemNaoComissionavel[] = [];

  for (const cobranca of cobrancas) {
    const veredito = classificarCobranca(cobranca, regra);
    if (veredito.comissionavel) {
      comissionaveis.push(cobranca);
    } else {
      naoComissionaveis.push({ cobranca, motivo: veredito.motivo });
    }
  }

  const bruto = somar(cobrancas.map((c) => c.valor));
  const comissionavel = somar(comissionaveis.map((c) => c.valor));
  const naoComissionavel = somar(
    naoComissionaveis.map((item) => item.cobranca.valor),
  );

  const modo = regra.modo ?? "flat";

  if (modo === "faixas" && regra.faixas && regra.faixas.length > 0) {
    const baseFaixa: BaseFaixa = regra.baseFaixa ?? "comissionavel";
    const valorBase = baseFaixa === "bruto" ? bruto : comissionavel;
    const sel = selecionarFaixa(regra.faixas, valorBase);
    if (sel) {
      // Comissão sempre incide sobre o comissionável — a faixa apenas decide a alíquota.
      const valorComissao =
        Math.round(comissionavel * sel.faixa.aliquotaPercent) / 100;
      return {
        comissionaveis,
        naoComissionaveis,
        totais: { bruto, comissionavel, naoComissionavel, valorComissao },
        aliquotaAplicada: sel.faixa.aliquotaPercent,
        faixaAplicada: {
          ordem: sel.ordem,
          limiteAte: sel.faixa.limiteAte,
          aliquotaPercent: sel.faixa.aliquotaPercent,
          valorBaseClassificacao: valorBase,
        },
      };
    }
    // Tabela vazia → cai pro flat com alíquota 0 (defensivo).
  }

  // Flat (default ou fallback).
  const aliquota = regra.aliquotaPercent;
  const valorComissao = Math.round(comissionavel * aliquota) / 100;
  return {
    comissionaveis,
    naoComissionaveis,
    totais: { bruto, comissionavel, naoComissionavel, valorComissao },
    aliquotaAplicada: aliquota,
  };
}
