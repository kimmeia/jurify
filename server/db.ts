import { eq, and, or, desc, sql, like, inArray, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, subscriptions, calculosHistorico, userCredits, InsertCalculoHistorico, escritorios, colaboradores } from "../drizzle/schema";
import { PLANS } from "./billing/products";
import { createLogger } from "./_core/logger";
import { escapeLikePattern } from "./_core/sql-helpers";
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
 * Sub é considerada com acesso ativo quando:
 *   - cortesia=true E (cortesiaExpiraEm é null OU ainda não passou), OU
 *   - status='active', OU
 *   - status='trialing' E (trialExpiraEm é null OU ainda não passou)
 *
 * Cortesia tem prioridade sobre status — admin pode conceder acesso a um
 * cliente cuja assinatura está canceled/past_due no Asaas, por exemplo.
 *
 * Defesa em profundidade pro trial: mesmo que o cron de expiração não tenha
 * rodado ainda (status ainda é 'trialing'), respeitamos trialExpiraEm aqui.
 */
export function temAcessoAtivo(sub: Pick<
  typeof subscriptions.$inferSelect,
  "status" | "cortesia" | "cortesiaExpiraEm" | "trialExpiraEm"
>): boolean {
  if (sub.cortesia) {
    if (sub.cortesiaExpiraEm == null) return true;
    return sub.cortesiaExpiraEm > Date.now();
  }
  if (sub.status === "active") return true;
  if (sub.status === "trialing") {
    return sub.trialExpiraEm == null || sub.trialExpiraEm > Date.now();
  }
  return false;
}

/**
 * Get active subscription for a user.
 *
 * Inclui cortesia: se o user tem uma sub marcada como cortesia e ainda
 * dentro do prazo, ela é retornada mesmo se `status` não for 'active'.
 */
export async function getActiveSubscription(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const todas = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));

  // Cortesia tem prioridade — se houver, retorna ela
  const cortesia = todas.find((s) =>
    temAcessoAtivo({
      status: s.status,
      cortesia: s.cortesia,
      cortesiaExpiraEm: s.cortesiaExpiraEm,
      trialExpiraEm: s.trialExpiraEm,
    }) && s.cortesia,
  );
  if (cortesia) return cortesia;

  // Senão, comportamento normal: active OU trialing ainda não expirado.
  // Usa temAcessoAtivo pra centralizar a regra (evita duplicar a checagem
  // de trialExpiraEm aqui).
  const ativa = todas.find((s) =>
    temAcessoAtivo({
      status: s.status,
      cortesia: s.cortesia,
      cortesiaExpiraEm: s.cortesiaExpiraEm,
      trialExpiraEm: s.trialExpiraEm,
    })
  );
  return ativa ?? null;
}

/**
 * Núcleo testável: dado um lookup de sub e um lookup de owner do escritório,
 * decide se herda do dono. Lógica pura — sem acessar `getDb` direto, o que
 * permite testar com mocks simples (sem precisar mockar o builder drizzle).
 */
export async function resolveSubscriptionComHeranca(
  userId: number,
  getSubscription: (uid: number) => Promise<any>,
  getEscritorioOwnerByColaborador: (uid: number) => Promise<number | null>,
) {
  const propria = await getSubscription(userId);
  if (propria) return propria;

  const ownerId = await getEscritorioOwnerByColaborador(userId);
  if (ownerId == null || ownerId === userId) return null;

  return getSubscription(ownerId);
}

/**
 * Resolve a sub ativa do user OU, se ele for colaborador, herda a sub do
 * DONO do escritório. Cortesia/plano do dono libera todos os colaboradores
 * — alinhado ao modelo de uso (créditos e limites já são por escritório).
 *
 * Ordem de resolução:
 *  1. Sub própria do user (cortesia primeiro, depois active/trialing)
 *  2. Se user é colaborador de algum escritório, busca sub do dono desse
 *     escritório usando a mesma lógica
 *
 * Retorna null se nem o user nem o dono têm sub ativa.
 *
 * Guarda contra loop: se ownerId == userId (caso patológico), não recursa.
 */
