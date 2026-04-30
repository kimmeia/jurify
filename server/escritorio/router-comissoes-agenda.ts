/**
 * Router de agenda de lançamento automático de comissões. CRUD da
 * config + leitura do log de execuções.
 *
 * Permissões: dono ou gestor (igual ao restante de Comissões).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { comissoesAgenda, comissoesLancamentosLog } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "./db-escritorio";

async function requireGestor(userId: number) {
  const result = await getEscritorioPorUsuario(userId);
  if (!result) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Escritório não encontrado." });
  }
  if (result.colaborador.cargo !== "dono" && result.colaborador.cargo !== "gestor") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Apenas dono ou gestor pode operar comissões." });
  }
  return result;
}

const horaInput = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use formato HH:MM (24h)");

export const comissoesAgendaRouter = router({
  /** Lê a config atual. Retorna `null` se ainda não foi configurada. */
  obter: protectedProcedure.query(async ({ ctx }) => {
    const esc = await requireGestor(ctx.user.id);
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select()
      .from(comissoesAgenda)
      .where(eq(comissoesAgenda.escritorioId, esc.escritorio.id))
      .limit(1);
    return row || null;
  }),

  /** Cria ou atualiza a config (upsert por escritórioId). */
  salvar: protectedProcedure
    .input(
      z.object({
        ativo: z.boolean(),
        diaDoMes: z.number().int().min(1).max(31),
        horaLocal: horaInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireGestor(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [existente] = await db
        .select({ id: comissoesAgenda.id })
        .from(comissoesAgenda)
        .where(eq(comissoesAgenda.escritorioId, esc.escritorio.id))
        .limit(1);

      if (existente) {
        await db
          .update(comissoesAgenda)
          .set({
            ativo: input.ativo,
            diaDoMes: input.diaDoMes,
            horaLocal: input.horaLocal,
          })
          .where(eq(comissoesAgenda.id, existente.id));
        return { id: existente.id };
      }

      const [r] = await db
        .insert(comissoesAgenda)
        .values({
          escritorioId: esc.escritorio.id,
          ativo: input.ativo,
          diaDoMes: input.diaDoMes,
          horaLocal: input.horaLocal,
          criadoPorUserId: ctx.user.id,
        })
        .$returningId();
      return { id: r.id };
    }),

  /** Lista as últimas N execuções (sucesso/falha) pra exibir histórico. */
  listarLog: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await requireGestor(ctx.user.id);
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(comissoesLancamentosLog)
        .where(eq(comissoesLancamentosLog.escritorioId, esc.escritorio.id))
        .orderBy(desc(comissoesLancamentosLog.iniciadoEm))
        .limit(input?.limit ?? 20);
      return rows.map((r) => ({
        ...r,
        iniciadoEm: r.iniciadoEm ? r.iniciadoEm.toISOString() : null,
        finalizadoEm: r.finalizadoEm ? r.finalizadoEm.toISOString() : null,
      }));
    }),
});
