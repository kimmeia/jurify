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
import { getPlansResolved, getPlanByIdResolved } from "../billing/products-resolver";
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
 * Constrói a URL de sucesso para o callback do Asaas.
 *
 * A URL é montada a partir do `origin` da request (respeitando proxy
 * reverso como Railway). Aponta pra `/checkout/success` no frontend,
 * que vai detectar a ativação via polling e redirecionar pro dashboard.
 *
 * IMPORTANTE: o domínio precisa estar cadastrado nos dados comerciais
 * da conta Asaas (Configurações → Informações), senão o Asaas rejeita
 * a criação da assinatura com 400. Nesse caso o fallback em
 * `criarAssinaturaComFallback` tenta novamente sem o callback.
 *
 * Retorna null se não conseguir montar uma URL válida pública
 * (localhost, IP, etc) — o Asaas rejeita esses.
 */
function buildSuccessUrl(ctx: { req: any }): string | null {
  const req = ctx.req;
  const proto =
    req.headers?.["x-forwarded-proto"]?.toString().split(",")[0]?.trim() ||
    req.protocol ||
    "https";
  const host =
    req.headers?.["x-forwarded-host"]?.toString().split(",")[0]?.trim() ||
    req.headers?.host ||
    "";
  const origin =
    req.headers?.origin?.toString() ||
    (host ? `${proto}://${host}` : "");

  if (!origin) return null;

  // Asaas rejeita localhost e HTTP — só manda se for domínio público HTTPS
  const isLocalhost = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(origin);
  const isHttps = origin.startsWith("https://");
  if (isLocalhost || !isHttps) {
    log.warn(
      { origin },
      "Origin não é HTTPS público — não enviando callback ao Asaas",
    );
    return null;
  }

  return `${origin}/checkout/success`;
}

/**
 * Cria uma assinatura no Asaas. Se a chamada vier com `callback` e o
 * Asaas responder 400 (tipicamente porque o domínio do successUrl não
 * está cadastrado na conta Asaas), tenta novamente SEM o callback.
 *
 * Assim o usuário nunca fica travado — no pior caso, a assinatura é
 * criada mas o auto-redirect não funciona (o cliente tem que voltar
 * manualmente pro sistema).
 */
async function criarAssinaturaComFallback(
  client: { criarAssinatura: (input: any) => Promise<any> },
  input: any,
) {
  try {
    return await client.criarAssinatura(input);
  } catch (err: any) {
    const msg = err?.message || "";
    // Se for 400 e tem callback no input, tenta sem
    if (input.callback && /rejeitou criarAssinatura \(400/.test(msg)) {
      log.warn(
        { err: msg, successUrl: input.callback.successUrl },
        "Asaas rejeitou callback.successUrl — tentando sem callback (domínio provavelmente não cadastrado no Asaas)",
      );
      const { callback, ...inputSemCallback } = input;
      return await client.criarAssinatura(inputSemCallback);
    }
    throw err;
  }
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
  plans: publicProcedure.query(async () => {
    const plans = await getPlansResolved(false); // só os visíveis
    return plans.map((p) => ({
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
      const plan = await getPlanByIdResolved(input.planId);
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

      const successUrl = buildSuccessUrl(ctx);
      const sub = await criarAssinaturaComFallback(client, {
        customer: customerId,
        billingType: "UNDEFINED", // cliente escolhe PIX/boleto/cartão
        value: value / 100, // Asaas usa BRL, não centavos
        nextDueDate: dataVencimentoPadrao(),
        cycle: input.interval === "monthly" ? "MONTHLY" : "YEARLY",
        description: `${plan.name} — Jurify SaaS`,
        externalReference: `${ctx.user.id}:${input.planId}`,
        // Redirect automático após pagamento (PIX/cartão). Boleto não
        // redireciona porque a confirmação é assíncrona.
        // Se successUrl for null (localhost) ou Asaas rejeitar (domínio
        // não cadastrado), o fallback retenta sem callback.
        ...(successUrl ? { callback: { successUrl, autoRedirect: true } } : {}),
      });

      // ─── CRIAR ROW LOCAL IMEDIATAMENTE ────────────────────────────────
      // Antes esperávamos o webhook SUBSCRIPTION_CREATED chegar pra inserir
      // a row local. Mas isso criava uma race condition: se o usuário
      // pagasse rápido (PIX), o webhook PAYMENT_CONFIRMED chegava PRIMEIRO,
      // não encontrava a row local, e apenas logava warning — a assinatura
      // nunca era ativada.
      //
      // Agora inserimos a row imediatamente com status "incomplete". Os
      // webhooks subsequentes vão ATUALIZAR (não inserir) — o que é
      // idempotente e sem race.
      const db = await getDb();
      if (db) {
        const existingLocal = await db
          .select()
          .from(subscriptionsTable)
          .where(eq(subscriptionsTable.asaasSubscriptionId, sub.id))
          .limit(1);
        if (existingLocal.length === 0) {
          await db.insert(subscriptionsTable).values({
            userId: ctx.user.id,
            asaasSubscriptionId: sub.id,
            asaasCustomerId: customerId,
            planId: input.planId,
            status: "incomplete", // aguarda primeiro pagamento
          });
          log.info(
            { userId: ctx.user.id, subId: sub.id },
            "Row local criada como incomplete",
          );
        }
      }

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
      const newPlan = await getPlanByIdResolved(input.newPlanId);
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

      const successUrl = buildSuccessUrl(ctx);
      const sub = await criarAssinaturaComFallback(client, {
        customer: customerId,
        billingType: "UNDEFINED",
        value: value / 100,
        nextDueDate: dataVencimentoPadrao(),
        cycle: input.interval === "monthly" ? "MONTHLY" : "YEARLY",
        description: `${newPlan.name} — Jurify SaaS`,
        externalReference: `${ctx.user.id}:${input.newPlanId}`,
        ...(successUrl ? { callback: { successUrl, autoRedirect: true } } : {}),
      });

      // Cria row local imediatamente (mesma lógica do createCheckout)
      const db2 = await getDb();
      if (db2) {
        const existingLocal = await db2
          .select()
          .from(subscriptionsTable)
          .where(eq(subscriptionsTable.asaasSubscriptionId, sub.id))
          .limit(1);
        if (existingLocal.length === 0) {
          await db2.insert(subscriptionsTable).values({
            userId: ctx.user.id,
            asaasSubscriptionId: sub.id,
            asaasCustomerId: customerId,
            planId: input.newPlanId,
            status: "incomplete",
          });
        }
      }

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
