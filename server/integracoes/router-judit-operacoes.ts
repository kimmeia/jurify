/**
 * Router tRPC — Operações Judit.IO (Usuários + Admin)
 *
 * Usa a API key do admin (tabela admin_integracoes) para fazer requisições.
 * Cada usuário só vê e gerencia seus próprios monitoramentos.
 *
 * Limites por plano (plan-limits.ts):
 * - free: 0 (sem acesso)
 * - basic: 5 monitoramentos
 * - professional: 50
 * - enterprise: ilimitado
 */

import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb, getActiveSubscription } from "../db";
import { juditMonitoramentos, juditRespostas } from "../../drizzle/schema";
import { eq, desc, and, like, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getJuditClient } from "./judit-webhook";
import { getLimites } from "../stripe/plan-limits";

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function requireJuditClient() {
  const client = await getJuditClient();
  if (!client) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Serviço de monitoramento processual indisponível no momento. Tente novamente mais tarde.",
    });
  }
  return client;
}

async function verificarAcessoJudit(userId: number) {
  const sub = await getActiveSubscription(userId);
  const planId = sub?.planId || "free";
  const limites = getLimites(planId);

  if (limites.maxMonitoramentosJudit <= 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "O monitoramento processual não está disponível no seu plano. Faça upgrade para ter acesso.",
    });
  }

  return { planId, limites };
}

