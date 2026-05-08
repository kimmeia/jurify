/**
 * Funções puras de cálculo de créditos para consultas Judit.
 *
 * Isolado num arquivo próprio pra ser 100% testável sem precisar
 * de DB, mocks ou banco de teste. Toda regra de precificação vive
 * aqui — se precisar ajustar os valores, mude em um lugar só.
 *
 * ═══════════════════════════════════════════════════════════════════
 * MODELO DE COBRANÇA — calibrado com a tabela oficial da Judit
 * (plano R$5k/mês da Judit como base de custo)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Valor do crédito: ~R$0,75 (pacote 200 créditos = R$149)
 *
 * Preços Judit plano R$5k (referência pra cálculo de margem):
 *   - Consulta CNJ (movimentações):           R$0,17/consulta
 *   - Consulta histórica Data Lake:           R$1,02/1000 processos
 *   - Consulta histórica On Demand:           R$4,08/1000 processos
 *   - Monitoramento processual:               R$1,02/mês por processo
 *   - Monitoramento de novas ações:           R$12,50/mês + R$0,25/novo
 *   - Autos processuais (anexos):             R$2,38/mês
 *   - Mandado de prisão:                      R$0,68/consulta
 *   - Execução criminal:                      R$0,34/consulta
 *   - Resumo IA processo:                     R$0,07/consulta
 *   - Resumo IA entidade:                     R$0,10/consulta
 *
 * Nossa cobrança (créditos):
 *
 *   Consulta CNJ          1 cr  (R$0,75)  → Judit R$0,17  → margem 4,4x
 *   Consulta histórica    3 cr  base      → Judit R$0,17  → margem 13x
 *     + por lote 10 proc  1 cr            → Judit ~R$0,04 (10 On Dem) → 18x
 *   Monitorar proc/mês    5 cr  (R$3,75)  → Judit R$1,02  → margem 3,7x
 *   Monitorar pessoa/mês  35 cr (R$26,25) → Judit R$12,50 → margem 2,1x
 *   Anexos/mês            10 cr (R$7,50)  → Judit R$2,38  → margem 3,2x
 *   Mandado de prisão     3 cr  (R$2,25)  → Judit R$0,68  → margem 3,3x
 *   Execução criminal     2 cr  (R$1,50)  → Judit R$0,34  → margem 4,4x
 *   Resumo IA processo    1 cr  (R$0,75)  → Judit R$0,07  → margem 10x
 *
 * Princípio: usou, pagou. SEM cap artificial — o escritório paga
 * pelo consumo real + nossa margem comercial. Monitoramentos são
 * COBRADOS MENSALMENTE via cron (cron-jobs.ts).
 */

export const CUSTOS_JUDIT = {
  /** Consulta direta por CNJ — R$0,17 Judit → 1 cred (R$0,75) margem 4,4x */
  consulta_cnj: 1,
  /** Base da busca histórica — cobra sempre, até quando não retorna nada */
  consulta_historica_base: 3,
  /**
   * Custo adicional POR LOTE DE 10 PROCESSOS retornados na busca histórica.
   * A Judit cobra ~R$0,04 por 10 processos (On Demand). Cobramos 1 crédito
   * (R$0,75) por lote → margem ~18x. Mais granular que "por processo"
   * e evita cobrança de frações de crédito.
   */
  consulta_historica_por_lote_10: 1,
  /** Consulta sintetica (contador de processos) */
  consulta_sintetica: 2,
  /**
   * Monitoramento de PROCESSO (por CNJ) — cobrado mensalmente via cron.
   * Judit cobra R$1,02/mês → 5 créditos (R$3,75) → margem 3,7x.
   */
  monitorar_processo_mes: 5,
  /**
   * Monitoramento de PESSOA/EMPRESA (novas ações) — cobrado mensalmente.
   * Judit cobra R$12,50/mês + R$0,25 por novo processo capturado.
   * Cobramos 35 créditos/mês (R$26,25) → margem 2,1x no fixo.
   * O custo variável por novo processo capturado é absorvido na margem.
   */
  monitorar_pessoa_mes: 35,
  /** Download de anexos (mensal) — R$2,38 Judit → 10 cred (R$7,50) margem 3,2x */
  anexos_mes: 10,
  /** Mandado de prisão — R$0,68 Judit → 3 cred (R$2,25) margem 3,3x */
  mandado_prisao: 3,
  /** Execução criminal — R$0,34 Judit → 2 cred (R$1,50) margem 4,4x */
  execucao_criminal: 2,
  /** Dados cadastrais Receita Federal — R$0,08 Judit → 1 cred margem 9,4x */
  dados_cadastrais: 1,
  /** Resumo IA — R$0,07 Judit → 1 cred (R$0,75) margem 10x */
  resumo_ia: 1,
} as const;