export async function getActiveSubscriptionComHeranca(userId: number) {
  return resolveSubscriptionComHeranca(
    userId,
    (uid) => getActiveSubscription(uid),
    async (uid) => {
      const db = await getDb();
      if (!db) return null;
      const [colab] = await db
        .select({ escritorioId: colaboradores.escritorioId })
        .from(colaboradores)
        .where(eq(colaboradores.userId, uid))
        .limit(1);
      if (!colab) return null;
      const [esc] = await db
        .select({ ownerId: escritorios.ownerId })
        .from(escritorios)
        .where(eq(escritorios.id, colab.escritorioId))
        .limit(1);
      return esc?.ownerId ?? null;
    },
  );
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
 *
 * Distingue 3 tipos de usuário pra UI do painel admin:
 *   - "admin": staff JuridFlow (users.role === "admin")
 *   - "cliente": dono de escritório (escritorios.ownerId === user.id)
 *   - "colaborador": membro de escritório de outro user (linha em
 *     `colaboradores` ativa, mas NÃO é dono de escritório)
 *
 * Pra "colaborador", retorna `escritorioVinculado` (nome) e
 * `cargoColaborador` pro frontend mostrar no tooltip.
 */
export interface GetAllUsersOpts {
  limit?: number;
  offset?: number;
  busca?: string;
  tipo?: "admin" | "cliente" | "colaborador" | "todos";
}

/**
 * Lista paginada de users com info de subscription + escritório vinculado.
 *
 * Antes: SELECT * FROM users (sem limit) + N queries auxiliares + JOIN em
 * JS. Quebrava conforme a base crescia — admin abria /admin/clients e a
 * tela travava porque o backend devolvia toda a coleção numa request só.
 *
 * Agora: paginação no SQL com LIMIT/OFFSET, filtro por busca (LIKE
 * escapado) e filtro por tipo aplicado em subqueries no banco. Queries
 * auxiliares (subscriptions, escritórios, colaboradores) também limitam
 * o input via `IN (...userIdsDaPagina)` — evita carregar dados que não
 * serão exibidos.
 *
 * Retorna `{ itens, total }` pra UI conseguir mostrar contador e pager.
 */
export async function getAllUsersWithSubscription(opts: GetAllUsersOpts = {}): Promise<{
  itens: Array<{
    id: number;
    name: string | null;
    email: string | null;
    role: "user" | "admin";
    hasActiveSubscription: boolean;
    createdAt: Date;
    lastSignedIn: Date;
    tipoUsuario: "admin" | "cliente" | "colaborador";
    escritorioVinculado: string | null;
    cargoColaborador: string | null;
    colaboradoresCount: number;
    planId: string | null;
    subStatus: string | null;
  }>;
  total: number;
}> {
  const db = await getDb();
  if (!db) return { itens: [], total: 0 };

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const tipo = opts.tipo ?? "todos";

  const conds: any[] = [];
  if (opts.busca && opts.busca.trim()) {
    const b = `%${escapeLikePattern(opts.busca.trim())}%`;
    conds.push(or(like(users.name, b), like(users.email, b)));
  }
  if (tipo === "admin") {
    conds.push(eq(users.role, "admin"));
  } else if (tipo === "cliente") {
    // Dono de escritório (registrado em escritorios.ownerId)
    conds.push(inArray(users.id, db.select({ id: escritorios.ownerId }).from(escritorios)));
  } else if (tipo === "colaborador") {
    // Está em colaboradores ativos MAS não é dono de nenhum escritório.
    // Evita classificar dupla quando user é dono de A e colab em B.
    conds.push(inArray(
      users.id,
      db.select({ id: colaboradores.userId }).from(colaboradores).where(eq(colaboradores.ativo, true)),
    ));
    conds.push(notInArray(
      users.id,
      db.select({ id: escritorios.ownerId }).from(escritorios),
    ));
  }
  const whereClause = conds.length > 0 ? and(...conds) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(users)
    .where(whereClause);

  const allUsersList = await db
    .select(USERS_PUBLIC_COLUMNS)
    .from(users)
    .where(whereClause)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);

  if (allUsersList.length === 0) {
    return { itens: [], total: Number(total) };
  }

  const userIds = allUsersList.map((u) => u.id);

  // Subqueries auxiliares restritas aos userIds desta página (não carrega
  // o universo inteiro de subscriptions/escritórios/colaboradores).
  const activeSubs = await db
    .select({ userId: subscriptions.userId, status: subscriptions.status, planId: subscriptions.planId })
    .from(subscriptions)
    .where(and(
      inArray(subscriptions.userId, userIds),
      or(eq(subscriptions.status, "active"), eq(subscriptions.status, "trialing")),
    ));
  const activeUserIds = new Set<number>(activeSubs.map((s) => s.userId));
  const subInfoMap = new Map<number, { status: string; planId: string | null }>();
  for (const s of activeSubs) {
    if (!subInfoMap.has(s.userId)) subInfoMap.set(s.userId, { status: s.status, planId: s.planId });
  }

  const escritoriosOwned = await db
    .select({ id: escritorios.id, ownerId: escritorios.ownerId, nome: escritorios.nome })
    .from(escritorios)
    .where(inArray(escritorios.ownerId, userIds));
  const ownersMap = new Map<number, string>();
  const escritorioIdByOwner = new Map<number, number>();
  for (const e of escritoriosOwned) {
    ownersMap.set(e.ownerId, e.nome);
    escritorioIdByOwner.set(e.ownerId, e.id);
  }

  // Contagem de colaboradores ativos por escritório (só dos donos desta página).
  const escritorioIds = escritoriosOwned.map((e) => e.id);
  const colabsCountMap = new Map<number, number>();
  if (escritorioIds.length > 0) {
    const counts = await db
      .select({ escritorioId: colaboradores.escritorioId, total: sql<number>`COUNT(*)` })
      .from(colaboradores)
      .where(and(inArray(colaboradores.escritorioId, escritorioIds), eq(colaboradores.ativo, true)))
      .groupBy(colaboradores.escritorioId);
    for (const c of counts) colabsCountMap.set(c.escritorioId, Number(c.total));
  }

  const colabsAtivos = await db
    .select({
      userId: colaboradores.userId,
      cargo: colaboradores.cargo,
      escritorioNome: escritorios.nome,
    })
    .from(colaboradores)
    .leftJoin(escritorios, eq(escritorios.id, colaboradores.escritorioId))
    .where(and(inArray(colaboradores.userId, userIds), eq(colaboradores.ativo, true)));
  // Um user pode estar em mais de um escritório como colaborador — pegamos
  // o primeiro (caso raro; aceitar limitação por enquanto).
  const colabsMap = new Map<number, { cargo: string; escritorioNome: string | null }>();
  for (const c of colabsAtivos) {
    if (!colabsMap.has(c.userId)) {
      colabsMap.set(c.userId, { cargo: c.cargo, escritorioNome: c.escritorioNome });
    }
  }

  const itens = allUsersList.map((u) => {
    const escritorioOwned = ownersMap.get(u.id) ?? null;
    const colab = colabsMap.get(u.id);
    let tipoUsuario: "admin" | "cliente" | "colaborador" = "cliente";
    let escritorioVinculado: string | null = null;
    let cargoColaborador: string | null = null;

    if (u.role === "admin") {
      tipoUsuario = "admin";
    } else if (escritorioOwned) {
      tipoUsuario = "cliente";
      escritorioVinculado = escritorioOwned;
    } else if (colab) {
      tipoUsuario = "colaborador";
      escritorioVinculado = colab.escritorioNome;
      cargoColaborador = colab.cargo;
    }

    const escId = escritorioIdByOwner.get(u.id);
    const subInfo = subInfoMap.get(u.id);

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      hasActiveSubscription: activeUserIds.has(u.id),
      createdAt: u.createdAt,
      lastSignedIn: u.lastSignedIn,
      tipoUsuario,
      escritorioVinculado,
      cargoColaborador,
      colaboradoresCount: escId != null ? (colabsCountMap.get(escId) ?? 0) : 0,
      planId: subInfo?.planId ?? null,
      subStatus: subInfo?.status ?? null,
    };
  });

  return { itens, total: Number(total) };
}

