/**
 * Cálculo de comissão de atendentes — helper puro.
 *
 * Modelo flat: uma única alíquota global do escritório aplicada sobre o total
 * comissionável. Elegibilidade resolve numa cascata:
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

export interface RegraComissao {
  aliquotaPercent: number;
  /** Cobranças com valor estritamente abaixo deste piso são excluídas. */
  valorMinimo: number;
}

export interface ItemNaoComissionavel {
  cobranca: CobrancaParaComissao;
  motivo: MotivoExclusao;
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
}

/**
 * Decide se uma cobrança específica entra na comissão.
 * Exposto separadamente para uso em UI (preview por linha) e testes.
 */
export function classificarCobranca(
  cobranca: CobrancaParaComissao,
  regra: RegraComissao,
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
  const valorComissao =
    Math.round(comissionavel * regra.aliquotaPercent) / 100;

  return {
    comissionaveis,
    naoComissionaveis,
    totais: { bruto, comissionavel, naoComissionavel, valorComissao },
  };
}
