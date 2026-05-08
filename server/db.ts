import { eq, and, or, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, subscriptions, calculosHistorico, userCredits, InsertCalculoHistorico } from "../drizzle/schema";
import { PLANS } from "./billing/products";
import { createLogger } from "./_core/logger";
const log = createLogger("db");

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      log.warn({ err: String(error) }, "Failed to connect");
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    log.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod", "passwordHash", "googleSub"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      (values as Record<string, unknown>)[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    log.error({ err: String(error) }, "Failed to upsert user");
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/** Busca usuário por e-mail (case insensitive). Usado pelo login email/senha. */
export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;

  const normalized = email.trim().toLowerCase();
  const result = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/** Busca usuário pelo sub do Google. Usado pelo login Google. */
export async function getUserByGoogleSub(googleSub: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(users).where(eq(users.googleSub, googleSub)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Get active subscription for a user.
 */
export async function getActiveSubscription(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        or(eq(subscriptions.status, "active"), eq(subscriptions.status, "trialing"))
      )
    )
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Get all subscriptions for a user.
 */
export async function getUserSubscriptions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
}

/**
 * Get plan name from planId field or fallback.
 */
function getPlanName(planId: string | null): string {
  if (!planId) return "Plano";
  const plan = PLANS.find((p) => p.id === planId);
  return plan ? plan.name : "Plano";
}

/**
 * Get plan monthly price from planId.
 */
function getPlanPrice(planId: string | null): number {
  if (!planId) return 0;
  const plan = PLANS.find((p) => p.id === planId);
  return plan ? plan.priceMonthly : 0;
}

/**
 * Get all users with subscription status (admin).
 */
export async function getAllUsersWithSubscription() {
  const db = await getDb();
  if (!db) return [];

  const allUsersList = await db.select().from(users).orderBy(desc(users.createdAt));
  const activeSubs = await db
    .select()
    .from(subscriptions)
    .where(or(eq(subscriptions.status, "active"), eq(subscriptions.status, "trialing")));

  const activeUserIds = new Set<number>();
  activeSubs.forEach((s) => activeUserIds.add(s.userId));

  return allUsersList.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    hasActiveSubscription: activeUserIds.has(u.id),
    createdAt: u.createdAt,
    lastSignedIn: u.lastSignedIn,
  }));
}

/**
 * Get recent users (admin).
 */
export async function getRecentUsers(limit = 10) {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select()
    .from(users)
    .where(eq(users.role, "user"))
    .orderBy(desc(users.createdAt))
    .limit(limit);

  return result.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    createdAt: u.createdAt,
  }));
}

/**
 * Get recent subscriptions with user info (admin).
 */
export async function getRecentSubscriptions(limit = 10) {
  const db = await getDb();
  if (!db) return [];

  const allSubs = await db
    .select()
    .from(subscriptions)
    .orderBy(desc(subscriptions.createdAt))
    .limit(limit);

  // Build user map
  const usersList = await db.select().from(users);
  const userMap = new Map<number, string>();
  usersList.forEach((u) => {
    userMap.set(u.id, u.name || u.email || "—");
  });

  return allSubs.map((s) => ({
    id: s.id,
    userName: userMap.get(s.userId) || "—",
    planName: getPlanName(s.planId),
    status: s.status,
    currentPeriodEnd: s.currentPeriodEnd,
    createdAt: s.createdAt,
  }));
}

/**
 * Get all subscriptions with user info (admin).
 */
export async function getAllSubscriptionsWithUsers() {
  const db = await getDb();
  if (!db) return [];

  const allSubs = await db
    .select()
    .from(subscriptions)
    .orderBy(desc(subscriptions.createdAt));

  const usersList = await db.select().from(users);
  const userMap = new Map<number, string>();
  usersList.forEach((u) => {
    userMap.set(u.id, u.name || u.email || "—");
  });

  return allSubs.map((s) => ({
    id: s.id,
    userName: userMap.get(s.userId) || "—",
    planName: getPlanName(s.planId),
    priceAmount: getPlanPrice(s.planId),
    status: s.status,
    currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    createdAt: s.createdAt,
  }));
}

