/**
 * Tipos compartilhados — Módulo Previdenciário v2
 *
 * Legislação:
 * - EC 103/2019 (Reforma da Previdência)
 * - Lei 8.213/1991 (Plano de Benefícios)
 * - Lei 8.212/1991 (Custeio)
 * - Decreto 3.048/1999 (Regulamento)
 * - Art. 57-58 Lei 8.213/91 (Aposentadoria Especial)
 * - Art. 25 §2º EC 103 (Vedação conversão pós-reforma)
 * - STF Tema 709 (Vedação trabalho nocivo pós-aposentadoria especial)
 * - STJ Tema 534 (Rol de agentes nocivos é exemplificativo)
 */

// ─── Enums ──────────────────────────────────────────────────────────────────

export type Sexo = "M" | "F";

/**
 * Tipo de atividade exercida no período.
 * Determina qual regime de aposentadoria se aplica e se há conversão de tempo.
 */
export type TipoAtividade =
  | "URBANA_COMUM"           // CLT, autônomo, facultativo — regra geral
  | "URBANA_ESPECIAL_25"     // Insalubridade/periculosidade grau leve (25 anos)
  | "URBANA_ESPECIAL_20"     // Grau médio (20 anos) — minas afastadas, amianto
  | "URBANA_ESPECIAL_15"     // Grau alto (15 anos) — mineração subterrânea
  | "RURAL"                  // Trabalhador rural (segurado especial)
  | "PROFESSOR";             // Magistério educação básica (infantil, fundamental, médio)

export const TIPO_ATIVIDADE_LABELS: Record<TipoAtividade, string> = {
  URBANA_COMUM: "Urbana Comum (CLT, autônomo, facultativo)",
  URBANA_ESPECIAL_25: "Especial 25 anos (saúde, químicos, ruído, eletricidade)",
  URBANA_ESPECIAL_20: "Especial 20 anos (minas afastadas, amianto)",
  URBANA_ESPECIAL_15: "Especial 15 anos (mineração subterrânea)",
  RURAL: "Rural (agricultor familiar, pescador artesanal)",
  PROFESSOR: "Professor(a) educação básica",
};

export type CategoriaVinculo =
  | "CLT"
  | "CONTRIBUINTE_INDIVIDUAL"
  | "FACULTATIVO"
  | "MEI"
  | "EMPREGADO_DOMESTICO"
  | "AVULSO"
  | "SEGURADO_ESPECIAL";

export type PlanoContribuicao = "NORMAL" | "SIMPLIFICADO" | "MEI" | "BAIXA_RENDA";

export type RegraAposentadoria =
  | "PONTOS"                // art. 15 EC 103
  | "IDADE_PROGRESSIVA"     // art. 16 EC 103
  | "PEDAGIO_50"            // art. 17 EC 103
  | "IDADE_TRANSICAO"       // art. 18 EC 103
  | "PEDAGIO_100"           // art. 20 EC 103
  | "PERMANENTE"            // art. 201 CF pós-reforma
  | "ESPECIAL_TRANSICAO"    // art. 21 EC 103 (pontos especial)
  | "ESPECIAL_PERMANENTE"   // art. 201 §1º II CF (idade + TC especial)
  | "RURAL"                 // art. 201 §7º II CF
  | "DIREITO_ADQUIRIDO";   // completou requisitos antes de 13/11/2019

export const REGRA_LABELS: Record<RegraAposentadoria, string> = {
  PONTOS: "Pontos (art. 15, EC 103)",
  IDADE_PROGRESSIVA: "Idade Progressiva (art. 16, EC 103)",
  PEDAGIO_50: "Pedágio 50% (art. 17, EC 103)",
  IDADE_TRANSICAO: "Transição por Idade (art. 18, EC 103)",
  PEDAGIO_100: "Pedágio 100% (art. 20, EC 103)",
  PERMANENTE: "Regra Permanente (art. 201, CF)",
  ESPECIAL_TRANSICAO: "Especial — Transição por Pontos (art. 21, EC 103)",
  ESPECIAL_PERMANENTE: "Especial — Regra Permanente",
  RURAL: "Aposentadoria Rural (art. 201, §7º, CF)",
  DIREITO_ADQUIRIDO: "Direito Adquirido (pré-reforma)",
};

// ─── Constantes ─────────────────────────────────────────────────────────────

export const DATA_REFORMA = "2019-11-13";
export const SALARIO_MINIMO_2026 = 1621;
export const TETO_INSS_2026 = 8475.55;

export const ALIQUOTAS: Record<PlanoContribuicao, number> = {
  NORMAL: 20,
  SIMPLIFICADO: 11,
  MEI: 5,
  BAIXA_RENDA: 5,
};

/**
 * Fatores de conversão de tempo especial → comum.
 * Aplicável SOMENTE a períodos trabalhados ATÉ 13/11/2019 (art. 25 §2º EC 103).
 */
export const FATOR_CONVERSAO_ESPECIAL: Record<string, { homem: number; mulher: number }> = {
  URBANA_ESPECIAL_25: { homem: 1.4, mulher: 1.2 },
  URBANA_ESPECIAL_20: { homem: 1.75, mulher: 1.5 },
  URBANA_ESPECIAL_15: { homem: 2.33, mulher: 2.0 },
};

