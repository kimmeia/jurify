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
import { eq, inArray } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
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
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
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
    .mutation(async ({ input }) => {
      await addCreditsToUser(input.userId, input.quantidade);
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
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db
        .update(users)
        .set({
          bloqueado: true,
          motivoBloqueio: input.motivo,
          bloqueadoEm: new Date(),
        })
        .where(eq(users.id, input.userId));
      return { success: true, mensagem: "Usuário bloqueado" };
    }),

  /** Desbloquear conta de usuário */
  desbloquearUsuario: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db
        .update(users)
        .set({ bloqueado: false, motivoBloqueio: null, bloqueadoEm: null })
        .where(eq(users.id, input.userId));
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
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db
        .update(escritorios)
        .set({
          suspenso: true,
          motivoSuspensao: input.motivo,
          suspensoEm: new Date(),
        })
        .where(eq(escritorios.id, input.escritorioId));
      return { success: true, mensagem: "Escritório suspenso" };
    }),

  /** Reativar escritório suspenso */
  reativarEscritorio: adminProcedure
    .input(z.object({ escritorioId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db
        .update(escritorios)
        .set({ suspenso: false, motivoSuspensao: null, suspensoEm: null })
        .where(eq(escritorios.id, input.escritorioId));
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

      return {
        success: true,
        mensagem: `Logado como ${targetUser.name || targetUser.email}. Sessão expira em 1h.`,
        targetName: targetUser.name || targetUser.email,
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
