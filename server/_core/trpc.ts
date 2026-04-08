import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
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

  // ─── Suspensão do escritório ───────────────────────────────────────
  // Se o usuário pertence a um escritório suspenso, bloqueia tudo
  // EXCETO: rotas de auth (logout, me) e admin (que usa adminProcedure).
  // Isso é checado lazy: só consultamos o escritório se o user não for
  // admin (admin do Jurify continua acessando tudo).
  if (ctx.user.role !== "admin" && !ctx.user.impersonatedBy) {
    try {
      const { getDb } = await import("../db");
      const { escritorios, colaboradores } = await import("../../drizzle/schema");
      const { and, eq } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        const [vinc] = await db
          .select({ suspenso: escritorios.suspenso, motivo: escritorios.motivoSuspensao })
          .from(colaboradores)
          .innerJoin(escritorios, eq(colaboradores.escritorioId, escritorios.id))
          .where(and(eq(colaboradores.userId, ctx.user.id), eq(colaboradores.ativo, true)))
          .limit(1);
        if (vinc?.suspenso) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Escritório suspenso${vinc.motivo ? `: ${vinc.motivo}` : ""}. Entre em contato com o suporte.`,
          });
        }
      }
    } catch (err) {
      // Se a query falhar (ex: tabela não existe ainda), não bloqueia
      // — preserva o comportamento atual em ambientes parciais.
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
