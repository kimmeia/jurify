import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto por-request que marca se a sessão atual é um admin impersonando
 * outro usuário.
 *
 * Setado no middleware `requireUser` (que tem `ctx.user.impersonatedBy`) e lido
 * pelo `checkPermission` — que só recebe o `userId` do alvo, não o ctx, e
 * precisa do bypass de superuser sem threading a flag pelos ~28 call-sites.
 *
 * Decisão de produto: admin impersonando tem acesso total ao escritório-alvo
 * (mesmo padrão já usado no `router-backup.ts`). As ações continuam auditadas
 * em nome do admin original (via `impersonatedBy`).
 */
const als = new AsyncLocalStorage<{ impersonatedBy?: string }>();

/** Roda `fn` com o contexto de impersonação da request atual. */
export function runComContextoImpersonacao<T>(
  impersonatedBy: string | undefined,
  fn: () => T,
): T {
  return als.run({ impersonatedBy }, fn);
}

/** true quando a request atual é um admin impersonando (bypass de permissão). */
export function estaImpersonando(): boolean {
  return !!als.getStore()?.impersonatedBy;
}
