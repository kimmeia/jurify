/**
 * Tipos compartilhados — CRM / Atendimento
 * Fase 3: Contatos, Conversas, Mensagens, Leads, Métricas
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type OrigemContato = "whatsapp" | "instagram" | "facebook" | "telefone" | "manual" | "site";
export type StatusConversa = "aguardando" | "em_atendimento" | "resolvido" | "fechado";
export type PrioridadeConversa = "baixa" | "normal" | "alta" | "urgente";
export type DirecaoMensagem = "entrada" | "saida";
export type TipoMensagem = "texto" | "imagem" | "audio" | "video" | "documento" | "localizacao" | "contato" | "sticker" | "sistema";
export type StatusMensagem = "pendente" | "enviada" | "entregue" | "lida" | "falha";
export type EtapaFunil = "novo" | "qualificado" | "proposta" | "negociacao" | "fechado_ganho" | "fechado_perdido";

export const ORIGEM_LABELS: Record<OrigemContato, string> = {
  whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook",
  telefone: "Telefone", manual: "Manual", site: "Site",
};

export const STATUS_CONVERSA_LABELS: Record<StatusConversa, string> = {
  aguardando: "Aguardando", em_atendimento: "Em atendimento",
  resolvido: "Resolvido", fechado: "Fechado",
};

export const STATUS_CONVERSA_CORES: Record<StatusConversa, string> = {
  aguardando: "text-amber-600 bg-amber-50 border-amber-200",
  em_atendimento: "text-blue-600 bg-blue-50 border-blue-200",
  resolvido: "text-emerald-600 bg-emerald-50 border-emerald-200",
  fechado: "text-gray-500 bg-gray-50 border-gray-200",
};

export const ETAPA_FUNIL_LABELS: Record<EtapaFunil, string> = {
  novo: "Novo", qualificado: "Qualificado", proposta: "Proposta",
  negociacao: "Negociação", fechado_ganho: "Ganho", fechado_perdido: "Perdido",
};

export const ETAPA_FUNIL_CORES: Record<EtapaFunil, string> = {
  novo: "bg-gray-100 text-gray-700 border-gray-300",
  qualificado: "bg-blue-100 text-blue-700 border-blue-300",
  proposta: "bg-purple-100 text-purple-700 border-purple-300",
  negociacao: "bg-amber-100 text-amber-700 border-amber-300",
  fechado_ganho: "bg-emerald-100 text-emerald-700 border-emerald-300",
  fechado_perdido: "bg-red-100 text-red-700 border-red-300",
};

export const PRIORIDADE_CONVERSA_LABELS: Record<PrioridadeConversa, string> = {
  baixa: "Baixa", normal: "Normal", alta: "Alta", urgente: "Urgente",
};

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface ContatoInfo {
  id: number;
  nome: string;
  telefone?: string;
  email?: string;
  cpfCnpj?: string;
  origem: OrigemContato;
  tags: string[];
  observacoes?: string;
  responsavelNome?: string;
  createdAt: string;
}

export interface ConversaInfo {
  id: number;
  contatoId: number;
  contatoNome: string;
  contatoTelefone?: string;
  canalId: number;
  canalNome?: string;
  canalTipo?: string;
  atendenteId?: number;
  atendenteNome?: string;
  status: StatusConversa;
  prioridade: PrioridadeConversa;
  assunto?: string;
  ultimaMensagemAt?: string;
  ultimaMensagemPreview?: string;
  naoLidas?: number;
  temAtraso?: boolean;
  createdAt: string;
}

export interface MensagemInfo {
  id: number;
  conversaId: number;
  remetenteNome?: string;
  direcao: DirecaoMensagem;
  tipo: TipoMensagem;
  conteudo?: string;
  mediaUrl?: string;
  status: StatusMensagem;
  createdAt: string;
}

export interface LeadInfo {
  id: number;
  contatoId: number;
  contatoNome: string;
  contatoTelefone?: string;
  responsavelNome?: string;
  etapaFunil: EtapaFunil;
  valorEstimado?: string;
  origemLead?: string;
  probabilidade: number;
  dataFechamentoPrevisto?: string;
  createdAt: string;
}

export interface MetricasDashboard {
  totalContatos: number;
  conversasAbertas: number;
  conversasAguardando: number;
  leadsNovos: number;
  leadsGanhos: number;
  valorPipeline: number;
  tempoMedioResposta: number;
}
