/**
 * Tipos compartilhados — Módulo Escritório, Colaboradores e Configurações
 * Fase 1: Fundação organizacional do CRM
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type CargoColaborador = "dono" | "gestor" | "atendente" | "estagiario";
export type StatusConvite = "pendente" | "aceito" | "expirado" | "cancelado";
export type PlanoAtendimento = "basico" | "intermediario" | "completo";

export const CARGO_LABELS: Record<CargoColaborador, string> = {
  dono: "Dono",
  gestor: "Gestor",
  atendente: "Atendente",
  estagiario: "Estagiário",
};

export const CARGO_DESCRICAO: Record<CargoColaborador, string> = {
  dono: "Acesso total ao escritório, equipe e configurações",
  gestor: "Gerencia equipe, reatribui conversas, acessa relatórios",
  atendente: "Atende clientes, gerencia seus leads e conversas",
  estagiario: "Atende clientes sob supervisão, acesso limitado",
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
};

export function temPermissao(cargo: CargoColaborador, permissao: Permissao): boolean {
  return PERMISSOES_POR_CARGO[cargo].includes(permissao);
}
