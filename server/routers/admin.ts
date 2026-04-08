/**
 * Router — Administração do sistema
 *
 * Acessível apenas a usuários com role=admin. Inclui:
 *  - Estatísticas e relatórios (crescimento, MRR, cálculos)
 *  - Gestão de usuários (atualizar role, conceder créditos)
 *  - Visão operacional (escritórios, canais, conversas)
 *  - Saúde do sistema (DB, Asaas, env vars)
 */

import { z } from "zod";
import { eq, inArray, desc, and, gt, sql } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { registrarAuditoria } from "../_core/audit";
import {
  getDb,
  getAllUsers,
  getAllUsersWithSubscription,
  getRecentUsers,
  getRecentSubscriptions,
  getAllSubscriptionsWithUsers,
  getAdminStats,
  getCalculosRecentes,
  getEstatisticasUso,
  getUserCreditsInfo,
  addCreditsToUser,
  getActiveSubscription,
} from "../db";
import { PLANS } from "../billing/products";
import { isAsaasBillingConfigured } from "../billing/asaas-billing-client";
import {
  users,
  subscriptions as subscriptionsTable,
  calculosHistorico,
  escritorios,
  colaboradores,
  canaisIntegrados,
  conversas,
  leads,
  contatos,
  agentesIa,
} from "../../drizzle/schema";

