/**
 * Tipos compartilhados para o Motor de Cálculo Trabalhista
 * 
 * Módulos:
 * 1. Rescisão Contratual (verbas rescisórias, FGTS, multa 40%)
 * 2. Horas Extras (cálculo detalhado com adicional noturno)
 * 3. Diferenças Salariais (equiparação, desvio de função)
 */

// ─── Tipos de Rescisão ────────────────────────────────────────────────────────

export type TipoRescisao =
  | "sem_justa_causa"           // Demissão sem justa causa (empregador)
  | "pedido_demissao"           // Pedido de demissão (empregado)
  | "justa_causa"               // Demissão por justa causa (empregador)
  | "rescisao_indireta"         // Rescisão indireta (culpa do empregador)
  | "acordo_mutuo"              // Acordo mútuo (art. 484-A CLT - Reforma 2017)
  | "termino_contrato";         // Término de contrato por prazo determinado

export type TipoContrato = "indeterminado" | "determinado" | "experiencia" | "intermitente";

// ─── Parâmetros de Entrada — Rescisão ─────────────────────────────────────────

export interface ParametrosRescisao {
  // Dados do contrato
  dataAdmissao: string;           // YYYY-MM-DD
  dataDesligamento: string;       // YYYY-MM-DD
  salarioBruto: number;           // Último salário bruto
  tipoRescisao: TipoRescisao;
  tipoContrato: TipoContrato;

  // Aviso prévio
  avisoPrevioTrabalhado: boolean;
  avisoPrevioIndenizado: boolean;

  // Férias
  feriasVencidas: boolean;        // Tem período de férias vencido?
  periodosFeriasVencidas?: number; // Quantos períodos vencidos (1 ou 2)

  // Dados adicionais
  mediaHorasExtras?: number;      // Média mensal de horas extras (valor R$)
  mediaComissoes?: number;        // Média mensal de comissões (valor R$)

  // FGTS
  saldoFGTS?: number;             // Saldo FGTS informado (se conhecido). Se vazio, será estimado.

  // Descontos
  adiantamentos?: number;         // Adiantamentos a descontar
}

// ─── Parâmetros de Entrada — Horas Extras ─────────────────────────────────────

export interface ParametrosHorasExtras {
  salarioBruto: number;
  cargaHorariaMensal: number;     // 220h (padrão CLT) ou 180h
  
  // Períodos de horas extras
  periodos: PeriodoHorasExtras[];
  
  // Adicional noturno
  incluirAdicionalNoturno: boolean;
  horasNoturnasMes?: number;      // Média de horas noturnas por mês
}

export interface PeriodoHorasExtras {
  mesAno: string;                 // YYYY-MM
  horasExtras50: number;          // Horas extras a 50%
  horasExtras100: number;         // Horas extras a 100% (domingos/feriados)
  horasNoturnas?: number;         // Horas noturnas no período
  salarioBase?: number;           // Salário base no período (se diferente)
}

// ─── Tabelas de INSS e IR ─────────────────────────────────────────────────────

export interface FaixaINSS {
  ate: number;
  aliquota: number;
}

export interface FaixaIR {
  ate: number;
  aliquota: number;
  deducao: number;
}

// Tabela INSS 2025 (vigente)
export const TABELA_INSS_2025: FaixaINSS[] = [
  { ate: 1518.00, aliquota: 7.5 },
  { ate: 2793.88, aliquota: 9 },
  { ate: 4190.83, aliquota: 12 },
  { ate: 8157.41, aliquota: 14 },
];

// Tabela IR 2025 (vigente)
export const TABELA_IR_2025: FaixaIR[] = [
  { ate: 2259.20, aliquota: 0, deducao: 0 },
  { ate: 2826.65, aliquota: 7.5, deducao: 169.44 },
  { ate: 3751.05, aliquota: 15, deducao: 381.44 },
  { ate: 4664.68, aliquota: 22.5, deducao: 662.77 },
  { ate: Infinity, aliquota: 27.5, deducao: 896.00 },
];

export const DEDUCAO_DEPENDENTE_IR = 189.59; // Por dependente

// ─── Resultados — Rescisão ────────────────────────────────────────────────────

export interface VerbaRescisoria {
  descricao: string;
  tipo: "provento" | "desconto";
  valor: number;
  fundamentoLegal: string;
  detalhes?: string;
}

export interface ResultadoRescisao {
  // Verbas detalhadas
  verbas: VerbaRescisoria[];
  
  // Totais
  totalProventos: number;
  totalDescontos: number;
  valorLiquido: number;
  
  // FGTS
  saldoFGTSEstimado: number;
  fgtsInformado: boolean;
  multaFGTS: number;              // 40% ou 20% (acordo mútuo)
  totalFGTS: number;              // Saldo + multa
  
  // Aviso prévio
  diasAvisoPrevio: number;        // 30 + 3 por ano trabalhado (max 90)
  valorAvisoPrevio: number;
  
  // Informações do cálculo
  tempoServico: {
    anos: number;
    meses: number;
    dias: number;
    totalDias: number;
  };
  
  // Descontos detalhados
  inss: number;
  irrf: number;
  
  // Protocolo
  protocoloCalculo: string;
}

// ─── Resultados — Horas Extras ────────────────────────────────────────────────

export interface ResultadoHorasExtras {
  valorHoraNormal: number;
  valorHoraExtra50: number;
  valorHoraExtra100: number;
  valorHoraNoturna: number;
  
  // Detalhamento por período
  detalhamentoPeriodos: DetalhePeriodoHE[];
  
  // Totais
  totalHorasExtras50: number;
  totalHorasExtras100: number;
  totalHorasNoturnas: number;
  totalValorHorasExtras: number;
  totalAdicionalNoturno: number;
  totalGeral: number;
  
  // Reflexos
  reflexos: ReflexoHorasExtras;
  
  // Total com reflexos
  totalComReflexos: number;
  
  protocoloCalculo: string;
}

export interface DetalhePeriodoHE {
  mesAno: string;
  salarioBase: number;
  valorHoraNormal: number;
  horasExtras50: number;
  valorExtras50: number;
  horasExtras100: number;
  valorExtras100: number;
  horasNoturnas: number;
  valorAdicionalNoturno: number;
  totalPeriodo: number;
}

export interface ReflexoHorasExtras {
  reflexoFerias: number;          // 1/12 por mês + 1/3
  reflexo13Salario: number;       // 1/12 por mês
  reflexoFGTS: number;            // 8% sobre total
  reflexoDSR: number;             // Descanso semanal remunerado
  totalReflexos: number;
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export const TIPO_RESCISAO_LABELS: Record<TipoRescisao, string> = {
  sem_justa_causa: "Demissão sem Justa Causa",
  pedido_demissao: "Pedido de Demissão",
  justa_causa: "Demissão por Justa Causa",
  rescisao_indireta: "Rescisão Indireta",
  acordo_mutuo: "Acordo Mútuo (art. 484-A CLT)",
  termino_contrato: "Término de Contrato Determinado",
};

export const TIPO_CONTRATO_LABELS: Record<TipoContrato, string> = {
  indeterminado: "Prazo Indeterminado",
  determinado: "Prazo Determinado",
  experiencia: "Experiência",
  intermitente: "Intermitente",
};