/**
 * Get comprehensive admin stats.
 */
export async function getAdminStats() {
  const db = await getDb();
  if (!db) {
    return {
      totalClients: 0,
      activeSubscriptions: 0,
      trialingSubscriptions: 0,
      mrr: 0,
      conversionRate: 0,
      newClientsThisMonth: 0,
      planBreakdown: { iniciante: 0, profissional: 0, escritorio: 0 },
    };
  }

  const allClients = await db.select().from(users).where(eq(users.role, "user"));
  const totalClients = allClients.length;

  const activeSubs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"));

  const trialingSubs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.status, "trialing"));

  const activeSubscriptions = activeSubs.length;
  const trialingSubscriptions = trialingSubs.length;

  let mrr = 0;
  const planBreakdown = { iniciante: 0, profissional: 0, escritorio: 0 };

  const allActiveSubs = activeSubs.concat(trialingSubs);
  for (const sub of allActiveSubs) {
    const pid = sub.planId || "iniciante";
    const plan = PLANS.find((p) => p.id === pid);
    if (plan) {
      mrr += plan.priceMonthly;
    } else {
      mrr += 9900;
    }
    if (pid === "iniciante") planBreakdown.iniciante++;
    else if (pid === "profissional") planBreakdown.profissional++;
    else if (pid === "escritorio") planBreakdown.escritorio++;
    else planBreakdown.iniciante++;
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const newClientsThisMonth = allClients.filter(
    (u) => new Date(u.createdAt) >= startOfMonth
  ).length;

  const conversionRate =
    totalClients > 0
      ? Math.round(((activeSubscriptions + trialingSubscriptions) / totalClients) * 100)
      : 0;

  return {
    totalClients,
    activeSubscriptions,
    trialingSubscriptions,
    mrr,
    conversionRate,
    newClientsThisMonth,
    planBreakdown,
  };
}

/** Legacy: get all users */
export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users);
}

// ─── Histórico de Cálculos ─────────────────────────────────────────────────────

/**
 * Registar um cálculo no histórico do utilizador.
 */
export async function registarCalculo(data: InsertCalculoHistorico): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(calculosHistorico).values(data);
  } catch (error) {
    log.error({ err: String(error) }, "Failed to register calculo");
  }
}

/**
 * Buscar histórico de cálculos recentes de um utilizador.
 */
export async function getCalculosRecentes(userId: number, limit = 5) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(calculosHistorico)
    .where(eq(calculosHistorico.userId, userId))
    .orderBy(desc(calculosHistorico.createdAt))
    .limit(limit);
}

/**
 * Buscar estatísticas de uso de um utilizador.
 */
export async function getEstatisticasUso(userId: number) {
  const db = await getDb();
  if (!db) return { totalCalculos: 0, totalPareceres: 0, porTipo: {} };

  const historico = await db
    .select()
    .from(calculosHistorico)
    .where(eq(calculosHistorico.userId, userId));

  const totalCalculos = historico.length;
  const totalPareceres = historico.filter((c) => c.temParecer).length;
  const porTipo: Record<string, number> = {};
  for (const c of historico) {
    porTipo[c.tipo] = (porTipo[c.tipo] || 0) + 1;
  }

  return { totalCalculos, totalPareceres, porTipo };
}

// ─── Créditos ──────────────────────────────────────────────────────────────────

/**
 * Buscar créditos do utilizador.
 * Funciona com OU sem assinatura ativa (suporta créditos avulsos e trial).
 */
