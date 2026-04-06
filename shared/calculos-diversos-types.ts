/**
 * Tipos compartilhados para o módulo Cálculos Diversos
 */

// ─── Conversão de Taxas ──────────────────────────────────────────────────────

export type PeriodoTaxa = "diaria" | "mensal" | "bimestral" | "trimestral" | "semestral" | "anual";
export type TipoTaxa = "efetiva" | "nominal";
export type BaseDias = "corridos" | "uteis"; // 365 ou 252

export interface ConversaoTaxaInput {
  taxaOriginal: number;       // em % (ex: 1.5 = 1.5%)
  periodoOrigem: PeriodoTaxa;
  periodoDestino: PeriodoTaxa;
  tipoOrigem: TipoTaxa;       // efetiva ou nominal
  tipoDestino: TipoTaxa;      // efetiva ou nominal
  baseDias: BaseDias;          // dias corridos (365) ou úteis (252)
  capitalizacaoNominal?: PeriodoTaxa; // período de capitalização se nominal
}

export interface ConversaoTaxaResult {
  taxaOriginal: number;
  taxaConvertida: number;
  periodoOrigem: PeriodoTaxa;
  periodoDestino: PeriodoTaxa;
  tipoOrigem: TipoTaxa;
  tipoDestino: TipoTaxa;
  formulaAplicada: string;
  detalhamento: string;
}

// ─── Taxa Real (Fisher) ─────────────────────────────────────────────────────

export interface TaxaRealInput {
  taxaNominal: number;   // % a.a.
  inflacao: number;      // % a.a.
}

export interface TaxaRealResult {
  taxaNominal: number;
  inflacao: number;
  taxaReal: number;
  formulaAplicada: string;
}

// ─── Juros Simples e Compostos ───────────────────────────────────────────────

export interface JurosInput {
  capital: number;
  taxa: number;          // % por período
  periodoTaxa: PeriodoTaxa;
  prazo: number;         // quantidade de períodos
  periodoPrazo: PeriodoTaxa;
  tipo: "simples" | "composto";
}

export interface JurosResult {
  capital: number;
  taxa: number;
  prazo: number;
  tipo: "simples" | "composto";
  juros: number;
  montante: number;
  formulaAplicada: string;
  evolucaoMensal: JurosEvolucao[];
}

export interface JurosEvolucao {
  periodo: number;
  saldoInicial: number;
  juros: number;
  saldoFinal: number;
}

// ─── Atualização Monetária ───────────────────────────────────────────────────

export type IndiceCorrecao = "IPCA" | "IGPM" | "INPC" | "IPCAE" | "SELIC" | "TR" | "CDI" | "POUPANCA";

export interface AtualizacaoMonetariaInput {
  valorOriginal: number;
  dataInicial: string;    // YYYY-MM-DD ou MM/YYYY
  dataFinal: string;      // YYYY-MM-DD ou MM/YYYY
  indice: IndiceCorrecao;
  aplicarJurosMora?: boolean;
  taxaJurosMoraAnual?: number; // % a.a. (padrão 1% a.m. = 12% a.a.)
  aplicarMulta?: boolean;
  percentualMulta?: number;    // % (padrão 2%)
}

export interface IndiceVariacao {
  data: string;           // MM/YYYY
  variacao: number;       // % no mês
  fatorAcumulado: number; // fator acumulado desde o início
}

export interface AtualizacaoMonetariaResult {
  valorOriginal: number;
  valorCorrigido: number;
  correcaoMonetaria: number;
  jurosMora: number;
  multa: number;
  valorTotal: number;
  indice: IndiceCorrecao;
  dataInicial: string;
  dataFinal: string;
  fatorCorrecao: number;
  variacaoPercentual: number;
  indices: IndiceVariacao[];
  detalhamento: string;
}

// ─── Prazo Prescricional ─────────────────────────────────────────────────────

export type AreaDireito = "civil" | "trabalhista" | "tributario" | "consumidor" | "penal";

export interface PrazoPrescricional {
  id: string;
  area: AreaDireito;
  prazoAnos: number;
  descricao: string;
  fundamentacao: string;
  observacao?: string;
}

export interface PrazoPrescricionalInput {
  area: AreaDireito;
  tipoAcao: string;       // ID do prazo selecionado
  dataFatoGerador: string; // YYYY-MM-DD
  suspensoes?: { inicio: string; fim: string }[];
}

export interface PrazoPrescricionalResult {
  prazo: PrazoPrescricional;
  dataFatoGerador: string;
  dataPrescricao: string;
  diasRestantes: number;
  prescrito: boolean;
  suspensoes: { inicio: string; fim: string; dias: number }[];
  totalDiasSuspensos: number;
  detalhamento: string;
}

// ─── Códigos SGS BCB ─────────────────────────────────────────────────────────

export const CODIGOS_SGS: Record<IndiceCorrecao, number> = {
  IPCA: 433,
  IGPM: 189,
  INPC: 188,
  IPCAE: 10764,
  SELIC: 432,    // Meta SELIC (% a.a.) - usamos 4390 para acumulado mensal
  TR: 226,
  CDI: 12,
  POUPANCA: 25,
};

// Códigos para variação mensal acumulada
export const CODIGOS_SGS_MENSAL: Record<IndiceCorrecao, number> = {
  IPCA: 433,
  IGPM: 189,
  INPC: 188,
  IPCAE: 10764,
  SELIC: 4390,   // SELIC acumulada no mês
  TR: 226,
  CDI: 4391,     // CDI acumulado no mês
  POUPANCA: 25,
};

export const NOMES_INDICES: Record<IndiceCorrecao, string> = {
  IPCA: "IPCA (IBGE)",
  IGPM: "IGP-M (FGV)",
  INPC: "INPC (IBGE)",
  IPCAE: "IPCA-E (IBGE)",
  SELIC: "Taxa SELIC",
  TR: "Taxa Referencial (TR)",
  CDI: "CDI",
  POUPANCA: "Poupança",
};
