/**
 * Fonte única dos módulos do sistema de permissões.
 *
 * Importado pelo backend (router-permissoes, check-permission) e pelo front
 * (matriz de cargos em Configurações). Antes cada ponta tinha a própria lista
 * hardcoded e elas desalinhavam: módulo novo (Modelos) não existia em lugar
 * nenhum, e um módulo do backend (Tarefas) sumia da tela. Centralizar aqui
 * garante que adicionar um módulo o faça aparecer nas 3 pontas de uma vez.
 */

/** Ordem = ordem de exibição na matriz de permissões. */
export const MODULOS = [
  "dashboard",
  "calculos",
  "clientes",
  "modelos",
  "processos",
  "atendimento",
  "kanban",
  "agenda",
  "tarefas",
  "smartflow",
  "agentesIa",
  "relatorios",
  "financeiro",
  "configuracoes",
  "equipe",
] as const;

export type Modulo = (typeof MODULOS)[number];

export const MODULOS_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  calculos: "Cálculos",
  clientes: "Clientes",
  modelos: "Modelos",
  processos: "Processos",
  atendimento: "Atendimento",
  kanban: "Kanban",
  agenda: "Agenda",
  tarefas: "Tarefas",
  smartflow: "SmartFlow",
  agentesIa: "Agentes IA",
  relatorios: "Relatórios",
  financeiro: "Financeiro",
  configuracoes: "Configurações",
  equipe: "Equipe",
};

/**
 * Módulos "desmembrados" de um módulo-base. Quando um cargo não tem linha
 * própria pro módulo (ex.: cargo criado antes do módulo existir), herda a
 * permissão do base — zero perda de acesso no deploy. Assim que o admin
 * marca o módulo explicitamente na matriz, o valor marcado passa a valer.
 */
export const MODULO_HERANCA: Record<string, string> = {
  modelos: "clientes",
  tarefas: "agenda",
};
