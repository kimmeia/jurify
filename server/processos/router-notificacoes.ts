/**
 * Router de Notificações In-App.
 * 
 * SEGURANÇA:
 * - Todas as queries filtram por ctx.user.id (isolamento por utilizador)
 * - Nunca expor notificações de outros utilizadores
 * 
 * Tipos de notificação:
 * - movimentacao: nova movimentação num processo monitorado
 * - sistema: avisos do sistema (manutenção, novidades)
 * - plano: alterações no plano (upgrade, downgrade, créditos)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notificacoes } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "../_core/logger";
const log = createLogger("processos-router-notificacoes");

// ============================================================
// Helper para criar notificações (usado por outros módulos)
// ============================================================

/**
 * Cria uma notificação in-app para um utilizador.
 * Pode ser chamado de qualquer módulo do backend.
 */
export async function criarNotificacao(params: {
  userId: number;
  titulo: string;
  mensagem: string;
  tipo: "movimentacao" | "sistema" | "plano";
  processoId?: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    log.warn("[Notificações] Base de dados indisponível, notificação não criada");
    return;
  }

  await db.insert(notificacoes).values({
    userId: params.userId,
    titulo: params.titulo,
    mensagem: params.mensagem,
    tipo: params.tipo,
    processoId: params.processoId ?? null,
  });
}

// ============================================================
// Router
// ============================================================

export const notificacoesRouter = router({
  /**
   * Listar notificações do utilizador (mais recentes primeiro).
   * SEGURANÇA: filtra por ctx.user.id
   */
  listar: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        apenasNaoLidas: z.boolean().default(false),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const limit = input?.limit ?? 50;
      const apenasNaoLidas = input?.apenasNaoLidas ?? false;

      const conditions = [eq(notificacoes.userId, ctx.user.id)];
      if (apenasNaoLidas) {
        conditions.push(eq(notificacoes.lida, false));
      }

      const items = await db
        .select()
        .from(notificacoes)
        .where(and(...conditions))
        .orderBy(desc(notificacoes.createdAt))
        .limit(limit);

      return items;
    }),

  /**
   * Contar notificações não lidas.
   * SEGURANÇA: filtra por ctx.user.id
   */
  contarNaoLidas: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notificacoes)
      .where(
        and(
          eq(notificacoes.userId, ctx.user.id),
          eq(notificacoes.lida, false)
        )
      );

    return { count: result?.count ?? 0 };
  }),

  /**
   * Marcar uma notificação como lida.
   * SEGURANÇA: verifica que a notificação pertence ao ctx.user.id
   */
  marcarLida: protectedProcedure
    .input(z.object({ notificacaoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const result = await db
        .update(notificacoes)
        .set({ lida: true })
        .where(
          and(
            eq(notificacoes.id, input.notificacaoId),
            eq(notificacoes.userId, ctx.user.id)
          )
        );

      return { success: true };
    }),

  /**
   * Marcar todas as notificações como lidas.
   * SEGURANÇA: filtra por ctx.user.id
   */
  marcarTodasLidas: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

    await db
      .update(notificacoes)
      .set({ lida: true })
      .where(
        and(
          eq(notificacoes.userId, ctx.user.id),
          eq(notificacoes.lida, false)
        )
      );

    return { success: true };
  }),

  /**
   * Apagar uma notificação.
   * SEGURANÇA: verifica que a notificação pertence ao ctx.user.id
   */
  apagar: protectedProcedure
    .input(z.object({ notificacaoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      await db
        .delete(notificacoes)
        .where(
          and(
            eq(notificacoes.id, input.notificacaoId),
            eq(notificacoes.userId, ctx.user.id)
          )
        );

      return { success: true };
    }),

  /**
   * Apagar todas as notificações lidas.
   * SEGURANÇA: filtra por ctx.user.id
   */
  limparLidas: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

    await db
      .delete(notificacoes)
      .where(
        and(
          eq(notificacoes.userId, ctx.user.id),
          eq(notificacoes.lida, true)
        )
      );

    return { success: true };
  }),
});
