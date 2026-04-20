/**
 * Tipos compartilhados do SmartFlow — automações com IA + WhatsApp + Cal.com.
 *
 * Config discriminada por `tipo` de passo. Usada no frontend (editor ReactFlow)
 * e no backend (validação Zod, engine). Mantém compatibilidade binária com
 * PassoConfig/Passo existentes em server/smartflow/engine.ts.
 */
import type { LucideIcon } from "lucide-react";

export type GatilhoSmartflow =
  | "whatsapp_mensagem"
  | "novo_lead"
  | "agendamento_criado"
  | "pagamento_recebido"
  | "manual";

export type TipoPasso =
  | "ia_classificar"
  | "ia_responder"
  | "calcom_horarios"
  | "calcom_agendar"
  | "whatsapp_enviar"
  | "transferir"
  | "condicional"
  | "esperar"
  | "webhook"
  | "kanban_criar_card";

export type StatusExecucao = "rodando" | "concluido" | "erro" | "cancelado";

export type OperadorCondicional =
  | "igual"
  | "diferente"
  | "existe"
  | "nao_existe"
  | "verdadeiro";

export type PrioridadeCard = "baixa" | "media" | "alta";

export interface ConfigIaClassificar {
  categorias?: string[];
}
export interface ConfigIaResponder {
  prompt?: string;
}
export interface ConfigCalcomHorarios {
  duracao?: number;
}
export interface ConfigCalcomAgendar {
  /** reservado para futuras configs (eventTypeId, email padrão, etc.) */
}
export interface ConfigWhatsappEnviar {
  template?: string;
}
export interface ConfigTransferir {
  /** reservado */
}
export interface ConfigCondicional {
  campo?: string;
  operador?: OperadorCondicional;
  valor?: string;
}
export interface ConfigEsperar {
  delayMinutos?: number;
}
export interface ConfigWebhook {
  url?: string;
}
export interface ConfigKanbanCriarCard {
  titulo?: string;
  funilId?: number;
  colunaId?: number;
  prioridade?: PrioridadeCard;
}

/**
 * Union discriminada por `tipo`. Usada no editor pra garantir type-safety
 * do painel de configuração. O backend aceita `config` como objeto livre
 * (por compatibilidade) mas esses tipos documentam o shape esperado.
 */
export type PassoConfigByTipo =
  | { tipo: "ia_classificar"; config: ConfigIaClassificar }
  | { tipo: "ia_responder"; config: ConfigIaResponder }
  | { tipo: "calcom_horarios"; config: ConfigCalcomHorarios }
  | { tipo: "calcom_agendar"; config: ConfigCalcomAgendar }
  | { tipo: "whatsapp_enviar"; config: ConfigWhatsappEnviar }
  | { tipo: "transferir"; config: ConfigTransferir }
  | { tipo: "condicional"; config: ConfigCondicional }
  | { tipo: "esperar"; config: ConfigEsperar }
  | { tipo: "webhook"; config: ConfigWebhook }
  | { tipo: "kanban_criar_card"; config: ConfigKanbanCriarCard };

export interface PassoSmartflow {
  id?: number;
  ordem: number;
  tipo: TipoPasso;
  config: Record<string, unknown>;
}

export interface CenarioSmartflow {
  id: number;
  nome: string;
  descricao?: string | null;
  gatilho: GatilhoSmartflow;
  ativo: boolean;
  criadoPor?: number | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  passos?: PassoSmartflow[];
}

export interface ExecucaoSmartflow {
  id: number;
  cenarioId: number;
  escritorioId: number;
  contatoId?: number | null;
  conversaId?: number | null;
  status: StatusExecucao;
  passoAtual: number;
  contexto?: string | null;
  erro?: string | null;
  retomarEm?: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/** Metadados de UI (usados no frontend p/ render). */
export interface TipoPassoMeta {
  id: TipoPasso;
  label: string;
  descricao: string;
  /** Classe Tailwind para background/texto do chip. */
  cor: string;
}

export interface GatilhoMeta {
  id: GatilhoSmartflow;
  label: string;
  descricao: string;
}

export const TIPO_PASSO_META: ReadonlyArray<TipoPassoMeta> = [
  { id: "ia_classificar", label: "Classificar intenção (IA)", descricao: "Usa IA para categorizar a mensagem.", cor: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  { id: "ia_responder", label: "Responder com IA", descricao: "Gera resposta contextual com IA.", cor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { id: "calcom_horarios", label: "Buscar horários (Cal.com)", descricao: "Busca slots disponíveis no Cal.com.", cor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { id: "calcom_agendar", label: "Criar agendamento", descricao: "Confirma o horário no Cal.com.", cor: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  { id: "whatsapp_enviar", label: "Enviar mensagem", descricao: "Envia mensagem pelo WhatsApp.", cor: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  { id: "transferir", label: "Transferir p/ humano", descricao: "Encerra o fluxo e notifica atendente.", cor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  { id: "condicional", label: "Condição (if/else)", descricao: "Continua só se a condição for atendida.", cor: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  { id: "esperar", label: "Esperar (delay)", descricao: "Pausa o fluxo por N minutos.", cor: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  { id: "webhook", label: "Webhook externo", descricao: "POST para uma URL externa.", cor: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300" },
  { id: "kanban_criar_card", label: "Criar card Kanban", descricao: "Cria card no funil/coluna escolhido.", cor: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
];

export const GATILHO_META: ReadonlyArray<GatilhoMeta> = [
  { id: "whatsapp_mensagem", label: "Nova mensagem WhatsApp", descricao: "Dispara quando chega mensagem no canal." },
  { id: "pagamento_recebido", label: "Pagamento recebido (Asaas)", descricao: "Dispara no webhook do Asaas." },
  { id: "novo_lead", label: "Novo lead no CRM", descricao: "Dispara quando um contato novo é criado." },
  { id: "agendamento_criado", label: "Agendamento criado", descricao: "Dispara quando booking Cal.com é confirmado." },
  { id: "manual", label: "Acionado manualmente", descricao: "Executado pelo botão 'Executar agora'." },
];

export function getTipoPassoMeta(tipo: string): TipoPassoMeta {
  return (
    TIPO_PASSO_META.find((t) => t.id === tipo) ?? {
      id: tipo as TipoPasso,
      label: tipo,
      descricao: "",
      cor: "bg-gray-100 text-gray-700",
    }
  );
}

export function getGatilhoMeta(id: string): GatilhoMeta {
  return (
    GATILHO_META.find((g) => g.id === id) ?? {
      id: id as GatilhoSmartflow,
      label: id,
      descricao: "",
    }
  );
}

/** Variáveis de contexto disponíveis no template de mensagem WhatsApp. */
export const VARIAVEIS_TEMPLATE = ["{nome}", "{intencao}", "{horario}"] as const;

/** Campos sugeridos no painel de condicional. */
export const CAMPOS_CONDICIONAL = [
  "intencao",
  "assinaturaId",
  "primeiraCobranca",
  "pagamentoTipo",
  "transferir",
] as const;

/** Não exporta ícones aqui (manter arquivo agnóstico a React/lucide). */
export type { LucideIcon };