export async function getUserCreditsInfo(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const sub = await getActiveSubscription(userId);

  const existing = await db
    .select()
    .from(userCredits)
    .where(eq(userCredits.userId, userId))
    .limit(1);

  // Com assinatura ativa
  if (sub) {
    const plan = PLANS.find((p) => p.id === sub.planId);
    const creditsLimit = plan?.creditsPerMonth ?? 10;

    if (existing.length === 0) {
      const resetAt = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
      await db.insert(userCredits).values({
        userId,
        creditsTotal: creditsLimit,
        creditsUsed: 0,
        resetAt,
      });
      return { creditsTotal: creditsLimit, creditsUsed: 0, creditsRemaining: creditsLimit, resetAt };
    }

    const rec = existing[0];

    const now = new Date();
    if (rec.resetAt && now > rec.resetAt) {
      const newResetAt = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
      await db
        .update(userCredits)
        .set({ creditsUsed: 0, creditsTotal: creditsLimit, resetAt: newResetAt })
        .where(eq(userCredits.userId, userId));
      return { creditsTotal: creditsLimit, creditsUsed: 0, creditsRemaining: creditsLimit, resetAt: newResetAt };
    }

    // Never decrease creditsTotal — preserves avulso credits bought on top
    const effectiveTotal = Math.max(rec.creditsTotal, creditsLimit);
    if (rec.creditsTotal < creditsLimit) {
      await db
        .update(userCredits)
        .set({ creditsTotal: creditsLimit })
        .where(eq(userCredits.userId, userId));
    }

    const creditsRemaining = Math.max(0, effectiveTotal - rec.creditsUsed);
    return { creditsTotal: effectiveTotal, creditsUsed: rec.creditsUsed, creditsRemaining, resetAt: rec.resetAt };
  }

  // Sem assinatura — verificar créditos avulsos / trial
  if (existing.length === 0) {
    // Primeiro acesso: dar 3 créditos grátis para testar
    await db.insert(userCredits).values({
      userId,
      creditsTotal: 3,
      creditsUsed: 0,
    });
    return { creditsTotal: 3, creditsUsed: 0, creditsRemaining: 3, resetAt: null };
  }

  const rec = existing[0];
  const creditsRemaining = Math.max(0, rec.creditsTotal - rec.creditsUsed);
  return { creditsTotal: rec.creditsTotal, creditsUsed: rec.creditsUsed, creditsRemaining, resetAt: null };
}

/**
 * Consumir um crédito ao realizar um cálculo.
 *
 * Após migration 0073: usa saldo unificado por escritório
 * (escritorio_creditos). user_credits fica deprecated mas é
 * atualizado em paralelo pra preservar dashboards legados que
 * ainda lêem dele (até refator de UI passar todos pro novo helper).
 */
export async function consumirCredito(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;

  // 1. Cobra do saldo unificado do escritório (fonte de verdade)
  try {
    const { getEscritorioPorUsuario } = await import("./escritorio/db-escritorio");
    const { consumirCreditosEscritorio } = await import("./billing/escritorio-creditos");

    const esc = await getEscritorioPorUsuario(userId);
    if (!esc) return false;

    await consumirCreditosEscritorio(esc.escritorio.id, userId, 1, "calculo", "Cálculo jurídico");
  } catch (err: any) {
    // PRECONDITION_FAILED = sem saldo
    if (err?.code === "PRECONDITION_FAILED") return false;
    throw err;
  }

  // 2. Espelha em user_credits pro UI legado mostrar coerente
  // (creditsUsed += 1). Não bloqueia: se falhar, log e segue.
  try {
    const credits = await getUserCreditsInfo(userId);
    if (credits) {
      await db
        .update(userCredits)
        .set({ creditsUsed: sql`${userCredits.creditsUsed} + 1` })
        .where(eq(userCredits.userId, userId));
    }
  } catch {
    /* legado, não-bloqueante */
  }

  return true;
}

/**
 * Adicionar créditos avulsos ao utilizador.
 */
export async function addCreditsToUser(userId: number, credits: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const existing = await db
    .select()
    .from(userCredits)
    .where(eq(userCredits.userId, userId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(userCredits).values({
      userId,
      creditsTotal: credits,
      creditsUsed: 0,
    });
  } else {
    await db
      .update(userCredits)
      .set({ creditsTotal: sql`${userCredits.creditsTotal} + ${credits}` })
      .where(eq(userCredits.userId, userId));
  }
}
