/**
 * Router de Notificações In-App.
 *
 * SEGURANÇA:
 * - Todas as queries filtram por ctx.user.id (isolamento por utilizador)
 * - Nunca expor notificações de outros utilizadores
 *
 * Tipos de notificação:
 * - movimentacao: nova movimentação num processo monitorado
 * - nova_acao: nova ação contra cliente monitorado por CPF/CNPJ
 *              (separado de movimentacao pra não inflar contador do
 *              dashboard que conta só movs reais)
 * - sistema: avisos do sistema (manutenção, novidades)
 * - plano: alterações no plano (upgrade, downgrade, créditos)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notificacoes, eventosProcesso, motorMonitoramentos } from "../../drizzle/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
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
  tipo: "movimentacao" | "sistema" | "plano" | "nova_acao";
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
        // Filtro opcional por tipo. Permite ao popover mostrar abas
        // (Processos / Sistema) sem precisar carregar tudo e filtrar
        // client-side — útil quando o usuário tem centenas de notifs
        // e as raras de um tipo ficam soterradas.
        tipos: z
          .array(z.enum(["movimentacao", "sistema", "plano", "nova_acao"]))
          .optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const limit = input?.limit ?? 50;
      const apenasNaoLidas = input?.apenasNaoLidas ?? false;
      const tipos = input?.tipos;

      const conditions = [eq(notificacoes.userId, ctx.user.id)];
      if (apenasNaoLidas) {
        conditions.push(eq(notificacoes.lida, false));
      }
      if (tipos && tipos.length > 0) {
        conditions.push(inArray(notificacoes.tipo, tipos));
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

  /**
   * Detalhe de uma movimentação a partir do eventoId vinculado a uma
   * notificação. Permite ao popover abrir um drawer com texto completo
   * + dados do monitoramento (CNJ, apelido, tribunal) sem que o usuário
   * precise navegar até /processos e procurar a movimentação.
   *
   * SEGURANÇA: filtra por escritório do user — protege contra deep-link
   * forjado com eventoId de outro escritório.
   */
  detalheEvento: protectedProcedure
    .input(z.object({ eventoId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      // JOIN com motor_monitoramentos pra trazer apelido/searchKey/tribunal.
      // Sem o JOIN, evento bruto não tem o nome amigável do cliente.
      const [row] = await db
        .select({
          id: eventosProcesso.id,
          tipo: eventosProcesso.tipo,
          dataEvento: eventosProcesso.dataEvento,
          conteudo: eventosProcesso.conteudo,
          conteudoJson: eventosProcesso.conteudoJson,
          cnjAfetado: eventosProcesso.cnjAfetado,
          fonte: eventosProcesso.fonte,
          lido: eventosProcesso.lido,
          createdAt: eventosProcesso.createdAt,
          escritorioId: eventosProcesso.escritorioId,
          monitoramentoId: eventosProcesso.monitoramentoId,
          apelido: motorMonitoramentos.apelido,
          searchKey: motorMonitoramentos.searchKey,
          searchType: motorMonitoramentos.searchType,
          tribunal: motorMonitoramentos.tribunal,
        })
        .from(eventosProcesso)
        .leftJoin(
          motorMonitoramentos,
          eq(motorMonitoramentos.id, eventosProcesso.monitoramentoId),
        )
        .where(eq(eventosProcesso.id, input.eventoId))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Evento não encontrado" });
      }

      // Resolve escritório do user — comparar com escritorioId do
      // evento. Sem isso, qualquer user logado lê eventos de qualquer
      // escritório passando o ID.
      const { getEscritorioPorUsuario } = await import("../escritorio/db-escritorio");
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc || esc.escritorio.id !== row.escritorioId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Evento não encontrado" });
      }

      return row;
    }),
});
