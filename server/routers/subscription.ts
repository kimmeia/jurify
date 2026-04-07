/**
 * Router — Assinaturas e Stripe Checkout
 *
 * Responsável por: listar planos disponíveis, criar checkout sessions
 * (subscription e one-time), cancelar/reativar/trocar plano.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getActiveSubscription, getUserSubscriptions, getDb } from "../db";
import { getStripe } from "../stripe/index";
import { PLANS } from "../stripe/products";
import { subscriptions as subscriptionsTable } from "../../drizzle/schema";

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

  /** Create Stripe Checkout Session */
  createCheckout: protectedProcedure
    .input(
      z.object({
        planId: z.string(),
        interval: z.enum(["monthly", "yearly"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      const plan = PLANS.find((p) => p.id === input.planId);
      if (!plan) throw new Error("Plano não encontrado");

      const origin = ctx.req.headers.origin || ctx.req.headers.referer || "";

      // Avulso = one-time payment
      if (plan.isOneTime) {
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          customer_email: ctx.user.email ?? undefined,
          client_reference_id: ctx.user.id.toString(),
          metadata: {
            user_id: ctx.user.id.toString(),
            plan_id: input.planId,
            credits_to_add: "1",
          },
          line_items: [
            {
              price_data: {
                currency: plan.currency,
                product_data: {
                  name: `${plan.name} - Cálculo Avulso`,
                  description: plan.description,
                },
                unit_amount: plan.priceMonthly,
              },
              quantity: 1,
            },
          ],
          success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/plans`,
        });
        return { url: session.url };
      }

      // Subscription plans
      const price = input.interval === "monthly" ? plan.priceMonthly : plan.priceYearly;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        customer_email: ctx.user.email ?? undefined,
        client_reference_id: ctx.user.id.toString(),
        metadata: {
          user_id: ctx.user.id.toString(),
          customer_email: ctx.user.email ?? "",
          customer_name: ctx.user.name ?? "",
          plan_id: input.planId,
        },
        line_items: [
          {
            price_data: {
              currency: plan.currency,
              product_data: {
                name: `${plan.name} - SaaS de Cálculos`,
                description: plan.description,
              },
              unit_amount: price,
              recurring: {
                interval: input.interval === "monthly" ? "month" : "year",
              },
            },
            quantity: 1,
          },
        ],
        allow_promotion_codes: true,
        success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/plans`,
      });

      return { url: session.url };
    }),

  /** Cancel subscription at period end */
  cancel: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await getActiveSubscription(ctx.user.id);
    if (!sub) throw new Error("Nenhuma assinatura ativa encontrada.");

    const stripe = getStripe();
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    const db = await getDb();
    if (db) {
      await db
        .update(subscriptionsTable)
        .set({ cancelAtPeriodEnd: true })
        .where(eq(subscriptionsTable.id, sub.id));
    }

    return { success: true };
  }),

  /** Reactivate canceled subscription */
  reactivate: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await getActiveSubscription(ctx.user.id);
    if (!sub) throw new Error("Nenhuma assinatura encontrada.");

    const stripe = getStripe();
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    const db = await getDb();
    if (db) {
      await db
        .update(subscriptionsTable)
        .set({ cancelAtPeriodEnd: false })
        .where(eq(subscriptionsTable.id, sub.id));
    }

    return { success: true };
  }),

  /** Change plan (upgrade/downgrade) */
  changePlan: protectedProcedure
    .input(
      z.object({
        newPlanId: z.string(),
        interval: z.enum(["monthly", "yearly"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      const newPlan = PLANS.find((p) => p.id === input.newPlanId);
      if (!newPlan) throw new Error("Plano não encontrado");
      if (newPlan.isOneTime) throw new Error("Use a opção de compra avulsa.");

      const currentSub = await getActiveSubscription(ctx.user.id);
      const origin = ctx.req.headers.origin || ctx.req.headers.referer || "";
      const price = input.interval === "monthly" ? newPlan.priceMonthly : newPlan.priceYearly;

      const metadata: Record<string, string> = {
        user_id: ctx.user.id.toString(),
        plan_id: input.newPlanId,
      };
      if (currentSub) {
        metadata.cancel_old_subscription = currentSub.stripeSubscriptionId;
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        customer_email: ctx.user.email ?? undefined,
        client_reference_id: ctx.user.id.toString(),
        metadata,
        line_items: [
          {
            price_data: {
              currency: newPlan.currency,
              product_data: {
                name: `${newPlan.name} - SaaS de Cálculos`,
                description: newPlan.description,
              },
              unit_amount: price,
              recurring: {
                interval: input.interval === "monthly" ? "month" : "year",
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/plans`,
      });

      return { url: session.url };
    }),
});