/**
 * Get recent users (admin).
 */
export async function getRecentUsers(limit = 10) {
  const db = await getDb();
  if (!db) return [];

  // "Novos clientes" = donos de escritório (não colaboradores). Antes listava
  // qualquer role=user, então um colaborador recém-adicionado aparecia como
  // cliente novo.
  const result = await db
    .select()
    .from(users)
    .where(and(
      eq(users.role, "user"),
      inArray(users.id, db.select({ id: escritorios.ownerId }).from(escritorios)),
    ))
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

  // Build user map. Projeção explícita — antes era SELECT * que trazia
  // passwordHash desnecessariamente (só usamos name + email).
  const userIdsSubs = Array.from(new Set(allSubs.map((s) => s.userId)));
  const usersList = userIdsSubs.length === 0
    ? []
    : await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, userIdsSubs));
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
export interface GetAllSubscriptionsOpts {
  limit?: number;
  offset?: number;
  busca?: string;
  status?: string;
}

/**
 * Lista paginada de subscriptions enriquecida com nome do user.
 *
 * Antes: SELECT * FROM subscriptions + SELECT * FROM users (sem limit) +
 * JOIN em JS. Quebrava conforme as bases cresciam.
 *
 * Agora: LIMIT/OFFSET no SQL, filtro de busca por nome/email do user via
 * subquery `userId IN (SELECT id FROM users WHERE name LIKE ... OR email LIKE ...)`.
 * Query do `userMap` agora limita a `userId IN (...subsDaPagina)`.
 */
