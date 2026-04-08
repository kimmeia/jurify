/**
 * Funções puras de mapeamento Asaas → Jurify.
 *
 * Separadas em módulo próprio porque são testáveis sem precisar de DB,
 * banco de teste ou mock — apenas entrada e saída.
 */

import type { Subscription } from "../../drizzle/schema";

export type LocalSubscriptionStatus = Subscription["status"];

/**
 * Mapeia o status da assinatura Asaas para o enum local de subscriptions.
 *
 * Asaas tem 3 estados (ACTIVE, INACTIVE, EXPIRED). Nosso enum tem 8 (active,
 * canceled, incomplete, etc). A regra:
 *   - ACTIVE                  → active
 *   - INACTIVE | EXPIRED      → canceled
 *   - desconhecido            → incomplete (estado seguro: não libera o usuário)
 */
export function mapAsaasStatus(asaasStatus: string): LocalSubscriptionStatus {
  switch (asaasStatus) {
    case "ACTIVE":
      return "active";
    case "INACTIVE":
    case "EXPIRED":
      return "canceled";
    default:
      return "incomplete";
  }
}

/**
 * Determina se um evento Asaas representa "pagamento confirmado" para
 * fins de ativação de assinatura local.
 *
 * Aceita tanto o nome do evento (PAYMENT_RECEIVED, PAYMENT_CONFIRMED)
 * quanto o status (RECEIVED, CONFIRMED) por segurança — o Asaas às vezes
 * envia ambos os campos preenchidos, às vezes só um.
 */
export function isPaymentPaidEvent(event: string, status: string): boolean {
  return (
    event === "PAYMENT_RECEIVED" ||
    event === "PAYMENT_CONFIRMED" ||
    status === "RECEIVED" ||
    status === "CONFIRMED"
  );
}

/**
 * Determina se um evento Asaas representa "pagamento atrasado".
 */
export function isPaymentOverdueEvent(event: string, status: string): boolean {
  return event === "PAYMENT_OVERDUE" || status === "OVERDUE";
}

/**
 * Faz parse do externalReference do Asaas no formato "userId:planId".
 *
 *   "42:profissional"  → { userId: 42, planId: "profissional" }
 *   "42"               → { userId: 42, planId: null }
 *   ""                 → { userId: null, planId: null }
 *   "abc:xyz"          → { userId: null, planId: "xyz" }
 */
export function parseExternalReference(
  ref: string | null | undefined,
): { userId: number | null; planId: string | null } {
  if (!ref) return { userId: null, planId: null };
  const parts = ref.split(":");
  const userIdRaw = parts[0] || "";
  const userId = /^\d+$/.test(userIdRaw) ? parseInt(userIdRaw, 10) : null;
  const planId = parts[1] || null;
  return { userId, planId };
}

/**
 * Calcula a próxima data de vencimento no formato YYYY-MM-DD a partir
 * de um número de dias de antecedência. Usado para criar cobranças
 * cujo prazo é "X dias a partir de agora".
 */
export function dataVencimentoEmDias(dias: number, base?: Date): string {
  const d = base ? new Date(base) : new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}
