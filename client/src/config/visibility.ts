/**
 * Visibilidade de módulos no menu lateral.
 *
 * Lançamento MVP de 4/05/2026: só Clientes, Kanban e Financeiro vão pra
 * cliente final (junto com utilitários antigos: Dashboard, Cálculos,
 * Configurações, Meu Plano, Roadmap). O resto fica oculto até validação
 * caso a caso.
 *
 * IMPORTANTE: esconder do menu NÃO desabilita a rota — quem digitar
 * `/processos` direto continua acessando. Isso é intencional pra você
 * (dono / admin) testar manualmente sem precisar reabilitar.
 *
 * Pra liberar um módulo: remova-o de `MODULOS_OCULTOS_NO_MENU` e (se
 * for Beta ainda) garanta que está em `MODULOS_BETA`.
 */

/** Módulos que recebem badge "Beta" na sidebar (já são visíveis). */
export const MODULOS_BETA = new Set<string>([
  "clientes",
  "kanban",
  "financeiro",
  "agenda",
  "atendimento",
  "processos",
  "agentesIa",
  "smartflow",
]);

/**
 * Módulos escondidos do menu lateral até liberação caso a caso.
 * Rotas continuam funcionando — quem digitar a URL direto entra.
 *
 * Vazio agora: todos os 5 módulos (atendimento, agenda, processos,
 * agentesIa, smartflow) foram reativados no menu, com badge Beta.
 */
export const MODULOS_OCULTOS_NO_MENU = new Set<string>([
  // todos liberados
]);

/** Helper conveniente. */
export function moduloOcultoNoMenu(slug: string): boolean {
  return MODULOS_OCULTOS_NO_MENU.has(slug);
}

export function moduloEhBeta(slug: string): boolean {
  return MODULOS_BETA.has(slug);
}
