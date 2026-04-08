/**
 * Router — Assinaturas e Cobrança SaaS via Asaas
 *
 * Cria customers + subscriptions no Asaas, lista planos e gerencia
 * cancelamento. Substituiu a integração com Stripe.
 *
 * Fluxo de assinatura:
 *   1. cliente seleciona plano → createCheckout
 *   2. servidor cria/recupera AsaasCustomer (vinculado ao users.asaasCustomerId)
 *   3. servidor cria AsaasSubscription com externalReference = "userId:planId"
 *   4. retorna invoiceUrl da próxima fatura → cliente paga
 *   5. webhook /api/webhooks/asaas-billing recebe SUBSCRIPTION_CREATED + PAYMENT_RECEIVED
 *      e atualiza a tabela `subscriptions` local
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getActiveSubscription, getUserSubscriptions, getDb } from "../db";
import { getAdminAsaasClient, isAsaasBillingConfigured } from "../billing/asaas-billing-client";
import { PLANS } from "../billing/products";
import { subscriptions as subscriptionsTable, users } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("router-subscription");

/**
 * Próxima data de vencimento padrão (3 dias a partir de hoje, formato YYYY-MM-DD).
 * 3 dias dá tempo do cliente abrir o link e pagar via boleto/PIX antes do vencimento.
 */
function dataVencimentoPadrao(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
}

/**
 * Garante que existe um Customer no Asaas para este usuário.
 * Reutiliza o existente via users.asaasCustomerId; se não existir, cria.
 */
async function garantirAsaasCustomer(
  userId: number,
  email: string | null | undefined,
  name: string | null | undefined,
): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("Usuário não encontrado");

  if (user.asaasCustomerId) return user.asaasCustomerId;

  const client = await getAdminAsaasClient();
  // CPF/CNPJ é obrigatório no Asaas — usamos um placeholder para o customer
  // ser criado no sandbox; em produção, exigir cadastro completo do CPF
  // antes de criar a subscription.
  const customer = await client.criarCliente({
    name: name || email || `Usuário ${userId}`,
    cpfCnpj: "00000000000", // placeholder — TODO: coletar CPF real no fluxo de checkout
    email: email || undefined,
    externalReference: `user:${userId}`,
  });

  await db
    .update(users)
    .set({ asaasCustomerId: customer.id })
    .where(eq(users.id, userId));

  log.info({ userId, asaasCustomerId: customer.id }, "Customer Asaas criado");
  return customer.id;
}

