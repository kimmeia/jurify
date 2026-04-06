import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import { getStripe } from "./index";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { subscriptions, users } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("stripe-webhook");

export function registerStripeWebhook(app: Express) {
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      try {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!webhookSecret) {
          log.error("STRIPE_WEBHOOK_SECRET not set — rejecting request");
          return res.status(500).json({ error: "Webhook secret not configured" });
        }

        const sig = req.headers["stripe-signature"] as string;

        if (!sig) {
          return res.status(400).json({ error: "Missing Stripe-Signature header" });
        }

        let event: Stripe.Event;

        try {
          const stripe = getStripe();
          event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } catch (err: any) {
          log.error({ err: err.message }, "Signature verification failed");
          return res.status(400).json({ error: "Invalid signature" });
        }

        if (event.id.startsWith("evt_test_")) {
          log.debug({ eventId: event.id }, "Test event detected");
          return res.status(200).json({ verified: true });
        }

        log.info({ eventType: event.type, eventId: event.id }, "Received event");

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
              log.info({ invoiceId: (eventData as any).id }, "Invoice paid");
              break;
            default:
              log.debug({ eventType }, "Unhandled event type");
          }
        } catch (err: any) {
          log.error({ err: err.message, eventType }, "Error processing event");
        }

        return res.status(200).json({ verified: true, received: true });
      } catch (err: any) {
        log.error({ err: err.message }, "Unexpected webhook error");
        return res.status(500).json({ error: "Internal webhook error" });
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
    log.error("No user_id in checkout session metadata");
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
    log.info({ userId, credits }, "Avulso: credits added");
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
      log.error({ err: err.message }, "Failed to update Stripe sub metadata");
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
        log.info({ cancelOldSub }, "Plan change: canceled old subscription");
      } catch (err: any) {
        log.error({ err: err.message }, "Failed to cancel old subscription");
      }
    }
  }

  log.info({ userId, planId }, "Checkout completed");
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
    log.error({ customerId }, "No user found for customer");
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

  log.info({ subscriptionId: subscription.id, status: subscription.status, planId: finalPlanId }, "Subscription updated");
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(subscriptions)
    .set({ status: "canceled" })
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id));

  log.info({ subscriptionId: subscription.id }, "Subscription deleted/canceled");
}
