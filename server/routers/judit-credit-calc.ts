/**
 * Funções puras de cálculo de créditos para consultas Judit.
 *
 * Isolado num arquivo próprio pra ser 100% testável sem precisar
 * de DB, mocks ou banco de teste. Toda regra de precificação vive
 * aqui — se precisar ajustar os valores, mude em um lugar só.
 */

export const CUSTOS_JUDIT = {
  /** Consulta direta por CNJ — resultado único garantido */
  consulta_cnj: 1,
  /** Custo BASE da busca histórica (sempre cobrado, mesmo sem resultado) */
  consulta_historica_base: 3,
  /** Custo adicional por processo retornado na busca histórica */
  consulta_historica_por_processo: 1,
  /** Teto máximo de créditos por busca histórica (evita sticker shock) */
  consulta_historica_max: 100,
  consulta_sintetica: 2,
  monitorar_processo: 5,
  monitorar_pessoa: 50,
  resumo_ia: 1,
  anexos: 10,
} as const;

/**
 * Calcula o custo TOTAL de uma consulta histórica baseado no número
 * de processos encontrados.
 *
 * Fórmula:
 *   total = base + (processos × porProcesso)
 *
 * Mas com teto:
 *   total <= max
 *
 * E piso:
 *   total >= base (sempre paga ao menos o base)
 *
 * @param totalProcessos quantos processos foram retornados
 * @returns custo total em créditos
 */
export function calcularCustoConsultaHistorica(totalProcessos: number): number {
  const base = CUSTOS_JUDIT.consulta_historica_base;
  const porProcesso = CUSTOS_JUDIT.consulta_historica_por_processo;
  const max = CUSTOS_JUDIT.consulta_historica_max;

  if (totalProcessos < 0) return base;
  if (!Number.isFinite(totalProcessos)) return base;

  const bruto = base + Math.floor(totalProcessos) * porProcesso;
  return Math.min(bruto, max);
}

/**
 * Calcula o custo EXTRA (só a parte variável) da consulta histórica,
 * dado que o base já foi cobrado upfront.
 *
 * Usado em `resultados` pra cobrar só a diferença depois que a
 * consulta retornou.
 */
export function calcularCustoExtraConsultaHistorica(totalProcessos: number): number {
  const total = calcularCustoConsultaHistorica(totalProcessos);
  const base = CUSTOS_JUDIT.consulta_historica_base;
  return Math.max(0, total - base);
}

/**
 * Estima o custo de uma consulta antes de executar — usado pra
 * mostrar warning no UI. Como não sabemos quantos processos virão,
 * damos uma estimativa conservadora baseada em casos típicos.
 *
 * @param tipo tipo da busca
 * @returns texto legível com estimativa de custo
 */
export function estimarCustoConsulta(
  tipo: "cpf" | "cnpj" | "oab" | "name" | "lawsuit_cnj",
): {
  min: number;
  max: number;
  tipico: number;
  mensagem: string;
} {
  if (tipo === "lawsuit_cnj") {
    return {
      min: CUSTOS_JUDIT.consulta_cnj,
      max: CUSTOS_JUDIT.consulta_cnj,
      tipico: CUSTOS_JUDIT.consulta_cnj,
      mensagem: `${CUSTOS_JUDIT.consulta_cnj} crédito — consulta direta por CNJ.`,
    };
  }

  const base = CUSTOS_JUDIT.consulta_historica_base;
  const max = CUSTOS_JUDIT.consulta_historica_max;
  // Estimativa "típica" varia por tipo de busca
  const tipicoProcessos: Record<string, number> = {
    cpf: 3, // cliente pessoa física tem poucos processos em geral
    cnpj: 10, // empresas normalmente têm mais
    oab: 30, // advogados podem ter muitos
    name: 8, // nomes podem dar falsos positivos
  };
  const tipicoCount = tipicoProcessos[tipo] || 5;
  const tipico = calcularCustoConsultaHistorica(tipicoCount);

  return {
    min: base,
    max,
    tipico,
    mensagem: `${base} crédito(s) base + 1 crédito por processo encontrado (teto ${max}). Estimativa típica: ~${tipico} créditos.`,
  };
}
