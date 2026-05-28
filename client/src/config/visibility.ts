/**
 * Visibilidade de módulos no menu lateral.
 *
 * Dois conjuntos independentes:
 *  - MODULOS_OCULTOS_NO_MENU: somem completamente do menu (rota ainda
 *    funciona via URL direta — útil pra admin testar sem expor).
 *  - MODULOS_BETA / MODULOS_EM_BREVE: aparecem no menu com badge.
 *
 * "Beta"     = disponível mas em testes (pode ter bugs).
 * "Em breve" = visível pra dar previsão, ainda não liberado oficialmente.
 *
 * Pra liberar um módulo Beta como estável: remova-o de `MODULOS_BETA`.
 * Pra esconder de novo: adicione em `MODULOS_OCULTOS_NO_MENU`.
 */

/** Módulos que recebem badge "Beta" na sidebar (vazio = nenhum). */
export const MODULOS_BETA = new Set<string>([]);

/** Módulos que recebem badge "Em breve" na sidebar (vazio = nenhum). */
export const MODULOS_EM_BREVE = new Set<string>([]);

/**
 * Módulos completamente escondidos do menu lateral.
 * Vazio por padrão — adicione um slug aqui pra ocultar temporariamente.
 * Rotas continuam funcionando via URL direta.
 */
export const MODULOS_OCULTOS_NO_MENU = new Set<string>([]);

/** Helpers. */
export function moduloOcultoNoMenu(slug: string): boolean {
  return MODULOS_OCULTOS_NO_MENU.has(slug);
}

export function moduloEhBeta(slug: string): boolean {
  return MODULOS_BETA.has(slug);
}

export function moduloEmBreve(slug: string): boolean {
  return MODULOS_EM_BREVE.has(slug);
}
