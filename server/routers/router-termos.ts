/**
 * Aceite dos Termos de Uso — status e re-aceite do gate bloqueante.
 *
 * O gate trava só o DONO do escritório (quem responde pelo contrato)
 * quando a versão aceita ficou pra trás. Admin e impersonação nunca
 * aceitam: aceite é ato pessoal do contratante — um admin navegando na
 * conta não pode "concordar" por ele.
 */

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { aceitesTermos, users } from "../../drizzle/schema";
import {
  TERMOS_ATUALIZADO_EM,
  TERMOS_MUDANCAS_V2,
  TERMOS_VERSAO,
  precisaAceitarTermos,
} from "@shared/termos";
import { createLogger } from "../_core/logger";

const log = createLogger("termos");

export const termosRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const base = {
      precisaAceitar: false,
      versaoAtual: TERMOS_VERSAO,
      atualizadoEm: TERMOS_ATUALIZADO_EM,
      mudancas: TERMOS_MUDANCAS_V2,
    };
    // Fail-open consciente: erro na consulta não pode trancar o app inteiro.
    try {
      const db = await getDb();
      if (!db) return base;

      let ehDono = false;
      if (ctx.user.role !== "admin" && !ctx.user.impersonatedBy) {
        const { getEscritorioPorUsuario } = await import("../escritorio/db-escritorio");
        const vinculo = await getEscritorioPorUsuario(ctx.user.id);
        ehDono = vinculo?.colaborador?.cargo === "dono";
      }

      const [row] = await db
        .select({ termosVersaoAceita: users.termosVersaoAceita })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      return {
        ...base,
        precisaAceitar: precisaAceitarTermos({
          role: ctx.user.role,
          impersonado: Boolean(ctx.user.impersonatedBy),
          ehDono,
          versaoAceita: row?.termosVersaoAceita ?? 0,
        }),
      };
    } catch (err) {
      log.error({ err }, "[termos] falha ao resolver status — liberando");
      return base;
    }
  }),

  aceitar: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.impersonatedBy) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Aceite é ato pessoal do dono — não vale em impersonação.",
      });
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

    const agora = new Date();
    const ip = ctx.req?.ip ?? null;

    await db
      .update(users)
      .set({ aceitouTermosEm: agora, termosVersaoAceita: TERMOS_VERSAO })
      .where(eq(users.id, ctx.user.id));
    await db.insert(aceitesTermos).values({
      userId: ctx.user.id,
      versao: TERMOS_VERSAO,
      contexto: "reaceite",
      ip,
    });

    log.info({ userId: ctx.user.id, versao: TERMOS_VERSAO }, "[termos] re-aceite registrado");
    return { ok: true, versao: TERMOS_VERSAO };
  }),
});