/**
 * Regras de aposentadoria especial por grau de risco.
 * Transição: pontos (idade + TC especial). Sobe 1 ponto/ano.
 * Permanente: idade mínima fixa + TC especial.
 */
export const ESPECIAL_REGRAS = {
  URBANA_ESPECIAL_15: {
    tcMinAnos: 15, idadeMinPermanente: 55,
    pontosBase2019: 66, pontosTeto: 89,
  },
  URBANA_ESPECIAL_20: {
    tcMinAnos: 20, idadeMinPermanente: 58,
    pontosBase2019: 76, pontosTeto: 93,
  },
  URBANA_ESPECIAL_25: {
    tcMinAnos: 25, idadeMinPermanente: 60,
    pontosBase2019: 86, pontosTeto: 99,
  },
};

// ─── Período de Contribuição ────────────────────────────────────────────────

/**
 * Cada período representa um vínculo ou intervalo de contribuição.
 * O sistema soma automaticamente, desconta sobreposições e gaps.
 */
export interface PeriodoContribuicao {
  id: string;                  // UUID gerado no frontend
  dataInicio: string;          // YYYY-MM-DD
  dataFim: string;             // YYYY-MM-DD (ou vazio se ainda ativo)
  tipoAtividade: TipoAtividade;
  categoriaVinculo: CategoriaVinculo;
  descricao?: string;          // ex: "Empresa X — Enfermeiro"
  aindaAtivo?: boolean;        // se está trabalhando neste vínculo atualmente
}

// ─── Parâmetros do Simulador ────────────────────────────────────────────────

export interface ParametrosSimulacao {
  sexo: Sexo;
  dataNascimento: string;
  periodos: PeriodoContribuicao[];
  continuaContribuindo?: boolean;
}

// ─── Resultado por Regra ────────────────────────────────────────────────────

export interface ResultadoRegra {
  regra: RegraAposentadoria;
  nomeRegra: string;
  aplicavel: boolean;           // se a regra se aplica ao perfil
  elegivel: boolean;
  dataPrevistaAposentadoria: string | null;
  mesesRestantes: number;

  idadeMinimaExigida: number | null;
  pontosExigidos: number | null;
  tcMinimoExigidoMeses: number;
  pedagioMeses?: number;

  idadeAtual: number;
  tcAtualMeses: number;
  pontosAtuais: number | null;

  coeficiente: number;
  detalhesCoeficiente: string;
  fundamentacao: string;
}

// ─── Resumo do TC calculado ─────────────────────────────────────────────────

export interface ResumoTC {
  totalMesesComum: number;
  totalMesesEspecial15: number;
  totalMesesEspecial20: number;
  totalMesesEspecial25: number;
  totalMesesRural: number;
  totalMesesProfessor: number;
  /** TC total com conversão especial→comum aplicada (para regras comuns) */
  totalMesesConvertido: number;
  /** Detalhes da conversão */
  conversoes: {
    tipoOriginal: TipoAtividade;
    mesesOriginais: number;
    fatorConversao: number;
    mesesConvertidos: number;
    periodo: string; // descrição
  }[];
  /** TC bruto (soma simples sem conversão) */
  totalMesesBruto: number;
}

// ─── Resultado da Simulação ─────────────────────────────────────────────────

export interface ResultadoSimulacao {
  resumoTC: ResumoTC;
  regras: ResultadoRegra[];
  melhorRegra: ResultadoRegra | null;
  regrasMaisProximas: ResultadoRegra[];
  parecerTecnico: string;
  protocoloCalculo: string;
  dataCalculo: string;
}

// ─── Cálculo do Valor do Benefício (RMI) ────────────────────────────────────

export interface ParametrosRMI {
  sexo: Sexo;
  dataNascimento: string;
  dataAposentadoria: string;
  tempoContribuicaoMeses: number;
  salariosContribuicao: number[];
  regraAplicavel: RegraAposentadoria;
  aplicarFatorPrevidenciario?: boolean;
}

export interface ResultadoRMI {
  mediaSalarios: number;
  quantidadeSalarios: number;
  coeficiente: number;
  detalhesCoeficiente: string;
  rmi: number;
  rmiLimitada: number;
  tetoINSS: number;
  pisoINSS: number;
  fatorPrevidenciario?: number;
  fundamentacao: string;
}

// ─── GPS em Atraso ──────────────────────────────────────────────────────────

export interface ParametrosGPS {
  categoria: "CONTRIBUINTE_INDIVIDUAL" | "FACULTATIVO" | "MEI";
  plano: PlanoContribuicao;
  salarioContribuicao: number;
  competenciasAtrasadas: string[];
  jaInscritoNoINSS: boolean;
  primeiraContribuicaoEmDia: boolean;
}

export interface LinhaGPS {
  competencia: string;
  valorOriginal: number;
  diasAtraso: number;
  jurosSELIC: number;
  multa: number;
  valorTotal: number;
  contaParaCarencia: boolean;
  contaParaTC: boolean;
}

export interface ResultadoGPS {
  linhas: LinhaGPS[];
  totalOriginal: number;
  totalJuros: number;
  totalMulta: number;
  totalAPagar: number;
  alertas: string[];
  fundamentacao: string;
}
