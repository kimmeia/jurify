/**
 * Uma assinatura paga substitui as anteriores SÓ quando o pagamento dela é
 * confirmado. Trocar de plano ou converter o trial cria a nova assinatura e
 * deixa a atual valendo — quem a encerra é o webhook de pagamento, aqui.
 * Antes disso o cliente perdia o período já pago no instante em que clicava
 * em "Continuar para pagamento", mesmo sem nunca pagar a nova.
 */

import { and, eq, inArray, ne } from "drizzle-orm";
import { subscriptions } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("assinatura-substituicao");

type DbLike = {
  select: (...args: any[]) => any;
  update: (...args: any[]) => any;
};

const STATUS_SUBSTITUIVEIS = ["active", "trialing", "past_due", "incomplete"] as const;

export async function encerrarOutrasAssinaturas(
  db: DbLike,
  userId: number,
  manterId: number,
  cancelarNoAsaas?: (asaasSubscriptionId: string) => Promise<void>,
): Promise<{ encerradas: number[] }> {
  const outras: Array<{ id: number; asaasSubscriptionId: string | null; cortesia: boolean | null }> = await db
    .select({
      id: subscriptions.id,
      asaasSubscriptionId: subscriptions.asaasSubscriptionId,
      cortesia: subscriptions.cortesia,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        ne(subscriptions.id, manterId),
        inArray(subscriptions.status, [...STATUS_SUBSTITUIVEIS]),
      ),
    );

  const encerradas: number[] = [];
  for (const s of outras) {
    // Cortesia é concessão do admin, não assinatura do cliente — fica.
    if (s.cortesia) continue;
    if (s.asaasSubscriptionId) {
      try {
        const cancelar = cancelarNoAsaas ?? (await cancelarPadrao());
        await cancelar(s.asaasSubscriptionId);
      } catch (err: any) {
        log.warn(
          { err: err?.message, asaasSubscriptionId: s.asaasSubscriptionId },
          "cancelamento da assinatura substituída falhou no Asaas (status local segue canceled)",
        );
      }
    }
    await db.update(subscriptions).set({ status: "canceled" }).where(eq(subscriptions.id, s.id));
    encerradas.push(s.id);
  }
  if (encerradas.length > 0) {
    log.info({ userId, manterId, encerradas }, "assinaturas anteriores encerradas após pagamento da nova");
  }
  return { encerradas };
}

async function cancelarPadrao(): Promise<(id: string) => Promise<void>> {
  const { getAdminAsaasClient } = await import("./asaas-billing-client");
  const client = await getAdminAsaasClient();
  return (id) => client.cancelarAssinatura(id);
}
