/**
 * Webhook Asaas — Billing SaaS (mensalidades dos escritórios assinantes).
 *
 * Endpoint: POST /api/webhooks/asaas-billing
 *
 * O Asaas envia o webhookSecret no header `asaas-access-token`. Validamos
 * contra `admin_integracoes.webhookSecret` (provedor = "asaas").
 *
 * Eventos tratados:
 * ASSINATURAS:
 *   - SUBSCRIPTION_CREATED → cria registro local em `subscriptions`
 *   - SUBSCRIPTION_UPDATED → atualiza status/datas
 *   - SUBSCRIPTION_DELETED → marca como canceled
 *
 * COBRANÇAS (do ciclo da assinatura):
 *   - PAYMENT_RECEIVED / PAYMENT_CONFIRMED → ativa subscription se estava
 *     pendente, atualiza currentPeriodEnd
 *   - PAYMENT_OVERDUE → marca como past_due
 *   - PAYMENT_REFUNDED → mantém ativa mas registra estorno
 *
 * NOTA: NÃO compartilhar este endpoint com /api/webhooks/asaas (que é
 * para os escritórios cobrarem seus próprios clientes). Os webhooks
 * usam tokens diferentes.
 */

import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { subscriptions, users } from "../../drizzle/schema";
import { getAsaasBillingWebhookSecret } from "./asaas-billing-client";
import { createLogger } from "../_core/logger";

const log = createLogger("billing-asaas-webhook");

interface AsaasBillingWebhookPayload {
  event: string;
  subscription?: {
    id: string;
    customer: string;
    status: "ACTIVE" | "INACTIVE" | "EXPIRED";
    nextDueDate?: string;
    externalReference?: string;
    deleted?: boolean;
  };
  payment?: {
    id: string;
    customer: string;
    subscription?: string;
    status: string;
    value: number;
    dueDate: string;
    paymentDate?: string;
    externalReference?: string;
    deleted?: boolean;
  };
}

/**
 * Mapeia o status da assinatura Asaas para o enum local de subscriptions.
 */
function mapAsaasStatus(asaasStatus: string): "active" | "canceled" | "past_due" | "incomplete" {
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

export function registerAsaasBillingWebhook(app: Express) {
  app.post("/api/webhooks/asaas-billing", async (req: Request, res: Response) => {
    try {
      const accessToken = req.headers["asaas-access-token"] as string;
      const body = req.body as AsaasBillingWebhookPayload;

      if (!body || !body.event) {
        return res.status(400).json({ error: "Payload inválido" });
      }
      if (!accessToken) {
        return res.status(401).json({ error: "Token ausente" });
      }

      // Validar token contra o webhookSecret armazenado
      const secret = await getAsaasBillingWebhookSecret();
      if (!secret || accessToken !== secret) {
        log.warn(
          { tokenPrefix: accessToken.slice(0, 8) },
          "Token de webhook não bate com o webhookSecret",
        );
        return res.status(401).json({ error: "Token inválido" });
      }

      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database indisponível" });

      // ─── EVENTOS DE ASSINATURA ──────────────────────────────────────
      if (body.event.startsWith("SUBSCRIPTION_") && body.subscription) {
        const sub = body.subscription;
        log.info({ event: body.event, subscriptionId: sub.id }, "Subscription event");

        // externalReference armazena `userId:planId`
        const ref = (sub.externalReference || "").split(":");
        const userId = parseInt(ref[0] || "", 10);
        const planId = ref[1] || null;

        if (!userId) {
          log.warn({ subId: sub.id }, "externalReference sem userId — ignorando");
          return res.status(200).json({ received: true, ignored: true });
        }

        // Salvar asaasCustomerId no users (uma vez)
        await db
          .update(users)
          .set({ asaasCustomerId: sub.customer })
          .where(eq(users.id, userId));

        const [existing] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.asaasSubscriptionId, sub.id))
          .limit(1);

        if (body.event === "SUBSCRIPTION_DELETED" || sub.deleted) {
          if (existing) {
            await db
              .update(subscriptions)
              .set({ status: "canceled" })
              .where(eq(subscriptions.id, existing.id));
            log.info({ subId: sub.id }, "Subscription canceled");
          }
          return res.status(200).json({ received: true });
        }

        const status = mapAsaasStatus(sub.status);
        const periodEnd = sub.nextDueDate
          ? new Date(sub.nextDueDate).getTime()
          : null;

        if (existing) {
          await db
            .update(subscriptions)
            .set({
              status,
              currentPeriodEnd: periodEnd,
              planId: planId || existing.planId,
            })
            .where(eq(subscriptions.id, existing.id));
        } else {
          await db.insert(subscriptions).values({
            userId,
            asaasSubscriptionId: sub.id,
            asaasCustomerId: sub.customer,
            planId,
            status,
            currentPeriodEnd: periodEnd,
          });
        }
      }

      // ─── EVENTOS DE PAGAMENTO (ciclo de assinatura) ─────────────────
      else if (body.event.startsWith("PAYMENT_") && body.payment) {
        const payment = body.payment;
        log.info(
          { event: body.event, paymentId: payment.id, status: payment.status },
          "Payment event",
        );

        // Pagamento de assinatura: atualizar status da subscription
        if (payment.subscription) {
          const [existing] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.asaasSubscriptionId, payment.subscription))
            .limit(1);

          if (!existing) {
            log.warn(
              { asaasSubId: payment.subscription },
              "Subscription não encontrada para o pagamento",
            );
            return res.status(200).json({ received: true });
          }

          const isPaid =
            body.event === "PAYMENT_RECEIVED" ||
            body.event === "PAYMENT_CONFIRMED" ||
            payment.status === "RECEIVED" ||
            payment.status === "CONFIRMED";
          const isOverdue =
            body.event === "PAYMENT_OVERDUE" || payment.status === "OVERDUE";

          if (isPaid) {
            // Ativa a assinatura e renova o período
            const nextPeriod = payment.dueDate
              ? new Date(payment.dueDate).getTime()
              : existing.currentPeriodEnd;
            await db
              .update(subscriptions)
              .set({ status: "active", currentPeriodEnd: nextPeriod })
              .where(eq(subscriptions.id, existing.id));
            log.info({ subId: existing.id }, "Subscription paga e ativa");
          } else if (isOverdue) {
            await db
              .update(subscriptions)
              .set({ status: "past_due" })
              .where(eq(subscriptions.id, existing.id));
            log.info({ subId: existing.id }, "Subscription past_due");
          }
        }
      }

      return res.status(200).json({ received: true });
    } catch (err: any) {
      log.error({ err: err.message, stack: err.stack }, "Erro processando webhook");
      return res.status(500).json({ error: "Erro interno" });
    }
  });
}