export const subscriptionRouter = router({
  /** Get current user's active subscription */
  current: protectedProcedure.query(async ({ ctx }) => {
    return getActiveSubscription(ctx.user.id);
  }),

  /** Get all subscriptions for current user */
  list: protectedProcedure.query(async ({ ctx }) => {
    return getUserSubscriptions(ctx.user.id);
  }),

  /** Get available plans */
  plans: publicProcedure.query(() => {
    return PLANS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      features: p.features,
      priceMonthly: p.priceMonthly,
      priceYearly: p.priceYearly,
      currency: p.currency,
      popular: p.popular ?? false,
      isOneTime: p.isOneTime ?? false,
      creditsPerMonth: p.creditsPerMonth,
    }));
  }),

  /** Health-check: o admin já configurou a integração Asaas? */
  billingConfigured: publicProcedure.query(() => isAsaasBillingConfigured()),

  /**
   * Cria checkout via Asaas.
   *
   * Para `isOneTime` (avulso): cria uma cobrança única (PIX/boleto/cartão).
   * Para subscription: cria customer + assinatura recorrente.
   *
   * Retorna `{ url }` apontando para o invoiceUrl do Asaas.
   */
  createCheckout: protectedProcedure
    .input(
      z.object({
        planId: z.string(),
        interval: z.enum(["monthly", "yearly"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = PLANS.find((p) => p.id === input.planId);
      if (!plan) throw new Error("Plano não encontrado");

      const client = await getAdminAsaasClient();
      const customerId = await garantirAsaasCustomer(
        ctx.user.id,
        ctx.user.email,
        ctx.user.name,
      );

      // Avulso → cobrança única
      if (plan.isOneTime) {
        const cobranca = await client.criarCobranca({
          customer: customerId,
          billingType: "UNDEFINED", // permite cliente escolher PIX/boleto/cartão
          value: plan.priceMonthly / 100, // Asaas usa unidade BRL, não centavos
          dueDate: dataVencimentoPadrao(),
          description: `${plan.name} — Cálculo Avulso`,
          externalReference: `${ctx.user.id}:${input.planId}`,
        });
        log.info(
          { userId: ctx.user.id, paymentId: cobranca.id, plan: plan.id },
          "Checkout avulso criado",
        );
        return { url: cobranca.invoiceUrl };
      }

      // Subscription → assinatura recorrente
      const value =
        input.interval === "monthly" ? plan.priceMonthly : plan.priceYearly;

      const sub = await client.criarAssinatura({
        customer: customerId,
        billingType: "UNDEFINED",
        value: value / 100,
        nextDueDate: dataVencimentoPadrao(),
        cycle: input.interval === "monthly" ? "MONTHLY" : "YEARLY",
        description: `${plan.name} — Jurify SaaS`,
        externalReference: `${ctx.user.id}:${input.planId}`,
      });

      // Buscar a primeira cobrança gerada para retornar o link de pagamento
      const cobrancas = await client.listarCobrancas({
        customer: customerId,
        limit: 5,
      });
      const primeira = cobrancas.data.find(
        (c) => c.externalReference === `${ctx.user.id}:${input.planId}` && !c.deleted,
      );

      log.info(
        { userId: ctx.user.id, subId: sub.id, plan: plan.id },
        "Subscription Asaas criada",
      );

      return {
        url: primeira?.invoiceUrl || "",
        asaasSubscriptionId: sub.id,
      };
    }),

  /** Cancela a assinatura ativa imediatamente (Asaas não tem "cancel at period end") */
  cancel: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await getActiveSubscription(ctx.user.id);
    if (!sub) throw new Error("Nenhuma assinatura ativa encontrada.");
    if (!sub.asaasSubscriptionId) {
      throw new Error("Assinatura sem ID Asaas — contate o suporte.");
    }

    const client = await getAdminAsaasClient();
    await client.cancelarAssinatura(sub.asaasSubscriptionId);

    const db = await getDb();
    if (db) {
      await db
        .update(subscriptionsTable)
        .set({ status: "canceled", cancelAtPeriodEnd: true })
        .where(eq(subscriptionsTable.id, sub.id));
    }

    return { success: true };
  }),

  /**
   * Reativar não é suportado nativamente pelo Asaas (cancelamento é definitivo).
   * Cliente precisa criar nova assinatura via createCheckout. Mantemos o método
   * por compatibilidade com o frontend, mas retorna erro explicativo.
   */
  reactivate: protectedProcedure.mutation(async () => {
    throw new Error(
      "Para reativar, crie uma nova assinatura na página de planos. " +
        "O Asaas não permite reativar assinaturas canceladas.",
    );
  }),

  /** Trocar plano = nova assinatura. Cancela a antiga (se houver) e cria a nova. */
  changePlan: protectedProcedure
    .input(
      z.object({
        newPlanId: z.string(),
        interval: z.enum(["monthly", "yearly"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const newPlan = PLANS.find((p) => p.id === input.newPlanId);
      if (!newPlan) throw new Error("Plano não encontrado");
      if (newPlan.isOneTime) throw new Error("Use a opção de compra avulsa.");

      const client = await getAdminAsaasClient();
      const currentSub = await getActiveSubscription(ctx.user.id);

      // Cancela a antiga (não estorna pagamentos já feitos)
      if (currentSub?.asaasSubscriptionId) {
        try {
          await client.cancelarAssinatura(currentSub.asaasSubscriptionId);
          const db = await getDb();
          if (db) {
            await db
              .update(subscriptionsTable)
              .set({ status: "canceled" })
              .where(eq(subscriptionsTable.id, currentSub.id));
          }
        } catch (err: any) {
          log.warn(
            { err: err.message, subId: currentSub.asaasSubscriptionId },
            "Falha ao cancelar assinatura antiga",
          );
        }
      }

      const customerId = await garantirAsaasCustomer(
        ctx.user.id,
        ctx.user.email,
        ctx.user.name,
      );

      const value =
        input.interval === "monthly"
          ? newPlan.priceMonthly
          : newPlan.priceYearly;

      const sub = await client.criarAssinatura({
        customer: customerId,
        billingType: "UNDEFINED",
        value: value / 100,
        nextDueDate: dataVencimentoPadrao(),
        cycle: input.interval === "monthly" ? "MONTHLY" : "YEARLY",
        description: `${newPlan.name} — Jurify SaaS`,
        externalReference: `${ctx.user.id}:${input.newPlanId}`,
      });

      const cobrancas = await client.listarCobrancas({
        customer: customerId,
        limit: 5,
      });
      const primeira = cobrancas.data.find(
        (c) =>
          c.externalReference === `${ctx.user.id}:${input.newPlanId}` &&
          !c.deleted,
      );

      return {
        url: primeira?.invoiceUrl || "",
        asaasSubscriptionId: sub.id,
      };
    }),
});
