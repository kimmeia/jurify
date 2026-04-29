import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, between, desc, eq, gte, lte, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  categoriasDespesa,
  despesas,
} from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "./db-escritorio";

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const dataInput = z.string().regex(DATA_REGEX, "Use o formato YYYY-MM-DD.");

async function requireEscritorio(userId: number) {
  const result = await getEscritorioPorUsuario(userId);
  if (!result) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Escritório não encontrado.",
    });
  }
  return result;
}

function requireGestao(cargo: string) {
  if (cargo !== "dono" && cargo !== "gestor") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Apenas dono ou gestor pode gerenciar despesas.",
    });
  }
}

export const despesasRouter = router({
  listar: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(["pendente", "pago", "vencido"]).optional(),
          categoriaId: z.number().optional(),
          periodoInicio: dataInput.optional(),
          periodoFim: dataInput.optional(),
          limit: z.number().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) return [];

      const conds = [eq(despesas.escritorioId, esc.escritorio.id)];
      if (input?.status) conds.push(eq(despesas.status, input.status));
      if (input?.categoriaId) conds.push(eq(despesas.categoriaId, input.categoriaId));
      if (input?.periodoInicio && input?.periodoFim) {
        conds.push(between(despesas.vencimento, input.periodoInicio, input.periodoFim));
      } else if (input?.periodoInicio) {
        conds.push(gte(despesas.vencimento, input.periodoInicio));
      } else if (input?.periodoFim) {
        conds.push(lte(despesas.vencimento, input.periodoFim));
      }

      return db
        .select({
          id: despesas.id,
          descricao: despesas.descricao,
          valor: despesas.valor,
          vencimento: despesas.vencimento,
          dataPagamento: despesas.dataPagamento,
          status: despesas.status,
          recorrencia: despesas.recorrencia,
          observacoes: despesas.observacoes,
          categoriaId: despesas.categoriaId,
          categoriaNome: categoriasDespesa.nome,
          createdAt: despesas.createdAt,
        })
        .from(despesas)
        .leftJoin(
          categoriasDespesa,
          eq(categoriasDespesa.id, despesas.categoriaId),
        )
        .where(and(...conds))
        .orderBy(asc(despesas.vencimento))
        .limit(input?.limit ?? 200);
    }),

  criar: protectedProcedure
    .input(
      z.object({
        descricao: z.string().min(1).max(200),
        valor: z.number().min(0.01),
        vencimento: dataInput,
        categoriaId: z.number().optional(),
        recorrencia: z.enum(["nenhuma", "semanal", "mensal", "anual"]).default("nenhuma"),
        observacoes: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [novo] = await db
        .insert(despesas)
        .values({
          escritorioId: esc.escritorio.id,
          descricao: input.descricao,
          valor: input.valor.toFixed(2),
          vencimento: input.vencimento,
          categoriaId: input.categoriaId ?? null,
          recorrencia: input.recorrencia,
          observacoes: input.observacoes ?? null,
          criadoPorUserId: ctx.user.id,
        })
        .$returningId();

      return { id: novo.id };
    }),

  atualizar: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        descricao: z.string().min(1).max(200).optional(),
        valor: z.number().min(0.01).optional(),
        vencimento: dataInput.optional(),
        categoriaId: z.number().nullable().optional(),
        recorrencia: z.enum(["nenhuma", "semanal", "mensal", "anual"]).optional(),
        observacoes: z.string().max(1000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const set: Record<string, unknown> = {};
      if (input.descricao !== undefined) set.descricao = input.descricao;
      if (input.valor !== undefined) set.valor = input.valor.toFixed(2);
      if (input.vencimento !== undefined) set.vencimento = input.vencimento;
      if (input.categoriaId !== undefined) set.categoriaId = input.categoriaId;
      if (input.recorrencia !== undefined) set.recorrencia = input.recorrencia;
      if (input.observacoes !== undefined) set.observacoes = input.observacoes;

      if (Object.keys(set).length === 0) return { success: true };

      await db
        .update(despesas)
        .set(set)
        .where(
          and(
            eq(despesas.id, input.id),
            eq(despesas.escritorioId, esc.escritorio.id),
          ),
        );
      return { success: true };
    }),

  marcarPaga: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        dataPagamento: dataInput.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const dataPag = input.dataPagamento ?? new Date().toISOString().slice(0, 10);
      await db
        .update(despesas)
        .set({ status: "pago", dataPagamento: dataPag })
        .where(
          and(
            eq(despesas.id, input.id),
            eq(despesas.escritorioId, esc.escritorio.id),
          ),
        );
      return { success: true, dataPagamento: dataPag };
    }),

  reabrir: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(despesas)
        .set({ status: "pendente", dataPagamento: null })
        .where(
          and(
            eq(despesas.id, input.id),
            eq(despesas.escritorioId, esc.escritorio.id),
          ),
        );
      return { success: true };
    }),

  excluir: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .delete(despesas)
        .where(
          and(
            eq(despesas.id, input.id),
            eq(despesas.escritorioId, esc.escritorio.id),
          ),
        );
      return { success: true };
    }),

  /** Totais agregados para o card de KPIs (no período de vencimento). */
  kpis: protectedProcedure
    .input(
      z.object({
        periodoInicio: dataInput,
        periodoFim: dataInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) {
        return { pendente: 0, pago: 0, vencido: 0, total: 0 };
      }

      const rows = await db
        .select({
          status: despesas.status,
          total: sql<string>`SUM(${despesas.valor})`,
        })
        .from(despesas)
        .where(
          and(
            eq(despesas.escritorioId, esc.escritorio.id),
            between(despesas.vencimento, input.periodoInicio, input.periodoFim),
          ),
        )
        .groupBy(despesas.status);

      const acc = { pendente: 0, pago: 0, vencido: 0, total: 0 };
      for (const r of rows) {
        const v = Number(r.total ?? "0");
        acc.total += v;
        if (r.status === "pendente") acc.pendente = v;
        else if (r.status === "pago") acc.pago = v;
        else if (r.status === "vencido") acc.vencido = v;
      }
      return acc;
    }),
});
