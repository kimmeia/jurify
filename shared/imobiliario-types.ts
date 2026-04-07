/**
 * Tipos compartilhados para o Motor de Cálculo Imobiliário — Revisão de Financiamento Habitacional
 *
 * Fundamentação legal atualizada:
 * - Lei 8.692/1993, art. 25 (MP 2.197-43/2001): teto 12% a.a. no SFH
 * - Súmula 422/STJ: Lei 4.380/1964, art. 6º "e" NÃO limita juros remuneratórios
 * - Súmula 539/STJ: capitalização mensal permitida no SFN desde 31/03/2000
 * - Lei 11.977/2009 (art. 15-A da Lei 4.380/1964): capitalização mensal no SFH
 * - REsp 2.086.650/MG (STJ, 3ª Turma, fev/2025): SFI veda capitalização mensal
 * - Tema 572/STJ: Tabela Price é questão de fato (perícia necessária)
 * - Súmula 473/STJ: livre escolha de seguradora no SFH
 * - Lei 14.905/2024: capitalização permitida entre PJ com pactuação expressa
 * - Resolução CMN 5.255/2025: novo modelo SFH, teto R$ 2,25M
 */

// ─── Enums e Constantes ──────────────────────────────────────────────────────

export type SistemaAmortizacaoImob = "PRICE" | "SAC";

export type IndexadorCorrecao = "TR" | "IPCA" | "IGPM" | "IPC" | "POUPANCA" | "NENHUM";

export const INDEXADOR_LABELS: Record<IndexadorCorrecao, string> = {
  TR: "Taxa Referencial (TR)",
  IPCA: "IPCA (Índice de Preços ao Consumidor Amplo)",
  IGPM: "IGP-M (Índice Geral de Preços do Mercado)",
  IPC: "IPC (Índice de Preços ao Consumidor - FIPE)",
  POUPANCA: "Poupança (TR + rendimento)",
  NENHUM: "Sem correção monetária",
};

// ─── Tabela MIP por Faixa Etária ─────────────────────────────────────────────

export interface FaixaMIP {
  idadeMin: number;
  idadeMax: number;
  taxa: number;
}

export const TABELA_MIP_REFERENCIA: FaixaMIP[] = [
  { idadeMin: 18, idadeMax: 25, taxa: 0.022866 },
  { idadeMin: 26, idadeMax: 30, taxa: 0.029256 },
  { idadeMin: 31, idadeMax: 35, taxa: 0.028933 },
  { idadeMin: 36, idadeMax: 40, taxa: 0.030896 },
  { idadeMin: 41, idadeMax: 45, taxa: 0.032617 },
  { idadeMin: 46, idadeMax: 50, taxa: 0.034423 },
  { idadeMin: 51, idadeMax: 55, taxa: 0.037127 },
  { idadeMin: 56, idadeMax: 60, taxa: 0.039172 },
  { idadeMin: 61, idadeMax: 65, taxa: 0.040322 },
  { idadeMin: 66, idadeMax: 80, taxa: 0.043928 },
];

export const TAXA_DFI_REFERENCIA = 0.004684;

// ─── Enquadramento e Tipo de Credor ─────────────────────────────────────────

export type EnquadramentoImob = "SFH" | "SFI";

/**
 * Tipo de credor/originador:
 * - INSTITUICAO_SFN: Banco, caixa econômica (integra o SFN — MP 2.170-36/2001 se aplica)
 * - ENTIDADE_SFI: Opera no SFI mas NÃO integra o SFN (securitizadoras, fundos)
 * - INCORPORADORA: Financiamento direto por incorporadora/construtora/loteadora
 */
export type TipoCredor = "INSTITUICAO_SFN" | "ENTIDADE_SFI" | "INCORPORADORA";

export const TETO_SFH_VALOR_IMOVEL = 2_250_000;
export const TETO_SFH_TAXA_ANUAL = 12;
export const DATA_LEI_11977 = "2009-07-07";
export const DATA_LEI_14905 = "2024-08-30";

// ─── Parâmetros de Entrada ───────────────────────────────────────────────────

export interface ParametrosImobiliario {
  valorImovel: number;
  valorFinanciado: number;
  taxaJurosAnual: number;
  prazoMeses: number;
  dataContrato: string;
  dataPrimeiroVencimento: string;
  enquadramento?: EnquadramentoImob;
  tipoCredor?: TipoCredor;
  sistemaAmortizacao: SistemaAmortizacaoImob;
  indexador: IndexadorCorrecao;
  taxaIndexadorAnual: number;
  idadeComprador: number;
  taxaMIP?: number;
  taxaDFI?: number;
  seguroLivreEscolha?: boolean;
  taxaAdministracao?: number;
  parcelasJaPagas?: number;
  capitalizacaoExpressaPactuada?: boolean;
  taxaRecalculo?: "media_bacen" | "manual";
  taxaManualAnual?: number;
  indexadorRecalculo?: IndexadorCorrecao;
  taxaIndexadorRecalculoAnual?: number;
}

