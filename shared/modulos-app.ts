/**
 * Catálogo de módulos do app que podem ser liberados/bloqueados por plano.
 *
 * Cada plano carrega `modulos_liberados[]` com slugs dessa lista. O backend
 * usa pra gate em runtime; o admin marca checkboxes pra cada plano.
 *
 * `obrigatorio: true` = sempre liberado, admin não pode bloquear (módulos
 * essenciais pro funcionamento básico: dashboard, configurações).
 */

export interface ModuloApp {
  id: string;
  nome: string;
  descricao: string;
  obrigatorio: boolean;
}

export const MODULOS_APP: readonly ModuloApp[] = [
  { id: "dashboard",     nome: "Dashboard",                    descricao: "Visão geral do escritório",                    obrigatorio: true  },
  { id: "configuracoes", nome: "Configurações",                descricao: "Perfil, equipe, integrações",                   obrigatorio: true  },
  { id: "clientes",      nome: "Clientes (CRM)",               descricao: "Cadastro e gestão de clientes",                 obrigatorio: false },
  { id: "atendimento",   nome: "Atendimento (WhatsApp + IG)",  descricao: "Conversas multi-canal com clientes",            obrigatorio: false },
  { id: "kanban",        nome: "Funil Kanban",                 descricao: "Pipeline visual de vendas/leads",               obrigatorio: false },
  { id: "agenda",        nome: "Agenda e Tarefas",             descricao: "Calendário, agendamentos, lembretes",           obrigatorio: false },
  { id: "processos",     nome: "Monitoramento de Processos",   descricao: "Tribunais (PJe, E-SAJ, etc)",                   obrigatorio: false },
  { id: "smartflow",     nome: "SmartFlow (automação)",        descricao: "Fluxos automáticos de atendimento e cobrança",  obrigatorio: false },
  { id: "agentes_ia",    nome: "Agentes IA personalizados",    descricao: "Chatbots/IAs treinados por escritório",         obrigatorio: false },
  { id: "calculos",      nome: "Cálculos Jurídicos",           descricao: "Trabalhista, imobiliário, financiamento, etc",  obrigatorio: false },
  { id: "financeiro",    nome: "Financeiro (Asaas)",           descricao: "Cobranças, recibos, conciliação",               obrigatorio: false },
  { id: "comissoes",     nome: "Comissões automáticas",        descricao: "Distribuição de comissão por colaborador",      obrigatorio: false },
  { id: "contratos",     nome: "Modelos de Contrato",          descricao: "Geração e assinatura digital",                  obrigatorio: false },
  { id: "relatorios",    nome: "Relatórios",                   descricao: "Exportações e BI",                              obrigatorio: false },
  { id: "backups",       nome: "Backup do escritório",         descricao: "Exportação completa de dados",                  obrigatorio: false },
] as const;

export type ModuloAppId = (typeof MODULOS_APP)[number]["id"];

export const MODULOS_APP_OBRIGATORIOS: readonly string[] = MODULOS_APP
  .filter((m) => m.obrigatorio)
  .map((m) => m.id);

export function ehModuloValido(id: string): id is ModuloAppId {
  return MODULOS_APP.some((m) => m.id === id);
}
