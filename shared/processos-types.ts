/**
 * Tipos compartilhados para o módulo de Monitoramento de Processos.
 * 
 * SEGURANÇA: Todos os dados são isolados por userId.
 * Nenhuma query deve retornar processos de outro utilizador.
 */

/** Justiças brasileiras (dígito J do número CNJ) */
export type JusticaType =
  | "STF"       // 1
  | "CNJ"       // 2
  | "STJ"       // 3
  | "Federal"   // 4
  | "Trabalho"  // 5
  | "Eleitoral" // 6
  | "Militar"   // 7
  | "Estadual"  // 8
  | "MilitarEstadual"; // 9

/** Status do monitoramento */
export type MonitoramentoStatus = "ativo" | "pausado" | "arquivado";

/** Movimentação processual retornada pela API DataJud */
export interface MovimentacaoProcessual {
  codigo: number;
  nome: string;
  dataHora: string; // ISO date
  complementos?: Array<{
    codigo: number;
    valor: number;
    nome: string;
    descricao: string;
  }>;
  /** Campo retornado pela API DataJud (nome diferente de 'complementos') */
  complementosTabelados?: Array<{
    codigo: number;
    valor: number;
    nome: string;
    descricao: string;
  }>;
}

/** Dados do processo retornados pela API DataJud */
export interface DadosProcessoDataJud {
  numeroProcesso: string;
  classe: { codigo: number; nome: string };
  tribunal: string;
  grau: string;
  dataAjuizamento: string;
  dataHoraUltimaAtualizacao: string;
  nivelSigilo: number;
  orgaoJulgador: {
    codigo: number;
    nome: string;
    codigoMunicipioIBGE?: number;
  };
  assuntos: Array<{ codigo: number; nome: string }>;
  movimentos: MovimentacaoProcessual[];
  sistema?: { codigo: number; nome: string };
  formato?: { codigo: number; nome: string };
}

/** Processo monitorado (dados armazenados localmente) */
export interface ProcessoMonitorado {
  id: number;
  numeroCnj: string;         // Formato: NNNNNNN-DD.AAAA.J.TR.OOOO
  tribunal: string;           // Ex: "TJSP", "TRF1", "TRT2"
  aliasApi: string;           // Ex: "api_publica_tjsp"
  classe: string;             // Ex: "Procedimento Comum Cível"
  assuntos: string;           // JSON array de assuntos
  orgaoJulgador: string;      // Ex: "1ª Vara Cível de São Paulo"
  dataAjuizamento: string | null;
  grau: string;               // Ex: "G1", "G2", "JE"
  ultimaAtualizacao: string | null;
  totalMovimentacoes: number;
  ultimaMovimentacao: string | null; // Nome da última movimentação
  ultimaMovimentacaoData: string | null; // Data da última movimentação
  status: MonitoramentoStatus;
  apelido: string | null;     // Nome amigável dado pelo utilizador
  createdAt: string;
  updatedAt: string;
}

/** Input para adicionar processo ao monitoramento */
export interface AdicionarProcessoInput {
  numeroCnj: string;
  apelido?: string;
}

/** Resultado da consulta à API DataJud */
export interface ConsultaDataJudResult {
  success: boolean;
  processo?: DadosProcessoDataJud;
  error?: string;
}

/** Mapeamento do dígito de justiça para aliases de tribunal */
export const JUSTICA_DIGITO_MAP: Record<string, JusticaType> = {
  "1": "STF",
  "2": "CNJ",
  "3": "STJ",
  "4": "Federal",
  "5": "Trabalho",
  "6": "Eleitoral",
  "7": "Militar",
  "8": "Estadual",
  "9": "MilitarEstadual",
};

/**
 * Mapeamento de tribunal (dígito TR do número CNJ) para alias da API DataJud.
 * O dígito J determina a justiça e o TR determina o tribunal específico.
 */
