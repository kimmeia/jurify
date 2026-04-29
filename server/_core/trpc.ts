import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { createLogger } from "./logger";
import { captureError } from "./sentry";

const errLog = createLogger("trpc-error");

// Códigos esperados — auth/permission/input. Não logam como erro do servidor;
// são fluxos normais (ex: usuário sem permissão, body inválido).
const EXPECTED_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "BAD_REQUEST",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "TOO_MANY_REQUESTS",
  "UNPROCESSABLE_CONTENT",
]);

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    if (!EXPECTED_CODES.has(shape.data.code)) {
      // Erro inesperado do servidor — log estruturado pra rastreio.
      errLog.error(
        {
          code: shape.data.code,
          path: shape.data.path,
          httpStatus: shape.data.httpStatus,
          err: error.cause instanceof Error ? error.cause.stack : error.stack,
        },
        `tRPC error: ${error.message}`,
      );
      captureError(error.cause ?? error, {
        kind: "trpc",
        code: shape.data.code,
        path: shape.data.path,
        httpStatus: shape.data.httpStatus,
      });
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  // ─── Bloqueio de conta individual ─────────────────────────────────
  // Já é checado em authenticateRequest, mas double-check aqui pra
  // garantir que sessões antigas (cookie ainda válido) sejam bloqueadas.
  // EXCEÇÃO: admin impersonando — usa a permissão do impersonator.
  if (ctx.user.bloqueado && !ctx.user.impersonatedBy) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Conta bloqueada${ctx.user.motivoBloqueio ? `: ${ctx.user.motivoBloqueio}` : ""}.`,
    });
  }

  // ─── Suspensão do escritório / Remoção de colaborador ──────────────
  // Se o usuário pertence a um escritório suspenso OU foi removido
  // (colaborador.ativo = false sem nenhum vínculo ativo), bloqueia tudo.
  // EXCETO: rotas admin (que usa adminProcedure).
  // Auth/me/logout do próprio usuário NÃO chegam aqui — usam publicProcedure.
  if (ctx.user.role !== "admin" && !ctx.user.impersonatedBy) {
    try {
      const { getDb } = await import("../db");
      const { escritorios, colaboradores } = await import("../../drizzle/schema");
      const { and, eq } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        // 1. Vínculo ATIVO — verifica suspensão do escritório
        const [vincAtivo] = await db
          .select({ suspenso: escritorios.suspenso, motivo: escritorios.motivoSuspensao })
          .from(colaboradores)
          .innerJoin(escritorios, eq(colaboradores.escritorioId, escritorios.id))
          .where(and(eq(colaboradores.userId, ctx.user.id), eq(colaboradores.ativo, true)))
          .limit(1);

        if (vincAtivo?.suspenso) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Escritório suspenso${vincAtivo.motivo ? `: ${vincAtivo.motivo}` : ""}. Entre em contato com o suporte.`,
          });
        }

        // 2. Sem vínculo ativo — checa se foi removido (existe vínculo
        //    inativo) vs. se nunca pertenceu a escritório (caso de novo
        //    usuário em onboarding).
        if (!vincAtivo) {
          const [vincInativo] = await db
            .select({ id: colaboradores.id })
            .from(colaboradores)
            .where(and(eq(colaboradores.userId, ctx.user.id), eq(colaboradores.ativo, false)))
            .limit(1);

          if (vincInativo) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Você foi removido do escritório. Faça login novamente para acessar outro escritório.",
            });
          }
          // Sem vínculo nenhum: usuário em onboarding — permite (rotas
          // públicas como subscription, plans, criar escritório funcionam).
        }
      }
    } catch (err) {
      // Re-lança erros de TRPC (suspensão / removido). Outros erros
      // (ex: tabela não existe ainda em ambiente parcial) não bloqueiam.
      if (err instanceof TRPCError) throw err;
    }
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
