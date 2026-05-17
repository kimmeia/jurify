/**
 * Router admin — Logs de email (bug #6).
 *
 * Histórico persistente de TODOS os envios via Resend (sucesso e falha).
 * Antes do fix, erros viviam só no logger e somiam: domínio não verificado,
 * quota mensal estourada, bounce — admin não tinha rastro nem como reenviar.
 *
 * Procedures:
 *  - listar: lista paginada com filtros por status/tipo/destinatário
 *  - obter: detalhe de 1 log (inclui contextoJson pra debug)
 *  - reenviar: pega log + dispara novo envio com mesmo destinatário/assunto/html
 *  - resumo: contadores por status nas últimas 24h (pro dashboard admin)
 */

import { z } from "zod";
import { and, desc, eq, gte, like, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { emailLog } from "../../drizzle/schema";
import { enviarEmail } from "../_core/email";
import { createLogger } from "../_core/logger";
import { escapeLikePattern } from "../_core/sql-helpers";

const log = createLogger("admin-router-email-log");

export const adminEmailLogRouter = router({
  /** Lista paginada de envios de email (filtros opcionais). */
  listar: adminProcedure
    .input(
      z.object({
        status: z.enum(["sucesso", "falha"]).optional(),
        tipo: z.string().max(64).optional(),
        destinatario: z.string().max(320).optional(),
        limite: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { itens: [], total: 0 };

      const conds = [] as any[];
      if (input.status) conds.push(eq(emailLog.status, input.status));
      if (input.tipo) conds.push(eq(emailLog.tipo, input.tipo));
      if (input.destinatario) {
        conds.push(like(emailLog.destinatario, `%${escapeLikePattern(input.destinatario)}%`));
      }
      const whereClause = conds.length > 0 ? and(...conds) : undefined;

      const itens = await db
        .select({
          id: emailLog.id,
          tipo: emailLog.tipo,
          destinatario: emailLog.destinatario,
          assunto: emailLog.assunto,
          status: emailLog.status,
          erro: emailLog.erro,
          tentativas: emailLog.tentativas,
          escritorioId: emailLog.escritorioId,
          userId: emailLog.userId,
          ultimaTentativaEm: emailLog.ultimaTentativaEm,
          createdAt: emailLog.createdAt,
        })
        .from(emailLog)
        .where(whereClause)
        .orderBy(desc(emailLog.createdAt))
        .limit(input.limite)
        .offset(input.offset);

      const [{ total }] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(emailLog)
        .where(whereClause);

      return { itens, total: Number(total) };
    }),

  /** Obtém detalhe de 1 log (com contextoJson decodificado pra debug). */
  obter: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [reg] = await db
        .select()
        .from(emailLog)
        .where(eq(emailLog.id, input.id))
        .limit(1);

      if (!reg) throw new TRPCError({ code: "NOT_FOUND" });

      let contexto: { html?: string; text?: string } | null = null;
      if (reg.contextoJson) {
        try {
          contexto = JSON.parse(reg.contextoJson);
        } catch {
          contexto = null;
        }
      }

      return { ...reg, contexto };
    }),

  /**
   * Reenvia um email com base no log original. Tipicamente usado pra
   * casos onde o Resend rejeitou (domínio não verificado, quota etc) e
   * admin já consertou o problema.
   *
   * Incrementa `tentativas` E grava UM NOVO row no `email_log` com o
   * resultado do reenvio — preserva histórico completo de tentativas.
   */
  reenviar: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [original] = await db
        .select()
        .from(emailLog)
        .where(eq(emailLog.id, input.id))
        .limit(1);

      if (!original) throw new TRPCError({ code: "NOT_FOUND" });
      if (!original.contextoJson) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Log sem conteúdo armazenado — não há como reenviar.",
        });
      }

      let payload: { html: string; text?: string };
      try {
        payload = JSON.parse(original.contextoJson);
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "contextoJson inválido — log corrompido.",
        });
      }

      log.info(
        { logIdOriginal: original.id, destinatario: original.destinatario, tipo: original.tipo },
        "Reenvio manual de email iniciado",
      );

      // enviarEmail cria seu PRÓPRIO row no email_log com o resultado.
      // Aqui apenas incrementamos tentativas + ultimaTentativaEm do
      // original pra rastrear o vínculo.
      const resultado = await enviarEmail({
        to: original.destinatario,
        subject: original.assunto,
        html: payload.html,
        text: payload.text,
        tipo: original.tipo,
        escritorioId: original.escritorioId ?? undefined,
        userId: original.userId ?? undefined,
      });

      await db
        .update(emailLog)
        .set({
          tentativas: (original.tentativas ?? 1) + 1,
          ultimaTentativaEm: new Date(),
          // Atualiza status do log original pra refletir o último resultado.
          // Mantém o erro original em "erro" mas ajusta status. Se reenviar
          // deu certo, status volta a "sucesso" e o admin vê na lista
          // que o problema foi resolvido.
          status: resultado.success ? "sucesso" : "falha",
          erro: resultado.success ? null : (resultado.error?.slice(0, 1024) ?? null),
        })
        .where(eq(emailLog.id, original.id));

      return {
        sucesso: resultado.success,
        erro: resultado.error,
        novoLogId: resultado.logId,
      };
    }),

  /** Contadores das últimas 24h pra dashboard. */
  resumo: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { sucesso24h: 0, falha24h: 0, total24h: 0 };

    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [sucesso] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(emailLog)
      .where(and(eq(emailLog.status, "sucesso"), gte(emailLog.createdAt, desde)));

    const [falha] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(emailLog)
      .where(and(eq(emailLog.status, "falha"), gte(emailLog.createdAt, desde)));

    return {
      sucesso24h: Number(sucesso?.c ?? 0),
      falha24h: Number(falha?.c ?? 0),
      total24h: Number(sucesso?.c ?? 0) + Number(falha?.c ?? 0),
    };
  }),
});