// ─── Linha do Demonstrativo ──────────────────────────────────────────────────

export interface LinhaImobiliario {
  parcela: number;
  dataVencimento: string;
  saldoDevedorAnterior: number;
  correcaoMonetaria: number;
  saldoDevedorCorrigido: number;
  amortizacao: number;
  juros: number;
  mip: number;
  dfi: number;
  taxaAdministracao: number;
  prestacaoTotal: number;
  saldoDevedorAtual: number;
}

// ─── Análise de Capitalização ───────────────────────────────────────────────

export interface AnaliseCapitalizacao {
  regime: "SFH_PRE_2009" | "SFH_POS_2009" | "SFI" | "INCORPORADORA_PRE_14905" | "INCORPORADORA_POS_14905";
  capitalizacaoMensalPermitida: boolean;
  usaPrice: boolean;
  expressamentePactuada: boolean;
  irregular: boolean;
  detalhes: string;
  fundamentacao: string;
}

// ─── Análise de Abusividade ──────────────────────────────────────────────────

export interface AnaliseAbusividadeImob {
  enquadramento: EnquadramentoImob;
  tipoCredor: TipoCredor;
  taxaContratadaAnual: number;
  taxaContratadaMensal: number;
  taxaMediaBACEN_anual: number;
  taxaMediaBACEN_mensal: number;
  taxaAbusiva: boolean;
  percentualAcimaDaMedia: number;
  violaTetoSFH: boolean;
  tetoSFH_anual: number;
  tetoSFH_fundamento: string;
  /** Teto STJ: 1,5× média BACEN (REsp 1.061.530/RS) */
  tetoSTJ_anual: number;
  tetoSTJ_mensal: number;
  abusivaSTJ: boolean;
  taxaMensalCalculada: number;
  taxaAnualCalculada: number;
  taxasEquivalentes: boolean;
  capitalizacao: AnaliseCapitalizacao;
  /** Indica se foi detectado anatocismo (capitalização composta de juros) — derivado da capitalização */
  anatocismoDetectado: boolean;
  /** Detalhes textuais sobre o anatocismo detectado (ou ausência dele) */
  anatocismoDetalhes: string;
  mipAbusivo: boolean;
  mipDetalhes: string;
  dfiAbusivo: boolean;
  dfiDetalhes: string;
  vendaCasadaSeguro: boolean;
  vendaCasadaDetalhes: string;
  taxaAdminAbusiva: boolean;
  taxaAdminDetalhes: string;
  indexadorIrregular: boolean;
  indexadorDetalhes: string;
  irregularidades: string[];
}

// ─── Resumo Comparativo ──────────────────────────────────────────────────────

export interface ResumoComparativoImob {
  valorFinanciado: number;
  valorImovel: number;
  totalPagoOriginal: number;
  totalJurosOriginal: number;
  totalAmortizacaoOriginal: number;
  totalMIPOriginal: number;
  totalDFIOriginal: number;
  totalTxAdminOriginal: number;
  totalCorrecaoOriginal: number;
  totalPagoRecalculado: number;
  totalJurosRecalculado: number;
  totalAmortizacaoRecalculado: number;
  totalMIPRecalculado: number;
  totalDFIRecalculado: number;
  totalTxAdminRecalculado: number;
  totalCorrecaoRecalculado: number;
  diferencaTotal: number;
  diferencaJuros: number;
  diferencaCorrecao: number;
  diferencaSeguros: number;
  repeticaoIndebito: number;
}

// ─── Dados de Recálculo com Parcelas Pagas ──────────────────────────────────

export interface DadosRecalculoImob {
  parcelasPagas: number;
  valorPagoTotal: number;
  valorDevidoRecalculado: number;
  valorPagoAMais: number;
  saldoDevedorAtualOriginal: number;
  saldoDevedorAtualRecalculado: number;
  parcelasRestantes: number;
}

// ─── Resultado Final ─────────────────────────────────────────────────────────

export interface ResultadoImobiliario {
  demonstrativoOriginal: LinhaImobiliario[];
  demonstrativoRecalculado: LinhaImobiliario[];
  resumo: ResumoComparativoImob;
  analiseAbusividade: AnaliseAbusividadeImob;
  parecerTecnico: string;
  protocoloCalculo: string;
  taxaRecalculoAplicada: number;
  criterioRecalculo: string;
  dadosParcelasPagas?: DadosRecalculoImob;
}
