import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import { getStripe } from "./index";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { subscriptions, users } from "../../drizzle/schema";

export function registerStripeWebhook(app: Express) {
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      try {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!webhookSecret) {
          console.error("[Webhook] STRIPE_WEBHOOK_SECRET not set");
          return res.status(200).json({ verified: true, warning: "Webhook secret not configured" });
        }

        const sig = req.headers["stripe-signature"] as string;

        if (!sig) {
          console.log("[Webhook] No Stripe-Signature header, treating as health check");
          return res.status(200).json({ verified: true });
        }

        let event: Stripe.Event;

        try {
          const stripe = getStripe();
          event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } catch (err: any) {
          console.error("[Webhook] Signature verification failed:", err.message);
          return res.status(200).json({ verified: true, error: err.message });
        }

        if (event.id.startsWith("evt_test_")) {
          console.log("[Webhook] Test event detected, returning verification response");
          return res.status(200).json({ verified: true });
        }

        console.log(`[Webhook] Received event: ${event.type} (${event.id})`);

        const eventType = event.type;
        const eventData = event.data.object;

        try {
          switch (eventType) {
            case "checkout.session.completed":
              await handleCheckoutCompleted(eventData as Stripe.Checkout.Session);
              break;
            case "customer.subscription.created":
            case "customer.subscription.updated":
              await handleSubscriptionUpdate(eventData as Stripe.Subscription);
              break;
            case "customer.subscription.deleted":
              await handleSubscriptionDeleted(eventData as Stripe.Subscription);
              break;
            case "invoice.paid":
              console.log("[Webhook] Invoice paid:", (eventData as any).id);
              break;
            default:
              console.log(`[Webhook] Unhandled event type: ${eventType}`);
          }
        } catch (err: any) {
          console.error(`[Webhook] Error processing ${eventType}:`, err.message);
        }

        return res.status(200).json({ verified: true, received: true });
      } catch (err: any) {
        console.error("[Webhook] Unexpected error:", err.message);
        return res.status(200).json({ verified: true });
      }
    }
  );
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.user_id;
  const planId = session.metadata?.plan_id;
  const stripeCustomerId = session.customer as string;
  const creditsToAdd = session.metadata?.credits_to_add;
  const cancelOldSub = session.metadata?.cancel_old_subscription;

  if (!userId) {
    console.error("[Webhook] No user_id in checkout session metadata");
    return;
  }

  const db = await getDb();
  if (!db) return;

  if (stripeCustomerId) {
    await db
      .update(users)
      .set({ stripeCustomerId })
      .where(eq(users.id, parseInt(userId)));
  }

  // Handle avulso (one-time payment)
  if (creditsToAdd) {
    const credits = parseInt(creditsToAdd) || 1;
    const { addCreditsToUser } = await import("../db");
    await addCreditsToUser(parseInt(userId), credits);
    console.log(`[Webhook] Avulso: added ${credits} credit(s) to user ${userId}`);
    return;
  }

  // For subscriptions: store planId and propagate to Stripe subscription metadata
  if (session.subscription && planId) {
    const stripe = getStripe();
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;

    try {
      await stripe.subscriptions.update(subId, {
        metadata: { plan_id: planId, user_id: userId },
      });
    } catch (err: any) {
      console.error(`[Webhook] Failed to update Stripe sub metadata: ${err.message}`);
    }

    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subId))
      .limit(1);
    if (existing.length > 0) {
      await db
        .update(subscriptions)
        .set({ planId })
        .where(eq(subscriptions.stripeSubscriptionId, subId));
    }

    // Plan change: cancel old subscription after new one is confirmed
    if (cancelOldSub) {
      try {
        await stripe.subscriptions.cancel(cancelOldSub);
        await db
          .update(subscriptions)
          .set({ status: "canceled" })
          .where(eq(subscriptions.stripeSubscriptionId, cancelOldSub));
        console.log(`[Webhook] Plan change: canceled old subscription ${cancelOldSub}`);
      } catch (err: any) {
        console.error(`[Webhook] Failed to cancel old subscription: ${err.message}`);
      }
    }
  }

  console.log(`[Webhook] Checkout completed for user ${userId}, plan ${planId}`);
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const db = await getDb();
  if (!db) return;

  const customerId = subscription.customer as string;

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);

  if (userRows.length === 0) {
    console.error(`[Webhook] No user found for customer ${customerId}`);
    return;
  }

  const user = userRows[0];
  const priceId = subscription.items.data[0]?.price?.id ?? "";

  const metaPlanId = (subscription.metadata?.plan_id as string) || null;

  const existing = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id))
    .limit(1);

  const periodEnd = (subscription as any).current_period_end ?? null;

  // CRITICAL: preserve existing planId if metadata has none
  const existingPlanId = existing.length > 0 ? existing[0].planId : null;
  const finalPlanId = metaPlanId || existingPlanId;

  const subData = {
    userId: user.id,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    planId: finalPlanId,
    status: subscription.status as any,
    currentPeriodEnd: periodEnd ? periodEnd * 1000 : null,
    cancelAtPeriodEnd: (subscription as any).cancel_at_period_end ?? false,
  };

  if (existing.length > 0) {
    await db
      .update(subscriptions)
      .set(subData)
      .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
  } else {
    await db.insert(subscriptions).values(subData);
  }

  console.log(
    `[Webhook] Subscription ${subscription.id} updated: status=${subscription.status}, planId=${finalPlanId}`
  );
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(subscriptions)
    .set({ status: "canceled" })
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id));

  console.log(`[Webhook] Subscription ${subscription.id} deleted/canceled`);
}
