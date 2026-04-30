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
          status: z.enum(["pendente", "parcial", "pago", "vencido"]).optional(),
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
          valorPago: despesas.valorPago,
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

  /**
   * Registra um pagamento (parcial ou total). Soma ao acumulador
   * `valorPago`. Quando atingir/superar o `valor` da despesa, status
   * vai pra "pago" e `dataPagamento` é gravada. Antes disso, status
   * fica "parcial".
   *
   * Para "marcar paga totalmente" sem detalhar valor, o front pode
   * mandar `valor` igual ao restante (utilitário inferido na UI).
   */
  registrarPagamento: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        valor: z.number().min(0.01),
        dataPagamento: dataInput.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Lê valor + valorPago atuais pra calcular novo estado.
      const [d] = await db
        .select({
          valor: despesas.valor,
          valorPago: despesas.valorPago,
        })
        .from(despesas)
        .where(
          and(
            eq(despesas.id, input.id),
            eq(despesas.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND" });

      const valorTotal = Number(d.valor);
      const acumuladoAntes = Number(d.valorPago);
      const novoAcumulado = acumuladoAntes + input.valor;

      // Trava: não permite pagar mais que o devido (resto exato).
      // Pequena folga de 1 centavo pra absorver arredondamento.
      if (novoAcumulado > valorTotal + 0.01) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Valor excede o restante (R$ ${(valorTotal - acumuladoAntes).toFixed(2)}).`,
        });
      }

      const quitou = novoAcumulado >= valorTotal - 0.01;
      const dataPag = input.dataPagamento ?? new Date().toISOString().slice(0, 10);

      await db
        .update(despesas)
        .set({
          valorPago: novoAcumulado.toFixed(2),
          status: quitou ? "pago" : "parcial",
          // Só preenche dataPagamento quando totalmente quitada.
          dataPagamento: quitou ? dataPag : null,
        })
        .where(
          and(
            eq(despesas.id, input.id),
            eq(despesas.escritorioId, esc.escritorio.id),
          ),
        );
      return {
        success: true,
        quitou,
        valorPago: novoAcumulado.toFixed(2),
        restante: Math.max(0, valorTotal - novoAcumulado).toFixed(2),
      };
    }),

  /** Atalho legado: marca total como pago (equivale a registrar
   *  pagamento do restante). Mantido pra compat com chamadores antigos. */
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
      // Pega o valor pra setar valorPago = valor (quitado total).
      const [d] = await db
        .select({ valor: despesas.valor })
        .from(despesas)
        .where(
          and(
            eq(despesas.id, input.id),
            eq(despesas.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND" });

      await db
        .update(despesas)
        .set({
          status: "pago",
          dataPagamento: dataPag,
          valorPago: d.valor,
        })
        .where(
          and(
            eq(despesas.id, input.id),
            eq(despesas.escritorioId, esc.escritorio.id),
          ),
        );
      return { success: true, dataPagamento: dataPag };
    }),

  /** Reabre despesa: zera acumulador e volta pra "pendente". */
  reabrir: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(despesas)
        .set({
          status: "pendente",
          dataPagamento: null,
          valorPago: "0.00",
        })
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

      // Com pagamento parcial, agregamos por linha:
      //  - pago = SUM(valorPago) — quanto efetivamente saiu do caixa
      //  - pendente = SUM(valor - valorPago) das não vencidas
      //  - vencido = SUM(valor - valorPago) das vencidas
      //  - total = SUM(valor) — valor nominal das despesas no período
      const rows = await db
        .select({
          status: despesas.status,
          valor: sql<string>`SUM(${despesas.valor})`,
          valorPago: sql<string>`SUM(${despesas.valorPago})`,
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
        const v = Number(r.valor ?? "0");
        const p = Number(r.valorPago ?? "0");
        const restante = Math.max(0, v - p);
        acc.total += v;
        acc.pago += p;
        if (r.status === "vencido") acc.vencido += restante;
        else if (r.status === "pendente" || r.status === "parcial")
          acc.pendente += restante;
        // status='pago' não acumula em pendente/vencido (totalmente quitada).
      }
      return acc;
    }),
});
