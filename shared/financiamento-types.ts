/**
 * Tipos compartilhados para o Motor de Cálculo Bancário — Revisão de Financiamento
 * Usados tanto no frontend quanto no backend.
 *
 * v3 — Melhorias:
 * - Adicionado parcelasJaPagas nos parâmetros
 * - Adicionado dados de recálculo com parcelas pagas (saldo devedor atualizado)
 * - Adicionado campo seguroLivreEscolha
 * - Adicionado CET
 * - Adicionado repeticaoIndebito
 * - Adicionado anualAutoCalculada na verificação de taxas
 * - Adicionado anatocismoPactuadoPorSumula541
 * - Adicionado protocoloCalculo
 * - Adicionado dadosRecalculoGauss (parcelas já pagas integradas)
 */

// ─── Modalidades de Crédito ────────────────────────────────────────────────────

export type ModalidadeCredito =
  | "credito_pessoal"
  | "consignado"
  | "financiamento_veiculo"
  | "financiamento_imobiliario"
  | "cartao_credito"
  | "cheque_especial"
  | "capital_giro";

export type TipoPessoa = "fisica" | "juridica";

export type TipoVinculoConsignado = "clt" | "servidor_publico" | "militar";

export type SistemaAmortizacao = "PRICE" | "SAC" | "SACRE";

export type CriterioRecalculo = "media_bacen" | "teto_stj" | "manual";

// ─── Parâmetros de Entrada ─────────────────────────────────────────────────────

export interface TarifaAdicional {
  descricao: string;
  valor: number;
  financiada: boolean;
}

export interface Tarifas {
  tac?: number;
  tacFinanciada?: boolean;
  tec?: number;
  tecFinanciada?: boolean;
  iof?: number;
  iofFinanciado?: boolean;
  seguro?: number;
  seguroFinanciado?: boolean;
  seguroLivreEscolha?: boolean;
  avaliacaoBem?: number;
  avaliacaoBemFinanciada?: boolean;
  registroContrato?: number;
  registroContratoFinanciado?: boolean;
  outras?: TarifaAdicional[];
}

export interface ParametrosFinanciamento {
  // Dados do contrato
  valorFinanciado: number;
  taxaJurosMensal: number;
  taxaJurosAnual: number;
  quantidadeParcelas: number;
  valorParcela?: number;
  dataContrato: string;             // YYYY-MM-DD
  dataPrimeiroVencimento: string;   // YYYY-MM-DD

  // Parcelas já pagas (para recálculo com desconto)
  parcelasJaPagas?: number;

  // Sistema de amortização
  sistemaAmortizacao: SistemaAmortizacao;

  // Modalidade do crédito
  modalidadeCredito: ModalidadeCredito;

  // Tipo de pessoa (PF/PJ — altera série SGS para veículos)
  tipoPessoa?: TipoPessoa;

  // Tipo de vínculo (CLT/Servidor/INSS — altera série SGS para consignado)
  tipoVinculoConsignado?: TipoVinculoConsignado;

  // Tarifas e custos acessórios
  tarifas?: Tarifas;

  // Encargos de mora
  comissaoPermanencia?: number;
  multaMora?: number;
  jurosMora?: number;

  // Configurações do recálculo
  taxaRecalculo?: CriterioRecalculo;
  taxaManual?: number;

  // Flag para anatocismo expressamente pactuado
  anatocismoExpressoPactuado?: boolean;
}

// ─── Verificação de Equivalência de Taxas ─────────────────────────────────────

export interface VerificacaoTaxas {
  taxaMensalInformada: number;
  taxaAnualInformada: number;
  taxaAnualEquivalente: number;
  taxaMensalEquivalente: number;
  taxasEquivalentes: boolean;
  capitalizacaoDiaria: boolean;
  capitalizacaoDetalhes: string;
  anualAutoCalculada: boolean;
}

// ─── Verificação de Encargos de Mora ──────────────────────────────────────────

export interface VerificacaoEncargosMora {
  multaMoraInformada: number;
  multaMoraLegal: number;
  multaMoraAbusiva: boolean;
  jurosMoraInformados: number;
  jurosMoraLegal: number;
  jurosMoraAbusivos: boolean;
  comissaoPermanencia: number;
  comissaoPermanenciaCumulada: boolean;
  irregularidades: string[];
}

// ─── Linha do Demonstrativo ────────────────────────────────────────────────────

export interface LinhaFinanciamento {
  parcela: number;
  dataVencimento: string;
  saldoDevedorAnterior: number;
  juros: number;
  amortizacao: number;
  valorParcela: number;
  saldoDevedorAtual: number;
}

// ─── Tarifa Ilegal ─────────────────────────────────────────────────────────────

export interface TarifaIlegal {
  descricao: string;
  valor: number;
  fundamento: string;
}

// ─── Custo Efetivo Total ──────────────────────────────────────────────────────

export interface CustoEfetivoTotal {
  cetMensal: number;
  cetAnual: number;
  taxaNominalMensal: number;
  taxaNominalAnual: number;
  diferencaCET_vs_Nominal: number;
}

// ─── Dados do Recálculo com Parcelas Já Pagas ────────────────────────────────

export interface DadosRecalculoParcelasPagas {
  parcelasPagas: number;
  valorPagoTotal: number;              // Total pago pelo método Price
  valorDevidoGauss: number;            // Total que deveria ter pago pelo Gauss
  valorPagoAMais: number;              // Diferença (pago - devido)
  saldoDevedorLegal: number;           // Saldo devedor no demonstrativo Gauss na parcela atual
  saldoDevedorAtualizado: number;      // saldoDevedorLegal - valorPagoAMais
  parcelaFinalRecalculada: number;     // Nova parcela Gauss sobre o saldo atualizado
  parcelasRestantes: number;           // Parcelas que faltam
  taxaRecalculo: number;               // Taxa usada no recálculo (% a.m.)
}

