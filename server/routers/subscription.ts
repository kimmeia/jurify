/**
 * Router — Assinaturas e Cobrança SaaS via Asaas
 *
 * Cria customers + subscriptions no Asaas, lista planos e gerencia
 * cancelamento. Substituiu a integração com Stripe.
 *
 * Fluxo de assinatura:
 *   1. cliente seleciona plano + informa CPF/CNPJ → createCheckout
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
import { validarCpfCnpj } from "../../shared/validacoes";
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
 * Reutiliza o existente via users.asaasCustomerId; se não existir, cria
 * usando o CPF/CNPJ informado pelo cliente.
 *
 * @throws Error se cpfCnpj for inválido ou ausente quando precisar criar customer
 */
async function garantirAsaasCustomer(
  userId: number,
  email: string | null | undefined,
  name: string | null | undefined,
  cpfCnpj: string,
): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("Usuário não encontrado");

  // Se já existe customer no Asaas para este user, reusar
  if (user.asaasCustomerId) return user.asaasCustomerId;

  // Customer novo: validar CPF/CNPJ obrigatório
  const validacao = validarCpfCnpj(cpfCnpj);
  if (!validacao.valido) {
    throw new Error("CPF/CNPJ inválido. Verifique os dígitos.");
  }

  const client = await getAdminAsaasClient();
  const customer = await client.criarCliente({
    name: name || email || `Usuário ${userId}`,
    cpfCnpj: cpfCnpj.replace(/\D/g, ""),
    email: email || undefined,
    externalReference: `user:${userId}`,
  });

  await db
    .update(users)
    .set({ asaasCustomerId: customer.id })
    .where(eq(users.id, userId));

  log.info(
    { userId, asaasCustomerId: customer.id, tipo: validacao.tipo },
    "Customer Asaas criado",
  );
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

  /** Get available plans (todos recorrentes — não tem mais avulso) */
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
    }));
  }),

  /** Health-check: o admin já configurou a integração Asaas? */
  billingConfigured: publicProcedure.query(() => isAsaasBillingConfigured()),

  /**
   * Cria checkout (assinatura recorrente) via Asaas.
   *
   * Cria customer + AsaasSubscription e retorna o invoiceUrl da primeira
   * cobrança. O cliente paga via PIX/boleto/cartão escolhido na página
   * do Asaas, o webhook /api/webhooks/asaas-billing recebe PAYMENT_RECEIVED
   * e ativa a subscription localmente.
   *
   * `cpfCnpj` é obrigatório só na PRIMEIRA assinatura (quando ainda não
   * existe customer no Asaas). Em assinaturas subsequentes do mesmo
   * usuário, o customer já existe e o CPF não é exigido novamente.
   */
  createCheckout: protectedProcedure
    .input(
      z.object({
        planId: z.string(),
        interval: z.enum(["monthly", "yearly"]),
        cpfCnpj: z.string().optional(),
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
        input.cpfCnpj || "",
      );

      const value =
        input.interval === "monthly" ? plan.priceMonthly : plan.priceYearly;

      const sub = await client.criarAssinatura({
        customer: customerId,
        billingType: "UNDEFINED", // cliente escolhe PIX/boleto/cartão
        value: value / 100, // Asaas usa BRL, não centavos
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
   * Trocar plano = nova assinatura. Cancela a antiga (se houver) e cria a nova.
   * Não exige CPF de novo (customer já existe no Asaas).
   */
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

      // Em changePlan o customer já existe (passou por createCheckout antes)
      const customerId = await garantirAsaasCustomer(
        ctx.user.id,
        ctx.user.email,
        ctx.user.name,
        "", // não precisa de CPF — customer já existe
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