export const TRIBUNAL_ALIAS_MAP: Record<string, Record<string, string>> = {
  // Justiça Federal (J=4)
  "4": {
    "01": "trf1", "02": "trf2", "03": "trf3", "04": "trf4", "05": "trf5", "06": "trf6",
  },
  // Justiça do Trabalho (J=5)
  "5": {
    "01": "trt1", "02": "trt2", "03": "trt3", "04": "trt4", "05": "trt5",
    "06": "trt6", "07": "trt7", "08": "trt8", "09": "trt9", "10": "trt10",
    "11": "trt11", "12": "trt12", "13": "trt13", "14": "trt14", "15": "trt15",
    "16": "trt16", "17": "trt17", "18": "trt18", "19": "trt19", "20": "trt20",
    "21": "trt21", "22": "trt22", "23": "trt23", "24": "trt24",
  },
  // Justiça Estadual (J=8)
  "8": {
    "01": "tjac", "02": "tjal", "03": "tjap", "04": "tjam", "05": "tjba",
    "06": "tjce", "07": "tjdft", "08": "tjes", "09": "tjgo", "10": "tjma",
    "11": "tjmg", "12": "tjms", "13": "tjmt", "14": "tjpa", "15": "tjpb",
    "16": "tjpe", "17": "tjpi", "18": "tjpr", "19": "tjrj", "20": "tjrn",
    "21": "tjro", "22": "tjrr", "23": "tjrs", "24": "tjsc", "25": "tjse",
    "26": "tjsp", "27": "tjto",
  },
  // Justiça Eleitoral (J=6)
  "6": {
    "01": "tre-ac", "02": "tre-al", "03": "tre-ap", "04": "tre-am", "05": "tre-ba",
    "06": "tre-ce", "07": "tre-df", "08": "tre-es", "09": "tre-go", "10": "tre-ma",
    "11": "tre-mg", "12": "tre-ms", "13": "tre-mt", "14": "tre-pa", "15": "tre-pb",
    "16": "tre-pe", "17": "tre-pi", "18": "tre-pr", "19": "tre-rj", "20": "tre-rn",
    "21": "tre-ro", "22": "tre-rr", "23": "tre-rs", "24": "tre-sc", "25": "tre-se",
    "26": "tre-sp", "27": "tre-to",
  },
  // Justiça Militar Estadual (J=9)
  "9": {
    "13": "tjm-mg", "21": "tjm-rs", "26": "tjm-sp",
  },
  // Superiores
  "1": { "00": "stf" },
  "2": { "00": "cnj" },
  "3": { "00": "stj" },
  "7": { "00": "stm" },
};

/**
 * Extrai o alias do tribunal a partir do número CNJ.
 * Formato CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO
 * @returns alias para a API DataJud ou null se não encontrado
 */
export function extrairTribunalAlias(numeroCnj: string): string | null {
  // Remove formatação: pontos e hífens
  const limpo = numeroCnj.replace(/[.\-]/g, "");
  if (limpo.length !== 20) return null;

  // Posições no número limpo (NNNNNNNDDAAAAJTROOOO):
  // N: 0-6, D: 7-8, A: 9-12, J: 13, TR: 14-15, O: 16-19
  const justica = limpo[13];
  const tribunal = limpo.substring(14, 16);

  const tribunalMap = TRIBUNAL_ALIAS_MAP[justica];
  if (!tribunalMap) return null;

  return tribunalMap[tribunal] || null;
}

/**
 * Formata número de processo para o padrão CNJ.
 * Input: 20 dígitos sem formatação
 * Output: NNNNNNN-DD.AAAA.J.TR.OOOO
 */
export function formatarNumeroCnj(numero: string): string {
  const limpo = numero.replace(/\D/g, "");
  if (limpo.length !== 20) return numero;
  return `${limpo.slice(0, 7)}-${limpo.slice(7, 9)}.${limpo.slice(9, 13)}.${limpo.slice(13, 14)}.${limpo.slice(14, 16)}.${limpo.slice(16, 20)}`;
}

/**
 * Valida se um número CNJ tem formato válido.
 */
export function validarNumeroCnj(numeroCnj: string): boolean {
  const limpo = numeroCnj.replace(/[.\-\s]/g, "");
  if (limpo.length !== 20) return false;
  if (!/^\d{20}$/.test(limpo)) return false;

  const justica = limpo[13];
  if (!TRIBUNAL_ALIAS_MAP[justica]) return false;

  return true;
}
