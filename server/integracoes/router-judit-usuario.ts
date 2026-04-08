/**
 * Router tRPC — Judit.IO para Usuários
 *
 * Permite que clientes com plano ativo consultem e monitorem processos via Judit.IO.
 * A API key é do admin (armazenada em admin_integracoes) — o usuário nunca a vê.
 *
 * Segurança:
 * - protectedProcedure (requer login)
 * - Todas as queries filtram por ctx.user.id
 * - Verificação de plano antes de criar monitoramento
 * - Consome créditos por consulta
 *
 * Limites por plano (em plan-limits.ts):
 * - free: 0 monitoramentos (sem acesso)
 * - basic: 5 monitoramentos
 * - professional: 50 monitoramentos
 * - enterprise: ilimitado
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getActiveSubscription, consumirCredito } from "../db";
import { juditMonitoramentos, juditRespostas } from "../../drizzle/schema";
import { eq, and, desc, or, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getJuditClient } from "./judit-webhook";
import { getLimites } from "../billing/plan-limits";

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function requireJuditDisponivel() {
  const client = await getJuditClient();
  if (!client) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Serviço de monitoramento processual indisponível no momento.",
    });
  }
  return client;
}

async function verificarPlanoJudit(userId: number) {
  const sub = await getActiveSubscription(userId);
  const planId = sub?.planId || "free";
  const limites = getLimites(planId);

  if (!limites.modulosPermitidos.includes("monitoramento_judit")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Seu plano não inclui monitoramento processual. Faça upgrade para ter acesso.",
    });
  }

  return { planId, limites, sub };
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
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

export const juditUsuarioRouter = router({
  /**
   * Verifica se o serviço Judit está disponível e se o plano do usuário dá acesso.
   * Não expõe nenhum dado da API key.
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    const client = await getJuditClient();
    const juditConectado = !!client;

    const sub = await getActiveSubscription(ctx.user.id);
    const planId = sub?.planId || "free";
    const limites = getLimites(planId);
    const planoPermite = limites.modulosPermitidos.includes("monitoramento_judit");

    let monitoramentosAtivos = 0;
    if (juditConectado && planoPermite) {
      monitoramentosAtivos = await contarMonitoramentosAtivos(ctx.user.id);
    }

    return {
      disponivel: juditConectado && planoPermite,
      juditConectado,
      planoPermite,
      planId,
      monitoramentosAtivos,
      maxMonitoramentos: limites.maxMonitoramentosJudit,
    };
  }),

  /**
   * Consulta um processo por CNJ. Consome 1 crédito.
   * Retorna dados completos do processo direto dos tribunais.
   */
  consultarProcesso: protectedProcedure
    .input(z.object({
      numeroCnj: z.string().min(20).max(25),
    }))
    .mutation(async ({ ctx, input }) => {
      await verificarPlanoJudit(ctx.user.id);
      const client = await requireJuditDisponivel();

      // Consumir crédito
      const creditoOk = await consumirCredito(ctx.user.id);
      if (!creditoOk) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Créditos insuficientes. Adquira mais créditos ou faça upgrade do plano.",
        });
      }

      // Criar consulta na Judit
      const request = await client.criarRequest({
        search: {
          search_type: "lawsuit_cnj",
          search_key: input.numeroCnj,
        },
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
        return {
          encontrado: false,
          mensagem: "Consulta em andamento. Tente novamente em alguns segundos.",
        };
      }

      const lawsuits = responses.page_data.filter((r) => r.response_type === "lawsuit");
      if (lawsuits.length === 0) {
        const erros = responses.page_data.filter((r) => r.response_type === "application_error");
        return {
          encontrado: false,
          mensagem: erros.length > 0 ? ((erros[0].response_data as { message?: string })?.message || "Processo não encontrado") : "Nenhum resultado encontrado",
        };
      }

      return {
        encontrado: true,
        processo: lawsuits[0].response_data,
        totalInstancias: lawsuits.length,
      };
    }),

  /**
   * Cria um monitoramento processual por CNJ.
   * Verificações: plano, limite de monitoramentos, duplicata.
   */
  criarMonitoramento: protectedProcedure
    .input(z.object({
      numeroCnj: z.string().min(20).max(25),
      apelido: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { limites } = await verificarPlanoJudit(ctx.user.id);
      const client = await requireJuditDisponivel();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Verificar limite de monitoramentos
      const ativos = await contarMonitoramentosAtivos(ctx.user.id);
      if (ativos >= limites.maxMonitoramentosJudit) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Limite de ${limites.maxMonitoramentosJudit} monitoramentos atingido. Faça upgrade para monitorar mais processos.`,
        });
      }

      // Verificar duplicata
      const existente = await db
        .select()
        .from(juditMonitoramentos)
        .where(
          and(
            eq(juditMonitoramentos.searchKey, input.numeroCnj),
            eq(juditMonitoramentos.clienteUserId, ctx.user.id),
            or(
              eq(juditMonitoramentos.statusJudit, "created"),
              eq(juditMonitoramentos.statusJudit, "updating"),
              eq(juditMonitoramentos.statusJudit, "updated")
            )
          )
        )
        .limit(1);

      if (existente.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Você já está monitorando este processo.",
        });
      }

      // Criar na Judit (recorrência diária)
      const tracking = await client.criarMonitoramento({
        recurrence: 1,
        search: {
          search_type: "lawsuit_cnj",
          search_key: input.numeroCnj,
        },
        with_attachments: false,
      });

      // Salvar localmente vinculado ao usuário
      await db.insert(juditMonitoramentos).values({
        trackingId: tracking.tracking_id,
        searchType: "lawsuit_cnj",
        searchKey: input.numeroCnj,
        recurrence: 1,
        statusJudit: tracking.status as any,
        apelido: input.apelido || null,
        clienteUserId: ctx.user.id,
        withAttachments: false,
      });

      return {
        success: true,
        trackingId: tracking.tracking_id,
        mensagem: "Monitoramento criado. Você receberá atualizações diárias.",
      };
    }),

  /**
   * Lista monitoramentos do usuário logado.
   */
  meusMonitoramentos: protectedProcedure
    .input(z.object({
      busca: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions: any[] = [
        eq(juditMonitoramentos.clienteUserId, ctx.user.id),
        or(
          eq(juditMonitoramentos.statusJudit, "created"),
          eq(juditMonitoramentos.statusJudit, "updating"),
          eq(juditMonitoramentos.statusJudit, "updated"),
          eq(juditMonitoramentos.statusJudit, "paused")
        ),
      ];

      if (input?.busca) {
        const b = `%${input.busca}%`;
        conditions.push(
          or(
            like(juditMonitoramentos.searchKey, b),
            like(juditMonitoramentos.apelido, b),
            like(juditMonitoramentos.nomePartes, b)
          )
        );
      }

      return db
        .select()
        .from(juditMonitoramentos)
        .where(and(...conditions))
        .orderBy(desc(juditMonitoramentos.updatedAt));
    }),

  /**
   * Pausa um monitoramento (somente o próprio).
   */
  pausar: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const client = await requireJuditDisponivel();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [mon] = await db.select().from(juditMonitoramentos)
        .where(and(eq(juditMonitoramentos.id, input.id), eq(juditMonitoramentos.clienteUserId, ctx.user.id)))
        .limit(1);

      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });

      await client.pausarMonitoramento(mon.trackingId);
      await db.update(juditMonitoramentos).set({ statusJudit: "paused" }).where(eq(juditMonitoramentos.id, input.id));

      return { success: true };
    }),

  /**
   * Reativa um monitoramento pausado (somente o próprio).
   */
  reativar: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const client = await requireJuditDisponivel();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [mon] = await db.select().from(juditMonitoramentos)
        .where(and(eq(juditMonitoramentos.id, input.id), eq(juditMonitoramentos.clienteUserId, ctx.user.id)))
        .limit(1);

      if (!mon) throw new TRPCError({ code: "NOT_FOUND" });

      await client.reativarMonitoramento(mon.trackingId);
      await db.update(juditMonitoramentos).set({ statusJudit: "updated" }).where(eq(juditMonitoramentos.id, input.id));

      return { success: true };
    }),

  /**
   * Remove um monitoramento (somente o próprio).
   */
  deletar: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const client = await requireJuditDisponivel();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [mon] = await db.select().from(juditMonitoramentos)
        .where(and(eq(juditMonitoramentos.id, input.id), eq(juditMonitoramentos.clienteUserId, ctx.user.id)))
        .limit(1);

      if (!mon) throw new TRPCError({ code: "NOT_FOUND" });

      await client.deletarMonitoramento(mon.trackingId);
      await db.update(juditMonitoramentos).set({ statusJudit: "deleted" }).where(eq(juditMonitoramentos.id, input.id));

      return { success: true };
    }),

  /**
   * Histórico de atualizações de um monitoramento (somente o próprio).
   */
  historico: protectedProcedure
    .input(z.object({
      monitoramentoId: z.number(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };

      // Verificar que o monitoramento pertence ao usuário
      const [mon] = await db.select().from(juditMonitoramentos)
        .where(and(eq(juditMonitoramentos.id, input.monitoramentoId), eq(juditMonitoramentos.clienteUserId, ctx.user.id)))
        .limit(1);

      if (!mon) throw new TRPCError({ code: "NOT_FOUND" });

      const items = await db
        .select()
        .from(juditRespostas)
        .where(eq(juditRespostas.monitoramentoId, input.monitoramentoId))
        .orderBy(desc(juditRespostas.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const all = await db
        .select({ id: juditRespostas.id })
        .from(juditRespostas)
        .where(eq(juditRespostas.monitoramentoId, input.monitoramentoId));

      return { items, total: all.length };
    }),
});