// ─── Análise de Abusividade ────────────────────────────────────────────────────

export interface AnaliseAbusividade {
  taxaContratadaMensal: number;
  taxaContratadaAnual: number;
  taxaMediaBACEN_mensal: number;
  taxaMediaBACEN_anual: number;
  tetoSTJ_mensal: number;
  tetoSTJ_anual: number;
  taxaAbusiva: boolean;
  percentualAcimaDaMedia: number;

  // Teto legal específico (cheque especial, consignado INSS/servidor)
  tetoLegal_mensal?: number;
  tetoLegal_fundamento?: string;
  violaTetoLegal: boolean;

  // Cartão de crédito: juros acumulados > 100% do principal (Lei 14.690/2023)
  jurosAcumuladosExcedemPrincipal?: boolean;
  jurosAcumuladosPercent?: number;

  verificacaoTaxas: VerificacaoTaxas;

  anatocismoDetectado: boolean;
  anatocismoPermitido: boolean;
  anatocismoExpressoPactuado: boolean;
  anatocismoPactuadoPorSumula541: boolean;

  tarifasIlegais: TarifaIlegal[];
  totalTarifasFinanciadas: number;

  verificacaoEncargosMora: VerificacaoEncargosMora;

  cet: CustoEfetivoTotal;
}

// ─── Resumo Comparativo ────────────────────────────────────────────────────────

export interface ResumoComparativo {
  valorFinanciadoOriginal: number;
  valorFinanciadoLiquido: number;
  totalPagoOriginal: number;
  totalPagoRecalculado: number;
  diferencaTotal: number;
  totalJurosOriginal: number;
  totalJurosRecalculado: number;
  diferencaJuros: number;
  tarifasIlegais: number;
  tarifasFinanciadas: number;
  encargosAbusivos: number;
  repeticaoIndebito: number;
}

// ─── Verificação de Parcela Declarada ─────────────────────────────────────────

export interface VerificacaoParcela {
  parcelaDeclarada: number;
  parcelaCalculada: number;
  diferenca: number;
  percentualDiferenca: number;
  compativel: boolean;
  observacao: string;
}

// ─── Comparativo 4 Cenários ──────────────────────────────────────────────────

export interface ComparativoCenario {
  descricao: string;
  valorFinanciado: number;
  taxaMensal: number;
  taxaAnual: number;
  valorParcela: number;
  totalPago: number;
  capitalizado: boolean;
  fonteTaxa: "contrato" | "bacen";
}

// ─── Resultado Final ───────────────────────────────────────────────────────────

export interface ResultadoFinanciamento {
  demonstrativoOriginal: LinhaFinanciamento[];
  demonstrativoRecalculado: LinhaFinanciamento[];
  resumo: ResumoComparativo;
  analiseAbusividade: AnaliseAbusividade;
  parecerTecnico: string;
  taxaRecalculoAplicada: number;
  criterioRecalculo: string;
  protocoloCalculo: string;
  dadosParcelasPagas?: DadosRecalculoParcelasPagas;
  verificacaoParcela?: VerificacaoParcela;
  comparativo4Cenarios?: ComparativoCenario[];
}

// ─── Mapeamento de Séries SGS do BACEN ─────────────────────────────────────────

export const MODALIDADE_SGS_MAP: Record<ModalidadeCredito, number> = {
  credito_pessoal: 20742,
  consignado: 20745,
  financiamento_veiculo: 20749,       // PF (padrão)
  financiamento_imobiliario: 20773,
  cartao_credito: 25351,
  cheque_especial: 20747,
  capital_giro: 20714,
};

/** Séries SGS específicas para Pessoa Jurídica (quando difere de PF) */
export const MODALIDADE_SGS_MAP_PJ: Partial<Record<ModalidadeCredito, number>> = {
  financiamento_veiculo: 20728,       // PJ: série 20728 (diferente de PF 20749)
};

/** Séries SGS específicas por vínculo de consignado */
export const CONSIGNADO_SGS_MAP: Record<TipoVinculoConsignado, number> = {
  clt: 20744,                         // Setor privado (CLT)
  servidor_publico: 25467,            // Servidores públicos
  militar: 25467,                     // Militares (mesma série do servidor público)
};

/** Retorna o código SGS correto conforme modalidade, tipo de pessoa e vínculo consignado */
export function getCodigoSgs(
  modalidade: ModalidadeCredito,
  tipoPessoa?: TipoPessoa,
  tipoVinculoConsignado?: TipoVinculoConsignado,
): number {
  // Consignado: usa série específica por vínculo
  if (modalidade === "consignado" && tipoVinculoConsignado) {
    return CONSIGNADO_SGS_MAP[tipoVinculoConsignado];
  }
  // Veículos: PJ usa série diferente
  if (tipoPessoa === "juridica" && MODALIDADE_SGS_MAP_PJ[modalidade]) {
    return MODALIDADE_SGS_MAP_PJ[modalidade]!;
  }
  return MODALIDADE_SGS_MAP[modalidade];
}

export const MODALIDADE_LABELS: Record<ModalidadeCredito, string> = {
  credito_pessoal: "Crédito Pessoal",
  consignado: "Crédito Consignado",
  financiamento_veiculo: "Financiamento de Veículos",
  financiamento_imobiliario: "Financiamento Imobiliário",
  cartao_credito: "Cartão de Crédito",
  cheque_especial: "Cheque Especial",
  capital_giro: "Capital de Giro",
};