async function contarMonitoramentosAtivos(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const ativos = await db
    .select({ id: juditMonitoramentos.id })
    .from(juditMonitoramentos)
    .where(
      and(
        eq(juditMonitoramentos.clienteUserId, userId),
        or(
          eq(juditMonitoramentos.statusJudit, "created"),
          eq(juditMonitoramentos.statusJudit, "updating"),
          eq(juditMonitoramentos.statusJudit, "updated")
        )
      )
    );

  return ativos.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER — ENDPOINTS DO USUÁRIO (protectedProcedure)
// ═══════════════════════════════════════════════════════════════════════════════

export const juditOperacoesRouter = router({
  /** Verifica acesso e retorna info do plano */
  verificarAcesso: protectedProcedure.query(async ({ ctx }) => {
    const sub = await getActiveSubscription(ctx.user.id);
    const planId = sub?.planId || "free";
    const limites = getLimites(planId);
    const ativosCount = await contarMonitoramentosAtivos(ctx.user.id);

    return {
      temAcesso: limites.maxMonitoramentosJudit > 0,
      planId,
      maxMonitoramentos: limites.maxMonitoramentosJudit,
      monitoramentosAtivos: ativosCount,
      restantes: Math.max(0, limites.maxMonitoramentosJudit - ativosCount),
    };
  }),

  /** Consulta um processo por CNJ (avulsa, sem criar monitoramento) */
  consultarProcesso: protectedProcedure
    .input(z.object({ numeroCnj: z.string().min(20).max(25) }))
    .mutation(async ({ ctx, input }) => {
      await verificarAcessoJudit(ctx.user.id);
      const client = await requireJuditClient();

      const request = await client.criarRequest({
        search: { search_type: "lawsuit_cnj", search_key: input.numeroCnj },
        with_attachments: false,
      });

      // Polling (max 30s)
      const startTime = Date.now();
      let responses = null;

      while (Date.now() - startTime < 30000) {
        await new Promise((r) => setTimeout(r, 2000));
        const reqStatus = await client.consultarRequest(request.request_id);
        if (reqStatus.status === "completed") {
          responses = await client.buscarRespostas(request.request_id, 1, 10);
          break;
        }
      }

      if (!responses || responses.page_data.length === 0) {
        return { encontrado: false, requestId: request.request_id, mensagem: "Consulta em andamento. Tente novamente em alguns segundos." };
      }

      const lawsuits = responses.page_data.filter((r) => r.response_type === "lawsuit");
      if (lawsuits.length === 0) {
        const erros = responses.page_data.filter((r) => r.response_type === "application_error");
        return { encontrado: false, requestId: request.request_id, mensagem: erros.length > 0 ? ((erros[0].response_data as { message?: string })?.message || "Processo não encontrado") : "Nenhum resultado para este CNJ" };
      }

      return { encontrado: true, requestId: request.request_id, processo: lawsuits[0].response_data, totalInstancias: lawsuits.length };
    }),

  /** Cria monitoramento — verifica limite do plano */
  criarMonitoramento: protectedProcedure
    .input(z.object({
      numeroCnj: z.string().min(20).max(25),
      apelido: z.string().max(255).optional(),
      recurrence: z.number().int().min(1).max(30).default(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const { limites } = await verificarAcessoJudit(ctx.user.id);
      const client = await requireJuditClient();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database indisponível" });

      const ativosCount = await contarMonitoramentosAtivos(ctx.user.id);
      if (ativosCount >= limites.maxMonitoramentosJudit) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Limite de ${limites.maxMonitoramentosJudit} monitoramentos atingido. Faça upgrade para monitorar mais processos.`,
        });
      }

      // Duplicata
      const existente = await db.select().from(juditMonitoramentos)
        .where(and(
          eq(juditMonitoramentos.searchKey, input.numeroCnj),
          eq(juditMonitoramentos.clienteUserId, ctx.user.id),
          or(eq(juditMonitoramentos.statusJudit, "created"), eq(juditMonitoramentos.statusJudit, "updating"), eq(juditMonitoramentos.statusJudit, "updated"))
        )).limit(1);

      if (existente.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: `Você já está monitorando o processo ${input.numeroCnj}.` });
      }

      const tracking = await client.criarMonitoramento({
        recurrence: input.recurrence,
        search: { search_type: "lawsuit_cnj", search_key: input.numeroCnj },
        with_attachments: false,
      });

      await db.insert(juditMonitoramentos).values({
        trackingId: tracking.tracking_id,
        searchType: "lawsuit_cnj",
        searchKey: input.numeroCnj,
        recurrence: input.recurrence,
        statusJudit: tracking.status as any,
        apelido: input.apelido || null,
        clienteUserId: ctx.user.id,
        withAttachments: false,
      });

      return { success: true, trackingId: tracking.tracking_id, mensagem: "Monitoramento criado! Atualizações diárias ativadas." };
    }),

  /** Lista monitoramentos do usuário logado */
  listarMonitoramentos: protectedProcedure
    .input(z.object({
      status: z.enum(["created", "updating", "updated", "paused", "deleted", "todos"]).default("todos"),
      busca: z.string().optional(),
      pageSize: z.number().int().min(1).max(200).default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };

      const conditions: any[] = [eq(juditMonitoramentos.clienteUserId, ctx.user.id)];
      const statusFilter = input?.status ?? "todos";

      if (statusFilter !== "todos") {
        conditions.push(eq(juditMonitoramentos.statusJudit, statusFilter as any));
      } else {
        conditions.push(or(
          eq(juditMonitoramentos.statusJudit, "created"),
          eq(juditMonitoramentos.statusJudit, "updating"),
          eq(juditMonitoramentos.statusJudit, "updated"),
          eq(juditMonitoramentos.statusJudit, "paused")
        ));
      }

      if (input?.busca) {
        const b = `%${input.busca}%`;
        conditions.push(or(like(juditMonitoramentos.searchKey, b), like(juditMonitoramentos.apelido, b), like(juditMonitoramentos.nomePartes, b)));
      }

      const pageSize = input?.pageSize ?? 50;
      const items = await db.select().from(juditMonitoramentos).where(and(...conditions)).orderBy(desc(juditMonitoramentos.updatedAt)).limit(pageSize);
      return { items, total: items.length };
    }),

  /** Pausa monitoramento (próprio) */
  pausarMonitoramento: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const client = await requireJuditClient();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const mon = await db.select().from(juditMonitoramentos)
        .where(and(eq(juditMonitoramentos.id, input.id), eq(juditMonitoramentos.clienteUserId, ctx.user.id))).limit(1);
      if (mon.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });

      await client.pausarMonitoramento(mon[0].trackingId);
      await db.update(juditMonitoramentos).set({ statusJudit: "paused" }).where(eq(juditMonitoramentos.id, input.id));
      return { success: true };
    }),

  /** Reativa monitoramento pausado (verifica limite) */
  reativarMonitoramento: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { limites } = await verificarAcessoJudit(ctx.user.id);
      const client = await requireJuditClient();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const ativosCount = await contarMonitoramentosAtivos(ctx.user.id);
      if (ativosCount >= limites.maxMonitoramentosJudit) {
        throw new TRPCError({ code: "FORBIDDEN", message: `Limite de ${limites.maxMonitoramentosJudit} monitoramentos ativos atingido.` });
      }

      const mon = await db.select().from(juditMonitoramentos)
        .where(and(eq(juditMonitoramentos.id, input.id), eq(juditMonitoramentos.clienteUserId, ctx.user.id))).limit(1);
      if (mon.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

      await client.reativarMonitoramento(mon[0].trackingId);
      await db.update(juditMonitoramentos).set({ statusJudit: "updated" }).where(eq(juditMonitoramentos.id, input.id));
      return { success: true };
    }),

  /** Remove monitoramento (próprio) */
  deletarMonitoramento: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const client = await requireJuditClient();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const mon = await db.select().from(juditMonitoramentos)
        .where(and(eq(juditMonitoramentos.id, input.id), eq(juditMonitoramentos.clienteUserId, ctx.user.id))).limit(1);
      if (mon.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

      await client.deletarMonitoramento(mon[0].trackingId);
      await db.update(juditMonitoramentos).set({ statusJudit: "deleted" }).where(eq(juditMonitoramentos.id, input.id));
      return { success: true };
    }),

  /** Histórico de atualizações (próprio) */
  historicoRespostas: protectedProcedure
    .input(z.object({ monitoramentoId: z.number(), page: z.number().min(1).default(1), pageSize: z.number().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };

      const mon = await db.select().from(juditMonitoramentos)
        .where(and(eq(juditMonitoramentos.id, input.monitoramentoId), eq(juditMonitoramentos.clienteUserId, ctx.user.id))).limit(1);
      if (mon.length === 0) return { items: [], total: 0 };

      const items = await db.select().from(juditRespostas)
        .where(eq(juditRespostas.monitoramentoId, input.monitoramentoId))
        .orderBy(desc(juditRespostas.createdAt)).limit(input.pageSize).offset((input.page - 1) * input.pageSize);

      const all = await db.select({ id: juditRespostas.id }).from(juditRespostas)
        .where(eq(juditRespostas.monitoramentoId, input.monitoramentoId));

      return { items, total: all.length };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // ADMIN-ONLY: stats globais e sincronização
  // ═══════════════════════════════════════════════════════════════════════

  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, ativos: 0, pausados: 0, totalRespostas: 0 };

    const todos = await db.select().from(juditMonitoramentos);
    const respostas = await db.select({ id: juditRespostas.id }).from(juditRespostas);

    return {
      total: todos.length,
      ativos: todos.filter((m) => ["created", "updating", "updated"].includes(m.statusJudit)).length,
      pausados: todos.filter((m) => m.statusJudit === "paused").length,
      totalRespostas: respostas.length,
    };
  }),

  sincronizarStatus: adminProcedure.mutation(async () => {
    const client = await requireJuditClient();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const locais = await db.select().from(juditMonitoramentos)
      .where(or(eq(juditMonitoramentos.statusJudit, "created"), eq(juditMonitoramentos.statusJudit, "updating"), eq(juditMonitoramentos.statusJudit, "updated")));

    let atualizados = 0;
    for (const mon of locais) {
      try {
        const remoto = await client.consultarMonitoramento(mon.trackingId);
        if (remoto && remoto.status !== mon.statusJudit) {
          await db.update(juditMonitoramentos).set({ statusJudit: remoto.status as any }).where(eq(juditMonitoramentos.id, mon.id));
          atualizados++;
        }
      } catch {}
    }

    return { total: locais.length, atualizados };
  }),
});
