/**
 * O porteiro do plano — o que faz "só libera o uso depois de escolher plano
 * ou teste" (dono, 13/09/2026) valer no SERVIDOR, e não só na tela.
 *
 * A régua é a MESMA que o `SubscriptionGuard` já usa no navegador:
 * `getActiveSubscriptionComHeranca` (cortesia > paga > teste > cancelada
 * dentro do período pago; colaborador herda a do dono). Nenhuma regra nova
 * sobre quem tem acesso — o que muda é o lugar onde ela é conferida.
 *
 * Três coisas passam sempre, e cada uma tem motivo:
 *  - admin da plataforma: navega pra dar suporte;
 *  - impersonação: é o dono olhando a conta do cliente, inclusive a conta SEM
 *    plano — é justamente o caso que ele precisa enxergar (o porteiro de
 *    módulos já abre a mesma exceção);
 *  - indeterminado: banco fora, exceção na consulta. Fail-open igual à casa —
 *    o porteiro não derruba escritório pagante por soluço nosso. Só um "não
 *    tem assinatura" explícito bloqueia.
 *
 * O cache guarda só o SIM. Guardar o "não" por 30s deixaria o app recusando
 * tudo nos primeiros segundos depois de clicar em "Testar grátis" — a pessoa
 * acabou de escolher o plano e levaria erro na cara. Quem não tem plano paga
 * uma consulta por chamada, e são poucas: a tela dele é uma só.
 */

import { TRPCError } from "@trpc/server";
import { MENSAGEM_SEM_PLANO, MOTIVO_SEM_PLANO, precisaDePlano } from "@shared/acesso-sem-plano";

/** Presença da chave = tem plano vigente. Ausência não afirma nada. */
const cacheSim = new Map<number, number>();
const TTL_MS = 30_000;

export function invalidarCacheGateAssinatura(): void {
  cacheSim.clear();
}

/**
 * Tem plano (pago, teste, cortesia ou carência) vigente?
 * `null` = indeterminado — nunca bloqueia. Nunca lança.
 */
export async function temPlanoVigente(userId: number): Promise<boolean | null> {
  const agora = Date.now();
  const validoAte = cacheSim.get(userId);
  if (validoAte != null && validoAte > agora) return true;

  try {
    const { getActiveSubscriptionComHeranca } = await import("../db");
    const sub = await getActiveSubscriptionComHeranca(userId);
    if (!sub) return false;
    if (cacheSim.size > 5_000) cacheSim.clear();
    cacheSim.set(userId, agora + TTL_MS);
    return true;
  } catch {
    return null;
  }
}

/**
 * Corpo do middleware do `protectedProcedure` (recebe path + usuário já
 * autenticado). Separado do tRPC pra ser testável como função.
 */
export async function conferirPlanoDoPath(args: {
  path: string;
  userId: number;
  role: string | null | undefined;
  impersonado: boolean;
}): Promise<void> {
  if (args.role === "admin") return;
  if (args.impersonado) return;
  if (!precisaDePlano(args.path)) return;

  const tem = await temPlanoVigente(args.userId);
  // Só o "não" explícito bloqueia: `null` é indeterminação nossa.
  if (tem !== false) return;

  throw new TRPCError({
    code: "FORBIDDEN",
    message: MENSAGEM_SEM_PLANO,
    cause: { motivo: MOTIVO_SEM_PLANO },
  });
}
