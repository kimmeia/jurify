/**
 * Tipos compartilhados — Módulo Escritório, Colaboradores e Configurações
 * Fase 1: Fundação organizacional do CRM
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type CargoColaborador = "dono" | "gestor" | "atendente" | "estagiario" | "sdr";
export type StatusConvite = "pendente" | "aceito" | "expirado" | "cancelado";
export type PlanoAtendimento = "basico" | "intermediario" | "completo";

export const CARGO_LABELS: Record<CargoColaborador, string> = {
  dono: "Dono",
  gestor: "Gestor",
  atendente: "Atendente",
  estagiario: "Estagiário",
  sdr: "SDR",
};

export const CARGO_DESCRICAO: Record<CargoColaborador, string> = {
  dono: "Acesso total ao escritório, equipe e configurações",
  gestor: "Gerencia equipe, reatribui conversas, acessa relatórios",
  atendente: "Atende clientes, gerencia seus leads e conversas",
  estagiario: "Atende clientes sob supervisão, acesso limitado",
  sdr: "Sales Development Representative — qualifica leads, gerencia pipeline próprio, acessa relatórios próprios",
};

export const PLANO_LABELS: Record<PlanoAtendimento, string> = {
  basico: "Básico",
  intermediario: "Intermediário",
  completo: "Completo",
};

export const PLANO_LIMITES: Record<PlanoAtendimento, { maxColaboradores: number; maxConexoesWhatsapp: number; canaisExtras: boolean }> = {
  basico: { maxColaboradores: 1, maxConexoesWhatsapp: 0, canaisExtras: false },
  intermediario: { maxColaboradores: 3, maxConexoesWhatsapp: 1, canaisExtras: true },
  completo: { maxColaboradores: 5, maxConexoesWhatsapp: 3, canaisExtras: true },
};

/** Custo por colaborador extra acima do limite do plano */
export const CUSTO_COLABORADOR_EXTRA = 9.90;

// ─── Fusos horários ───────────────────────────────────────────────────────────

/**
 * Fusos horários oficiais brasileiros (IANA). O `fusoHorario` do escritório
 * é usado nos cálculos de agendamento do SmartFlow (slots de horário dos
 * gatilhos Asaas, lembretes Cal.com). Se o SaaS for aberto a outros países
 * no futuro, basta acrescentar entradas aqui.
 *
 * Mantemos 4 zonas oficiais do Brasil — 1 `timeZone` por UTC offset:
 *   - UTC-2: Fernando de Noronha
 *   - UTC-3: Brasília e maior parte dos estados
 *   - UTC-4: Mato Grosso, Mato Grosso do Sul, Rondônia, Roraima, Amazonas
 *   - UTC-5: Acre, partes do Amazonas
 *
 * Sempre apresentado em ordem decrescente de população (Brasília primeiro).
 */
export const FUSOS_HORARIOS: Array<{ valor: string; label: string; utc: string }> = [
  { valor: "America/Sao_Paulo", label: "Brasília e maior parte do Brasil", utc: "UTC-3" },
  { valor: "America/Manaus", label: "Mato Grosso, MS, RO, RR, AM", utc: "UTC-4" },
  { valor: "America/Rio_Branco", label: "Acre e oeste do Amazonas", utc: "UTC-5" },
  { valor: "America/Noronha", label: "Fernando de Noronha", utc: "UTC-2" },
];

/** Conjunto de fusos válidos (lookup O(1)). */
export const FUSOS_HORARIOS_VALIDOS = new Set(FUSOS_HORARIOS.map((f) => f.valor));

/** Fuso padrão quando o escritório não define explicitamente. */
export const FUSO_HORARIO_PADRAO = "America/Sao_Paulo";

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface EscritorioInfo {
  id: number;
  nome: string;
  cnpj?: string;
  telefone?: string;
  email?: string;
  endereco?: string;
  logoUrl?: string;
  fusoHorario: string;
  horarioAbertura: string;
  horarioFechamento: string;
  diasFuncionamento: string[];
  mensagemAusencia?: string;
  mensagemBoasVindas?: string;
  planoAtendimento: PlanoAtendimento;
  maxColaboradores: number;
  maxConexoesWhatsapp: number;
  ownerId: number;
  createdAt: string;
}

export interface ColaboradorInfo {
  id: number;
  escritorioId: number;
  userId: number;
  userName?: string;
  userEmail?: string;
  cargo: CargoColaborador;
  departamento?: string;
  ativo: boolean;
  maxAtendimentosSimultaneos: number;
  recebeLeadsAutomaticos: boolean;
  createdAt: string;
}

export interface ConviteInfo {
  id: number;
  escritorioId: number;
  email: string;
  cargo: CargoColaborador;
  departamento?: string;
  status: StatusConvite;
  convidadoPorNome?: string;
  expiresAt: string;
  createdAt: string;
}

// ─── Permissões por Cargo ────────────────────────────────────────────────────

export type Permissao =
  | "ver_todas_conversas"
  | "reatribuir_conversa"
  | "ver_metricas_todos"
  | "gerenciar_canais"
  | "gerenciar_colaboradores"
  | "excluir_contatos"
  | "exportar_relatorios"
  | "enviar_mensagens"
  | "ver_pipeline"
  | "gerenciar_escritorio";

export const PERMISSOES_POR_CARGO: Record<CargoColaborador, Permissao[]> = {
  dono: [
    "ver_todas_conversas", "reatribuir_conversa", "ver_metricas_todos",
    "gerenciar_canais", "gerenciar_colaboradores", "excluir_contatos",
    "exportar_relatorios", "enviar_mensagens", "ver_pipeline", "gerenciar_escritorio",
  ],
  gestor: [
    "ver_todas_conversas", "reatribuir_conversa", "ver_metricas_todos",
    "gerenciar_canais", "excluir_contatos", "exportar_relatorios",
    "enviar_mensagens", "ver_pipeline",
  ],
  atendente: [
    "enviar_mensagens", "ver_pipeline",
  ],
  estagiario: [
    "enviar_mensagens",
  ],
  // SDR = atendente + acesso a relatórios próprios + foco em qualificação
  // de leads. Mesma matriz que atendente nas permissões compartilhadas;
  // diferença real está em check-permission.ts (relatórios.verProprios=true).
  sdr: [
    "enviar_mensagens", "ver_pipeline", "exportar_relatorios",
  ],
};

export function temPermissao(cargo: CargoColaborador, permissao: Permissao): boolean {
  return PERMISSOES_POR_CARGO[cargo].includes(permissao);
}
