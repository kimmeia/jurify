// Tipos
export type TipoAgendamento = "prazo_processual" | "audiencia" | "reuniao_comercial" | "tarefa" | "follow_up" | "outro";
export type PrioridadeAgendamento = "baixa" | "normal" | "alta" | "critica";
export type StatusAgendamento = "pendente" | "em_andamento" | "concluido" | "cancelado" | "atrasado";

// Labels
export const TIPO_LABELS: Record<TipoAgendamento, string> = {
  prazo_processual: "Prazo Processual",
  audiencia: "Audiência",
  reuniao_comercial: "Reunião Comercial",
  tarefa: "Tarefa",
  follow_up: "Follow-up",
  outro: "Outro",
};

export const PRIORIDADE_LABELS: Record<PrioridadeAgendamento, string> = {
  baixa: "Baixa",
  normal: "Normal",
  alta: "Alta",
  critica: "Crítica",
};

export const STATUS_LABELS: Record<StatusAgendamento, string> = {
  pendente: "Pendente",
  em_andamento: "Em Andamento",
  concluido: "Concluído",
  cancelado: "Cancelado",
  atrasado: "Atrasado",
};

// Cores
export const TIPO_CORES: Record<TipoAgendamento, string> = {
  prazo_processual: "#ef4444",
  audiencia: "#8b5cf6",
  reuniao_comercial: "#3b82f6",
  tarefa: "#10b981",
  follow_up: "#f59e0b",
  outro: "#6b7280",
};