export async function getAllSubscriptionsWithUsers(opts: GetAllSubscriptionsOpts = {}): Promise<{
  itens: Array<{
    id: number;
    userId: number;
    userName: string;
    planName: string;
    priceAmount: number;
    status: string;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean | null;
    cortesia: boolean | null;
    cortesiaMotivo: string | null;
    cortesiaExpiraEm: number | null;
    createdAt: Date;
  }>;
  total: number;
}> {
  const db = await getDb();
  if (!db) return { itens: [], total: 0 };

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const conds: any[] = [];
  if (opts.status && opts.status !== "all") {
    // Cast pra any porque o status é mysqlEnum estrito mas a UI passa string
    // genérica (o input do tRPC já valida com z.string()).
    conds.push(eq(subscriptions.status, opts.status as any));
  }
  if (opts.busca && opts.busca.trim()) {
    const b = `%${escapeLikePattern(opts.busca.trim())}%`;
    // Subquery: busca pelo nome/email do user dono da assinatura.
    conds.push(inArray(
      subscriptions.userId,
      db.select({ id: users.id }).from(users).where(or(like(users.name, b), like(users.email, b))),
    ));
  }
  const whereClause = conds.length > 0 ? and(...conds) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(subscriptions)
    .where(whereClause);

  const allSubs = await db
    .select()
    .from(subscriptions)
    .where(whereClause)
    .orderBy(desc(subscriptions.createdAt))
    .limit(limit)
    .offset(offset);

  if (allSubs.length === 0) {
    return { itens: [], total: Number(total) };
  }

  const userIds = Array.from(new Set(allSubs.map((s) => s.userId)));
  // Só os campos necessários — passwordHash NÃO precisa nem deve sair daqui.
  const usersList = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, userIds));
  const userMap = new Map<number, string>();
  usersList.forEach((u) => {
    userMap.set(u.id, u.name || u.email || "—");
  });

  const itens = allSubs.map((s) => ({
    id: s.id,
    userId: s.userId,
    userName: userMap.get(s.userId) || "—",
    planName: getPlanName(s.planId),
    priceAmount: getPlanPrice(s.planId),
    status: s.status,
    currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    cortesia: s.cortesia,
    cortesiaMotivo: s.cortesiaMotivo,
    cortesiaExpiraEm: s.cortesiaExpiraEm,
    createdAt: s.createdAt,
  }));

  return { itens, total: Number(total) };
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
      pastDueSubscriptions: 0,
      mrr: 0,
      conversionRate: 0,
      newClientsThisMonth: 0,
      planBreakdown: { basico: 0, intermediario: 0, completo: 0 },
    };
  }

  // Cliente = dono de escritório (assinante). Colaboradores ficam dentro do
  // cadastro do dono e NÃO contam como clientes separados — é a definição da
  // tela Admin > Clientes. Antes contava todo `role=user` (donos +
  // colaboradores + cadastros soltos), inflando o total.
  const donoUsers = await db
    .select({ id: users.id, createdAt: users.createdAt })
    .from(users)
    .where(and(
      eq(users.role, "user"),
      inArray(users.id, db.select({ id: escritorios.ownerId }).from(escritorios)),
    ));
  const totalClients = donoUsers.length;

  const activeSubs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"));

  const trialingSubs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.status, "trialing"));

  const [pastDueRow] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(subscriptions)
    .where(eq(subscriptions.status, "past_due"));
  const pastDueSubscriptions = Number(pastDueRow?.c ?? 0);

  const activeSubscriptions = activeSubs.length;
  const trialingSubscriptions = trialingSubs.length;

  let mrr = 0;
  const planBreakdown = { basico: 0, intermediario: 0, completo: 0 };

  const allActiveSubs = activeSubs.concat(trialingSubs);
  for (const sub of allActiveSubs) {
    const pid = sub.planId || "basico";
    const plan = PLANS.find((p) => p.id === pid);
    if (plan) {
      mrr += plan.priceMonthly;
    } else {
      mrr += 9700;
    }
    if (pid === "basico") planBreakdown.basico++;
    else if (pid === "intermediario") planBreakdown.intermediario++;
    else if (pid === "completo") planBreakdown.completo++;
    else planBreakdown.basico++;
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const newClientsThisMonth = donoUsers.filter(
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
    pastDueSubscriptions,
    mrr,
    conversionRate,
    newClientsThisMonth,
    planBreakdown,
  };
}

/**
 * Colunas seguras de `users` pra retornar em APIs admin. EXCLUI
 * `passwordHash` — não deve sair do servidor nem mesmo pra admin (era
 * leakage real antes do fix: select().from(users) trazia o hash de
 * scrypt junto, exposto na response).
 */
const USERS_PUBLIC_COLUMNS = {
  id: users.id,
  openId: users.openId,
  name: users.name,
  email: users.email,
  googleSub: users.googleSub,
  loginMethod: users.loginMethod,
  role: users.role,
  asaasCustomerId: users.asaasCustomerId,
  bloqueado: users.bloqueado,
  motivoBloqueio: users.motivoBloqueio,
  bloqueadoEm: users.bloqueadoEm,
  aceitouTermosEm: users.aceitouTermosEm,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  lastSignedIn: users.lastSignedIn,
} as const;

/** Legacy: get all users (sem passwordHash). */
export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select(USERS_PUBLIC_COLUMNS).from(users);
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