/**
 * Calcula o custo TOTAL de uma consulta histórica baseado no número
 * de processos encontrados.
 *
 * Fórmula: usou, pagou. Com cobrança em LOTES de 10 processos pra
 * ter granularidade razoável sem fracionar créditos.
 *
 *   total = base + ceil(processos / 10) × por_lote_10
 *
 * Exemplos:
 *   0 processos  → 3 + ceil(0/10)×1  = 3 + 0 = 3
 *   1 processo   → 3 + ceil(1/10)×1  = 3 + 1 = 4
 *   10 processos → 3 + ceil(10/10)×1 = 3 + 1 = 4
 *   11 processos → 3 + ceil(11/10)×1 = 3 + 2 = 5
 *   50 processos → 3 + ceil(50/10)×1 = 3 + 5 = 8
 *   500 processos → 3 + ceil(500/10)×1 = 3 + 50 = 53
 *
 * Piso: total >= base (sempre paga ao menos o base, mesmo se 0 resultados)
 * Sem teto máximo: pagamos a Judit pelo uso real, repassamos com margem.
 *
 * @param totalProcessos quantos processos foram retornados
 * @returns custo total em créditos
 */
export function calcularCustoConsultaHistorica(totalProcessos: number): number {
  const base = CUSTOS_JUDIT.consulta_historica_base;
  const porLote = CUSTOS_JUDIT.consulta_historica_por_lote_10;

  if (totalProcessos < 0) return base;
  if (!Number.isFinite(totalProcessos)) return base;

  const lotes = Math.ceil(Math.floor(totalProcessos) / 10);
  return base + lotes * porLote;
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
 * Calcula o custo mensal de manter N monitoramentos ativos.
 * Usado pelo cron mensal de cobrança recorrente.
 *
 * @param processosAtivos quantos monitoramentos tipo "movimentacoes"
 * @param pessoasAtivas quantos monitoramentos tipo "novas_acoes"
 * @returns custo mensal em créditos
 */
export function calcularCustoMensalMonitoramentos(
  processosAtivos: number,
  pessoasAtivas: number,
): number {
  return (
    Math.max(0, Math.floor(processosAtivos)) * CUSTOS_JUDIT.monitorar_processo_mes +
    Math.max(0, Math.floor(pessoasAtivas)) * CUSTOS_JUDIT.monitorar_pessoa_mes
  );
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
  tipico: number;
  mensagem: string;
} {
  if (tipo === "lawsuit_cnj") {
    return {
      min: CUSTOS_JUDIT.consulta_cnj,
      tipico: CUSTOS_JUDIT.consulta_cnj,
      mensagem: `${CUSTOS_JUDIT.consulta_cnj} crédito — consulta direta por CNJ.`,
    };
  }

  const base = CUSTOS_JUDIT.consulta_historica_base;
  const porLote = CUSTOS_JUDIT.consulta_historica_por_lote_10;
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
    tipico,
    mensagem: `${base} créditos base + ${porLote} crédito por lote de 10 processos. Estimativa típica: ~${tipico} créditos (para ~${tipicoCount} processos).`,
  };
}