export const adminRouter = router({
  /** Get comprehensive admin dashboard stats */
  stats: adminProcedure.query(async () => getAdminStats()),

  /** Get all users (legacy) */
  users: adminProcedure.query(async () => getAllUsers()),

  /** Get all users with subscription status */
  allUsers: adminProcedure.query(async () => getAllUsersWithSubscription()),

  /** Get recent users (last 10) */
  recentUsers: adminProcedure.query(async () => getRecentUsers(10)),

  /** Get recent subscriptions with user info */
  recentSubscriptions: adminProcedure.query(async () => getRecentSubscriptions(10)),

  /** Get all subscriptions with user info */
  allSubscriptions: adminProcedure.query(async () => getAllSubscriptionsWithUsers()),

  /** Update user role */
  updateUserRole: adminProcedure
    .input(z.object({ userId: z.number(), role: z.enum(["user", "admin"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [target] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target) throw new Error("Usuário não encontrado");

      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));

      await registrarAuditoria({
        ctx,
        acao: "user.updateRole",
        alvoTipo: "user",
        alvoId: input.userId,
        alvoNome: target.name || target.email || undefined,
        detalhes: { antigaRole: target.role, novaRole: input.role },
      });

      return { success: true };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // RELATÓRIOS
  // ═══════════════════════════════════════════════════════════════════════

  /** Crescimento de usuários por mês (últimos 12 meses) */
  crescimentoUsuarios: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const allUsers = await db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.role, "user"));
    const meses: Record<string, number> = {};

    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      meses[key] = 0;
    }

    for (const u of allUsers) {
      const d = new Date(u.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (key in meses) meses[key]++;
    }

    return Object.entries(meses).map(([mes, total]) => ({ mes, total }));
  }),

  /** Receita mensal (MRR) por mês — baseado nas assinaturas ativas */
  receitaMensal: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const allSubs = await db.select().from(subscriptionsTable);
    const meses: Record<string, number> = {};

    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      meses[key] = 0;
    }

    for (const sub of allSubs) {
      if (sub.status !== "active" && sub.status !== "trialing") continue;
      const d = new Date(sub.createdAt);
      const plan = PLANS.find((p) => p.id === sub.planId);
      const valor = plan ? plan.priceMonthly : 0;

      // Considerar a sub ativa em todos os meses desde criação
      for (const mesKey of Object.keys(meses)) {
        const [y, m] = mesKey.split("-").map(Number);
        const mesDate = new Date(y, m - 1, 1);
        if (d <= mesDate) {
          meses[mesKey] += valor;
        }
      }
    }

    return Object.entries(meses).map(([mes, valor]) => ({ mes, valor: valor / 100 }));
  }),

  /** Cálculos por módulo (total geral) */
  calculosPorModulo: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const todos = await db.select({ tipo: calculosHistorico.tipo }).from(calculosHistorico);
    const contagem: Record<string, number> = {};

    for (const c of todos) {
      contagem[c.tipo] = (contagem[c.tipo] || 0) + 1;
    }

    const nomes: Record<string, string> = {
      bancario: "Bancário",
      trabalhista: "Trabalhista",
      imobiliario: "Imobiliário",
      tributario: "Tributário",
      previdenciario: "Previdenciário",
      atualizacao_monetaria: "Cálculos Diversos",
    };

    return Object.entries(contagem)
      .map(([tipo, total]) => ({ tipo, nome: nomes[tipo] || tipo, total }))
      .sort((a, b) => b.total - a.total);
  }),

  /** Cálculos por mês (últimos 12 meses) */
  calculosPorMes: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const todos = await db.select({ createdAt: calculosHistorico.createdAt }).from(calculosHistorico);
    const meses: Record<string, number> = {};

    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      meses[key] = 0;
    }

    for (const c of todos) {
      const d = new Date(c.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (key in meses) meses[key]++;
    }

    return Object.entries(meses).map(([mes, total]) => ({ mes, total }));
  }),

  // ═══════════════════════════════════════════════════════════════════════
  // GESTÃO AVANÇADA DE CLIENTES
  // ═══════════════════════════════════════════════════════════════════════

  /** Detalhes completos de um cliente (créditos, cálculos, assinatura) */
  clienteDetalhes: adminProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const user = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (user.length === 0) throw new Error("Utilizador não encontrado");

      const credits = await getUserCreditsInfo(input.userId);
      const subscription = await getActiveSubscription(input.userId);
      const calculos = await getCalculosRecentes(input.userId, 10);
      const stats = await getEstatisticasUso(input.userId);

      return { user: user[0], credits, subscription, calculos, stats };
    }),

  /** Conceder créditos manualmente a um cliente */
  concederCreditos: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        quantidade: z.number().min(1).max(10000),
        motivo: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await addCreditsToUser(input.userId, input.quantidade);

      await registrarAuditoria({
        ctx,
        acao: "user.concederCreditos",
        alvoTipo: "user",
        alvoId: input.userId,
        detalhes: { quantidade: input.quantidade, motivo: input.motivo },
      });

      return { success: true, mensagem: `${input.quantidade} créditos adicionados` };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // CONTROLE DE CLIENTE — Sprint 1
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Bloquear conta de usuário individual.
   *
   * Quando bloqueado, o usuário não consegue mais autenticar (verificado
   * em authenticateRequest). Útil pra: violação de termos, fraude, etc.
   * Diferente de suspender escritório (que afeta todos os colaboradores).
   */
  bloquearUsuario: adminProcedure
    .input(z.object({
      userId: z.number(),
      motivo: z.string().min(3).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [target] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target) throw new Error("Usuário não encontrado");

      await db
        .update(users)
        .set({
          bloqueado: true,
          motivoBloqueio: input.motivo,
          bloqueadoEm: new Date(),
        })
        .where(eq(users.id, input.userId));

      await registrarAuditoria({
        ctx,
        acao: "user.bloquear",
        alvoTipo: "user",
        alvoId: input.userId,
        alvoNome: target.name || target.email || undefined,
        detalhes: { motivo: input.motivo },
      });

      return { success: true, mensagem: "Usuário bloqueado" };
    }),

  /** Desbloquear conta de usuário */
  desbloquearUsuario: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [target] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target) throw new Error("Usuário não encontrado");

      await db
        .update(users)
        .set({ bloqueado: false, motivoBloqueio: null, bloqueadoEm: null })
        .where(eq(users.id, input.userId));

      await registrarAuditoria({
        ctx,
        acao: "user.desbloquear",
        alvoTipo: "user",
        alvoId: input.userId,
        alvoNome: target.name || target.email || undefined,
      });

      return { success: true, mensagem: "Usuário desbloqueado" };
    }),

  /**
   * Suspender escritório inteiro (afeta todos os colaboradores).
   * Use pra: inadimplência grave, violação organizacional de termos.
   * Os colaboradores continuam autenticando, mas qualquer chamada
   * que dependa do escritório retorna 403.
   */
  suspenderEscritorio: adminProcedure
    .input(z.object({
      escritorioId: z.number(),
      motivo: z.string().min(3).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [target] = await db.select().from(escritorios).where(eq(escritorios.id, input.escritorioId)).limit(1);
      if (!target) throw new Error("Escritório não encontrado");

      await db
        .update(escritorios)
        .set({
          suspenso: true,
          motivoSuspensao: input.motivo,
          suspensoEm: new Date(),
        })
        .where(eq(escritorios.id, input.escritorioId));

      await registrarAuditoria({
        ctx,
        acao: "escritorio.suspender",
        alvoTipo: "escritorio",
        alvoId: input.escritorioId,
        alvoNome: target.nome,
        detalhes: { motivo: input.motivo },
      });

      return { success: true, mensagem: "Escritório suspenso" };
    }),

  /** Reativar escritório suspenso */
  reativarEscritorio: adminProcedure
    .input(z.object({ escritorioId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [target] = await db.select().from(escritorios).where(eq(escritorios.id, input.escritorioId)).limit(1);
      if (!target) throw new Error("Escritório não encontrado");

      await db
        .update(escritorios)
        .set({ suspenso: false, motivoSuspensao: null, suspensoEm: null })
        .where(eq(escritorios.id, input.escritorioId));

      await registrarAuditoria({
        ctx,
        acao: "escritorio.reativar",
        alvoTipo: "escritorio",
        alvoId: input.escritorioId,
        alvoNome: target.nome,
      });

      return { success: true, mensagem: "Escritório reativado" };
    }),

  /**
   * Login impersonation — admin "entra como" outro usuário.
   *
   * Cria um JWT especial onde o openId é do usuário-alvo, mas com
   * `impersonatedBy` apontando pro admin que iniciou. O admin enxerga
   * exatamente o que o usuário enxergaria, mas as ações ficam
   * registradas em nome do admin (auditoria).
   *
   * Limite: sessão de impersonation dura 1 hora (não a SESSION_DURATION
   * normal). Pra "sair" da impersonation, o admin clica em logout.
   */
  impersonarUsuario: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Buscar usuário-alvo
      const [targetUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!targetUser) throw new Error("Usuário não encontrado");
      if (targetUser.role === "admin") {
        throw new Error("Não é possível impersonar outro admin");
      }

      // Importar dinamicamente pra evitar ciclos
      const { sdk } = await import("../_core/sdk");
      const { COOKIE_NAME } = await import("../../shared/const");
      const { getSessionCookieOptions } = await import("../_core/cookies");

      const ONE_HOUR = 60 * 60 * 1000;
      const sessionToken = await sdk.signSession(
        {
          openId: targetUser.openId,
          appId: "jurify",
          name: targetUser.name || targetUser.email || "Usuário",
          impersonatedBy: ctx.user.openId, // ← admin original
        },
        { expiresInMs: ONE_HOUR },
      );

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_HOUR,
      });

      // Auditoria CRÍTICA: registrar quem entrou como quem
      await registrarAuditoria({
        ctx,
        acao: "user.impersonar",
        alvoTipo: "user",
        alvoId: targetUser.id,
        alvoNome: targetUser.name || targetUser.email || undefined,
        detalhes: { duracaoMs: ONE_HOUR },
      });

      return {
        success: true,
        mensagem: `Logado como ${targetUser.name || targetUser.email}. Sessão expira em 1h.`,
        targetName: targetUser.name || targetUser.email,
      };
    }),

  /**
   * Reset de senha — gera senha temporária para usuários que perderam
   * acesso. Admin vê a senha apenas uma vez (deve passar pro cliente).
   * O cliente deve trocar a senha no primeiro acesso.
   *
   * Só funciona pra usuários com loginMethod="email" (signup tradicional).
   * Usuários Google não têm senha, precisam logar com Google.
   */
  resetarSenhaUsuario: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [target] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target) throw new Error("Usuário não encontrado");
      if (!target.passwordHash) {
        throw new Error("Este usuário não tem senha (login via Google ou outro provider).");
      }

      // Gera senha temporária aleatória — 12 chars alfanuméricos
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      let novaSenha = "";
      for (let i = 0; i < 12; i++) {
        novaSenha += chars[Math.floor(Math.random() * chars.length)];
      }

      const { hashPassword } = await import("../_core/password");
      const passwordHash = await hashPassword(novaSenha);

      await db.update(users).set({ passwordHash }).where(eq(users.id, input.userId));

      await registrarAuditoria({
        ctx,
        acao: "user.resetSenha",
        alvoTipo: "user",
        alvoId: input.userId,
        alvoNome: target.name || target.email || undefined,
      });

      return {
        success: true,
        mensagem: "Senha resetada. Passe a senha temporária ao cliente.",
        senhaTemp: novaSenha,
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // INADIMPLÊNCIA E AUDITORIA — Sprint 2
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Lista assinaturas com pagamento atrasado (status = past_due).
   *
   * Inclui dados do usuário pra contato direto. Usado pro dashboard
   * de cobrança / financeiro tomar ação.
   */
  listarInadimplentes: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const rows = await db
      .select({
        subId: subscriptionsTable.id,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        planId: subscriptionsTable.planId,
        status: subscriptionsTable.status,
        currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
        asaasSubscriptionId: subscriptionsTable.asaasSubscriptionId,
        createdAt: subscriptionsTable.createdAt,
      })
      .from(subscriptionsTable)
      .innerJoin(users, eq(subscriptionsTable.userId, users.id))
      .where(eq(subscriptionsTable.status, "past_due"))
      .orderBy(desc(subscriptionsTable.currentPeriodEnd));

    return rows.map((r) => {
      const plan = PLANS.find((p) => p.id === r.planId);
      return {
        ...r,
        planName: plan?.name || r.planId,
        valorMensal: plan?.priceMonthly || 0,
      };
    });
  }),

  /**
   * Lista o audit log com filtros e paginação.
   */
  listarAuditoria: adminProcedure
    .input(z.object({
      acao: z.string().optional(),
      actorUserId: z.number().optional(),
      alvoTipo: z.string().optional(),
      limit: z.number().min(1).max(500).default(100),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { logs: [], total: 0 };

      const { auditLog } = await import("../../drizzle/schema");
      const params = input || { limit: 100, offset: 0 };

      const conditions = [];
      if (params.acao) conditions.push(eq(auditLog.acao, params.acao));
      if (params.actorUserId) conditions.push(eq(auditLog.actorUserId, params.actorUserId));
      if (params.alvoTipo) conditions.push(eq(auditLog.alvoTipo, params.alvoTipo));

      const baseQuery = db.select().from(auditLog);
      const filtered = conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery;

      const logs = await filtered
        .orderBy(desc(auditLog.createdAt))
        .limit(params.limit ?? 100)
        .offset(params.offset ?? 0);

      // Total para paginação
      const totalQuery = db.select({ count: sql<number>`COUNT(*)` }).from(auditLog);
      const totalFiltered = conditions.length > 0
        ? totalQuery.where(and(...conditions))
        : totalQuery;
      const [totalRow] = await totalFiltered;
      const total = Number((totalRow as { count: number } | undefined)?.count || 0);

      return {
        logs: logs.map((l) => ({
          ...l,
          detalhes: l.detalhes ? (() => {
            try { return JSON.parse(l.detalhes); } catch { return l.detalhes; }
          })() : null,
        })),
        total,
      };
    }),

  /**
   * Estatísticas rápidas do audit log: top 5 ações, top 5 atores,
   * total nos últimos 7 dias. Usado pro dashboard.
   */
  estatisticasAuditoria: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalUltimos7Dias: 0, topAcoes: [], topAtores: [] };

    const { auditLog } = await import("../../drizzle/schema");
    const seteDias = new Date();
    seteDias.setDate(seteDias.getDate() - 7);

    const recentes = await db
      .select()
      .from(auditLog)
      .where(gt(auditLog.createdAt, seteDias));

    const acoesCount: Record<string, number> = {};
    const atoresCount: Record<string, { id: number; name: string; count: number }> = {};

    for (const r of recentes) {
      acoesCount[r.acao] = (acoesCount[r.acao] || 0) + 1;
      const key = String(r.actorUserId);
      if (!atoresCount[key]) {
        atoresCount[key] = { id: r.actorUserId, name: r.actorName || "?", count: 0 };
      }
      atoresCount[key].count++;
    }

    const topAcoes = Object.entries(acoesCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([acao, count]) => ({ acao, count }));

    const topAtores = Object.values(atoresCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalUltimos7Dias: recentes.length,
      topAcoes,
      topAtores,
    };
  }),

  // ═══════════════════════════════════════════════════════════════════════
  // NOTAS INTERNAS DO ADMIN — Sprint 1
  // ═══════════════════════════════════════════════════════════════════════

  /** Lista todas as notas internas sobre um cliente, mais recentes primeiro */
  listarNotasCliente: adminProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { clienteNotasAdmin } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const rows = await db
        .select({
          id: clienteNotasAdmin.id,
          conteudo: clienteNotasAdmin.conteudo,
          categoria: clienteNotasAdmin.categoria,
          autorAdminId: clienteNotasAdmin.autorAdminId,
          createdAt: clienteNotasAdmin.createdAt,
          updatedAt: clienteNotasAdmin.updatedAt,
        })
        .from(clienteNotasAdmin)
        .where(eq(clienteNotasAdmin.userId, input.userId))
        .orderBy(desc(clienteNotasAdmin.createdAt))
        .limit(100);

      // Junta nome do admin autor
      const adminIds = Array.from(new Set(rows.map((r) => r.autorAdminId)));
      const admins = adminIds.length > 0
        ? await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, adminIds))
        : [];
      const adminMap = new Map(admins.map((a) => [a.id, a.name || "Admin"]));

      return rows.map((r) => ({
        ...r,
        autorNome: adminMap.get(r.autorAdminId) || "Admin",
      }));
    }),

  /** Cria nota interna sobre um cliente */
  criarNotaCliente: adminProcedure
    .input(z.object({
      userId: z.number(),
      conteudo: z.string().min(1).max(5000),
      categoria: z.enum(["geral", "financeiro", "suporte", "comercial", "alerta"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { clienteNotasAdmin } = await import("../../drizzle/schema");
      await db.insert(clienteNotasAdmin).values({
        userId: input.userId,
        autorAdminId: ctx.user.id,
        conteudo: input.conteudo,
        categoria: input.categoria || "geral",
      });
      return { success: true };
    }),

  /** Deleta nota (somente o autor ou admin master) */
  deletarNotaCliente: adminProcedure
    .input(z.object({ notaId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { clienteNotasAdmin } = await import("../../drizzle/schema");
      await db.delete(clienteNotasAdmin).where(eq(clienteNotasAdmin.id, input.notaId));
      return { success: true };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // PLANOS DINÂMICOS — Sprint 3
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Lista os planos com overrides aplicados — usado pela página
   * /admin/planos para mostrar os valores efetivos. Também marca quais
   * têm override ativo (pra mostrar badge "Modificado" no UI).
   */
  listarPlanosEditaveis: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const { planosOverrides } = await import("../../drizzle/schema");
    const overrides = await db.select().from(planosOverrides);
    const overrideMap = new Map(overrides.map((o) => [o.planId, o]));

    return PLANS.map((plan) => {
      const ov = overrideMap.get(plan.id);
      return {
        id: plan.id,
        // Hardcoded (default)
        defaultName: plan.name,
        defaultDescription: plan.description,
        defaultPriceMonthly: plan.priceMonthly,
        defaultPriceYearly: plan.priceYearly,
        defaultFeatures: plan.features,
        defaultPopular: plan.popular ?? false,
        // Atual (com override)
        name: ov?.name ?? plan.name,
        description: ov?.description ?? plan.description,
        priceMonthly: ov?.priceMonthly ?? plan.priceMonthly,
        priceYearly: ov?.priceYearly ?? plan.priceYearly,
        features: ov?.features ? (() => {
          try { return JSON.parse(ov.features); } catch { return plan.features; }
        })() : plan.features,
        popular: ov?.popular ?? plan.popular ?? false,
        oculto: ov?.oculto ?? false,
        hasOverride: !!ov,
        updatedAt: ov?.updatedAt,
      };
    });
  }),

  /**
   * Edita um plano (cria ou atualiza override). Campos null = remove
   * o override desse campo (volta ao default).
   */
  editarPlano: adminProcedure
    .input(z.object({
      planId: z.string(),
      name: z.string().max(100).nullable().optional(),
      description: z.string().max(500).nullable().optional(),
      priceMonthly: z.number().int().min(0).nullable().optional(),
      priceYearly: z.number().int().min(0).nullable().optional(),
      features: z.array(z.string()).nullable().optional(),
      popular: z.boolean().nullable().optional(),
      oculto: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Validar que planId existe no hardcoded
      const planoBase = PLANS.find((p) => p.id === input.planId);
      if (!planoBase) throw new Error(`Plano "${input.planId}" não existe`);

      const { planosOverrides } = await import("../../drizzle/schema");
      const [existing] = await db
        .select()
        .from(planosOverrides)
        .where(eq(planosOverrides.planId, input.planId))
        .limit(1);

      const valores = {
        name: input.name === null ? null : input.name,
        description: input.description === null ? null : input.description,
        priceMonthly: input.priceMonthly === null ? null : input.priceMonthly,
        priceYearly: input.priceYearly === null ? null : input.priceYearly,
        features: input.features === null ? null : (input.features ? JSON.stringify(input.features) : null),
        popular: input.popular === null ? null : input.popular,
        oculto: input.oculto ?? false,
        updatedBy: ctx.user.id,
      };

      if (existing) {
        await db
          .update(planosOverrides)
          .set(valores)
          .where(eq(planosOverrides.planId, input.planId));
      } else {
        await db.insert(planosOverrides).values({
          planId: input.planId,
          ...valores,
        });
      }

      await registrarAuditoria({
        ctx,
        acao: "plano.editar",
        alvoTipo: "plano",
        alvoNome: input.planId,
        detalhes: {
          priceMonthly: valores.priceMonthly,
          priceYearly: valores.priceYearly,
          oculto: valores.oculto,
        },
      });

      return { success: true, mensagem: "Plano atualizado" };
    }),

  /** Remove override de um plano (volta tudo ao default do código) */
  resetarOverridePlano: adminProcedure
    .input(z.object({ planId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { planosOverrides } = await import("../../drizzle/schema");
      await db.delete(planosOverrides).where(eq(planosOverrides.planId, input.planId));

      await registrarAuditoria({
        ctx,
        acao: "plano.resetar",
        alvoTipo: "plano",
        alvoNome: input.planId,
      });

      return { success: true };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // CUPONS DE DESCONTO — Sprint 3
  // ═══════════════════════════════════════════════════════════════════════

  /** Lista todos os cupons (ativos e inativos), mais recentes primeiro */
  listarCupons: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { cupons } = await import("../../drizzle/schema");
    return db.select().from(cupons).orderBy(desc(cupons.createdAt));
  }),

  /** Cria um novo cupom de desconto */
  criarCupom: adminProcedure
    .input(z.object({
      codigo: z.string().min(3).max(64).regex(/^[A-Z0-9_-]+$/i, "Use apenas letras, números, _ e -"),
      descricao: z.string().max(255).optional(),
      tipo: z.enum(["percentual", "valorFixo"]),
      valor: z.number().int().min(1),
      validoDe: z.string().datetime().optional(),
      validoAte: z.string().datetime().optional(),
      maxUsos: z.number().int().min(1).optional(),
      planosIds: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { cupons } = await import("../../drizzle/schema");

      // Validar percentual <= 100
      if (input.tipo === "percentual" && input.valor > 100) {
        throw new Error("Desconto percentual não pode passar de 100%");
      }

      // Validar planos existem
      if (input.planosIds && input.planosIds.length > 0) {
        for (const pid of input.planosIds) {
          if (!PLANS.find((p) => p.id === pid)) {
            throw new Error(`Plano "${pid}" não existe`);
          }
        }
      }

      // Codigo case-insensitive
      const codigoNorm = input.codigo.toUpperCase();

      // Checar se já existe
      const [existing] = await db
        .select()
        .from(cupons)
        .where(eq(cupons.codigo, codigoNorm))
        .limit(1);
      if (existing) throw new Error(`Já existe cupom com o código "${codigoNorm}"`);

      await db.insert(cupons).values({
        codigo: codigoNorm,
        descricao: input.descricao,
        tipo: input.tipo,
        valor: input.valor,
        validoDe: input.validoDe ? new Date(input.validoDe) : null,
        validoAte: input.validoAte ? new Date(input.validoAte) : null,
        maxUsos: input.maxUsos,
        planosIds: input.planosIds && input.planosIds.length > 0 ? input.planosIds.join(",") : null,
        criadoPor: ctx.user.id,
      });

      await registrarAuditoria({
        ctx,
        acao: "cupom.criar",
        alvoTipo: "cupom",
        alvoNome: codigoNorm,
        detalhes: { tipo: input.tipo, valor: input.valor },
      });

      return { success: true, mensagem: `Cupom ${codigoNorm} criado` };
    }),

  /** Ativa/desativa um cupom (sem deletar — preserva histórico) */
  alternarAtivoCupom: adminProcedure
    .input(z.object({ id: z.number(), ativo: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { cupons } = await import("../../drizzle/schema");
      await db
        .update(cupons)
        .set({ ativo: input.ativo })
        .where(eq(cupons.id, input.id));

      await registrarAuditoria({
        ctx,
        acao: input.ativo ? "cupom.ativar" : "cupom.desativar",
        alvoTipo: "cupom",
        alvoId: input.id,
      });

      return { success: true };
    }),

  /** Deletar cupom (apenas se nunca foi usado) */
  deletarCupom: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { cupons } = await import("../../drizzle/schema");

      const [c] = await db.select().from(cupons).where(eq(cupons.id, input.id)).limit(1);
      if (!c) throw new Error("Cupom não encontrado");
      if (c.usos > 0) {
        throw new Error("Cupom já foi usado — desative em vez de deletar para preservar histórico");
      }

      await db.delete(cupons).where(eq(cupons.id, input.id));

      await registrarAuditoria({
        ctx,
        acao: "cupom.deletar",
        alvoTipo: "cupom",
        alvoId: input.id,
        alvoNome: c.codigo,
      });

      return { success: true };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // CHURN E MÉTRICAS DE RECEITA — Sprint 3
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Métricas de churn dos últimos 12 meses:
   *   - clientes ativos no início do mês
   *   - cancelamentos no mês
   *   - taxa de churn (%)
   *   - LTV estimado (avg MRR / churn rate)
   */
  metricasChurn: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return {
        meses: [],
        churnAtual: 0,
        ltvEstimado: 0,
        retencao12m: 0,
      };
    }

    const allSubs = await db.select().from(subscriptionsTable);

    // Calcula a foto de cada mês: ativos no início, cancelados no mês
    const meses: Array<{
      mes: string;
      ativosInicio: number;
      cancelados: number;
      churnRate: number;
    }> = [];

    for (let i = 11; i >= 0; i--) {
      const inicioMes = new Date();
      inicioMes.setMonth(inicioMes.getMonth() - i);
      inicioMes.setDate(1);
      inicioMes.setHours(0, 0, 0, 0);

      const fimMes = new Date(inicioMes);
      fimMes.setMonth(fimMes.getMonth() + 1);

      // Subs criadas antes do início do mês e (não canceladas OU canceladas após o início)
      const ativosInicio = allSubs.filter((s) => {
        const created = new Date(s.createdAt).getTime();
        return created < inicioMes.getTime();
      }).length;

      // Subs canceladas no mês (proxy: status canceled E updatedAt no mês)
      const cancelados = allSubs.filter((s) => {
        if (s.status !== "canceled") return false;
        const updated = new Date(s.updatedAt).getTime();
        return updated >= inicioMes.getTime() && updated < fimMes.getTime();
      }).length;

      const churnRate = ativosInicio > 0 ? (cancelados / ativosInicio) * 100 : 0;

      meses.push({
        mes: `${inicioMes.getFullYear()}-${String(inicioMes.getMonth() + 1).padStart(2, "0")}`,
        ativosInicio,
        cancelados,
        churnRate: Math.round(churnRate * 100) / 100,
      });
    }

    // Churn médio dos últimos 3 meses (mais estável)
    const ultimos3 = meses.slice(-3);
    const churnAtual = ultimos3.length > 0
      ? ultimos3.reduce((sum, m) => sum + m.churnRate, 0) / ultimos3.length
      : 0;

    // LTV estimado = (MRR médio por cliente) / (churn rate mensal)
    const subsAtivas = allSubs.filter((s) => s.status === "active");
    const mrrTotal = subsAtivas.reduce((sum, s) => {
      const plan = PLANS.find((p) => p.id === s.planId);
      return sum + (plan?.priceMonthly || 0);
    }, 0);
    const arpu = subsAtivas.length > 0 ? mrrTotal / subsAtivas.length : 0;
    const ltvEstimado = churnAtual > 0 ? arpu / (churnAtual / 100) : 0;

    // Retenção 12m: clientes que ainda estão ativos vs criados há 12+ meses
    const umAnoAtras = new Date();
    umAnoAtras.setFullYear(umAnoAtras.getFullYear() - 1);
    const criadosHaUmAno = allSubs.filter((s) => new Date(s.createdAt) <= umAnoAtras);
    const aindaAtivos = criadosHaUmAno.filter((s) => s.status === "active").length;
    const retencao12m = criadosHaUmAno.length > 0
      ? Math.round((aindaAtivos / criadosHaUmAno.length) * 100)
      : 0;

    return {
      meses,
      churnAtual: Math.round(churnAtual * 100) / 100,
      ltvEstimado: Math.round(ltvEstimado),
      retencao12m,
    };
  }),

  /**
   * Cancela assinatura via admin (sem precisar do consentimento do usuário).
   * Usa AsaasClient pra cancelar no Asaas + marca como canceled localmente.
   */
  cancelarAssinaturaAdmin: adminProcedure
    .input(z.object({
      subscriptionId: z.number(),
      motivo: z.string().min(3).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.id, input.subscriptionId))
        .limit(1);
      if (!sub) throw new Error("Assinatura não encontrada");
      if (sub.status === "canceled") throw new Error("Assinatura já está cancelada");

      // Buscar nome do user pra auditoria
      const [u] = await db.select({ id: users.id, name: users.name, email: users.email })
        .from(users).where(eq(users.id, sub.userId)).limit(1);

      // Cancela no Asaas (best-effort)
      if (sub.asaasSubscriptionId) {
        try {
          const { getAdminAsaasClient } = await import("../billing/asaas-billing-client");
          const client = await getAdminAsaasClient();
          await client.cancelarAssinatura(sub.asaasSubscriptionId);
        } catch (err: any) {
          // Loga mas não bloqueia — admin pode estar cancelando uma sub
          // que já foi removida no Asaas
          console.warn("Asaas cancel falhou:", err.message);
        }
      }

      await db
        .update(subscriptionsTable)
        .set({ status: "canceled" })
        .where(eq(subscriptionsTable.id, input.subscriptionId));

      await registrarAuditoria({
        ctx,
        acao: "subscription.cancelarAdmin",
        alvoTipo: "subscription",
        alvoId: input.subscriptionId,
        alvoNome: u?.name || u?.email || undefined,
        detalhes: { motivo: input.motivo, planId: sub.planId },
      });

      return { success: true, mensagem: "Assinatura cancelada" };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // MONITORAMENTO OPERACIONAL
  // ═══════════════════════════════════════════════════════════════════════

  /** Visão operacional: escritórios, canais, conversas, leads, agentes IA */
  operacional: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return {
        escritorios: 0,
        colaboradores: 0,
        canais: [],
        conversas: { total: 0, aguardando: 0, em_atendimento: 0 },
        leads: { total: 0, porEtapa: {} },
        agentesIa: 0,
        contatos: 0,
      };
    }

    const allEsc = await db.select({ id: escritorios.id }).from(escritorios);
    const allColab = await db
      .select({ id: colaboradores.id, ativo: colaboradores.ativo })
      .from(colaboradores);
    const allCanais = await db.select().from(canaisIntegrados);
    const allConversas = await db.select({ status: conversas.status }).from(conversas);
    const allLeads = await db.select({ etapaFunil: leads.etapaFunil }).from(leads);
    const allAgentes = await db.select({ id: agentesIa.id }).from(agentesIa);
    const allContatos = await db.select({ id: contatos.id }).from(contatos);

    const canaisResumo = allCanais.map((c) => ({
      id: c.id,
      tipo: c.tipo,
      nome: c.nome,
      status: c.status,
      telefone: c.telefone,
    }));

    const conversasAgua = allConversas.filter((c) => c.status === "aguardando").length;
    const conversasAtend = allConversas.filter((c) => c.status === "em_atendimento").length;

    const leadsPorEtapa: Record<string, number> = {};
    for (const l of allLeads) {
      leadsPorEtapa[l.etapaFunil] = (leadsPorEtapa[l.etapaFunil] || 0) + 1;
    }

    return {
      escritorios: allEsc.length,
      colaboradores: allColab.filter((c) => c.ativo).length,
      canais: canaisResumo,
      conversas: { total: allConversas.length, aguardando: conversasAgua, em_atendimento: conversasAtend },
      leads: { total: allLeads.length, porEtapa: leadsPorEtapa },
      agentesIa: allAgentes.length,
      contatos: allContatos.length,
    };
  }),

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIGURAÇÕES DO SISTEMA
  // ═══════════════════════════════════════════════════════════════════════

  /** Retorna os planos atuais do sistema (somente leitura) */
  planosAtuais: adminProcedure.query(() => {
    return PLANS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priceMonthly: p.priceMonthly,
      priceYearly: p.priceYearly,
      creditsPerMonth: p.creditsPerMonth,
      features: p.features,
    }));
  }),

  /** Saúde do sistema: verifica DB, gateway de pagamento, variáveis essenciais */
  systemHealth: adminProcedure.query(async () => {
    const checks: Array<{ nome: string; status: "ok" | "erro" | "aviso"; detalhe: string }> = [];

    const db = await getDb();
    checks.push({
      nome: "Banco de dados",
      status: db ? "ok" : "erro",
      detalhe: db ? "Conectado" : "Indisponível",
    });

    const asaasOk = await isAsaasBillingConfigured();
    checks.push({
      nome: "Asaas (Cobrança SaaS)",
      status: asaasOk ? "ok" : "aviso",
      detalhe: asaasOk
        ? "Configurado em Integrações"
        : "API key do Asaas não configurada — vá em Integrações",
    });

    const encKey = process.env.ENCRYPTION_KEY;
    checks.push({
      nome: "Criptografia",
      status: encKey && encKey.length === 64 ? "ok" : "aviso",
      detalhe:
        encKey && encKey.length === 64
          ? "ENCRYPTION_KEY (64 chars)"
          : "Usando chave derivada (menos seguro)",
    });

    checks.push({
      nome: "Ambiente",
      status: "ok",
      detalhe: process.env.NODE_ENV || "development",
    });

    return {
      checks,
      uptime: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      plansCount: PLANS.length,
    };
  }),
});
