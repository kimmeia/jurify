import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  asaasCobrancas,
  colaboradores,
  comissoesFechadas,
  comissoesFechadasItens,
  despesas,
  users,
} from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { checkPermission } from "./check-permission";
import { diagnosticarComissao, fecharComissao, FechamentoJaExisteError, simularComissao } from "./db-comissoes";

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

/**
 * Gate único do módulo Comissões. Respeita a matriz de permissões
 * (`checkPermission`) — funciona com cargos legados (dono/gestor) e
 * cargos personalizados configurados pelo admin via flag `financeiro.<acao>`.
 *
 * Substituiu o antigo `requireGestao(cargo)` hardcode dono/gestor, que
 * ignorava cargos personalizados.
 */
async function exigirAcaoFinanceiro(
  userId: number,
  acao: "ver" | "criar" | "editar" | "excluir",
): Promise<void> {
  const perm = await checkPermission(userId, "financeiro", acao);
  const ok =
    (acao === "ver" && (perm.verTodos || perm.verProprios)) ||
    (acao === "criar" && perm.criar) ||
    (acao === "editar" && perm.editar) ||
    (acao === "excluir" && perm.excluir);
  if (!ok) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Sem permissão para ${acao} no módulo Financeiro.`,
    });
  }
}

// Função `simularComissao` foi extraída pra `db-comissoes.ts` —
// reutilizada pelo cron worker de fechamento automático.

export const comissoesRouter = router({
  simular: protectedProcedure
    .input(
      z.object({
        atendenteId: z.number(),
        periodoInicio: dataInput,
        periodoFim: dataInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      if (input.periodoInicio > input.periodoFim) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Período inválido: início depois do fim.",
        });
      }
      return simularComissao(
        esc.escritorio.id,
        input.atendenteId,
        input.periodoInicio,
        input.periodoFim,
      );
    }),

  /**
   * Diagnóstico — compara cobranças pagas no período (TODAS do escritório)
   * com o que entra na comissão do atendente filtrado. Retorna lista de
   * cobranças com motivo claro pra cada exclusão. Útil pra responder
   * "por que minha comissão tá menor que o total recebido".
   */
  diagnosticar: protectedProcedure
    .input(
      z.object({
        atendenteId: z.number(),
        periodoInicio: dataInput,
        periodoFim: dataInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      if (input.periodoInicio > input.periodoFim) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Período inválido: início depois do fim.",
        });
      }
      return diagnosticarComissao(
        esc.escritorio.id,
        input.atendenteId,
        input.periodoInicio,
        input.periodoFim,
      );
    }),

  fechar: protectedProcedure
    .input(
      z.object({
        atendenteId: z.number(),
        periodoInicio: dataInput,
        periodoFim: dataInput,
        observacoes: z.string().max(500).optional(),
        /**
         * Por default rejeita duplicar fechamento existente. UI deve
         * mostrar dialog "já existe — quer mesmo criar outro?" e re-
         * tentar com `forcarDuplicado:true` se o operador confirmar
         * (caso documentado de re-fechamento após correção).
         */
        forcarDuplicado: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "criar");
      try {
        const r = await fecharComissao({
          escritorioId: esc.escritorio.id,
          atendenteId: input.atendenteId,
          periodoInicio: input.periodoInicio,
          periodoFim: input.periodoFim,
          fechadoPorUserId: ctx.user.id,
          origem: "manual",
          observacoes: input.observacoes ?? null,
          forcarDuplicado: input.forcarDuplicado ?? false,
        });
        return { status: "criado" as const, id: r.id };
      } catch (err) {
        if (err instanceof FechamentoJaExisteError) {
          // Resposta estruturada (não exception) — UI decide se mostra
          // dialog "Ver existente" / "Criar mesmo assim".
          return {
            status: "duplicado" as const,
            existenteId: err.comissaoFechadaId,
            origem: err.origem,
          };
        }
        throw err;
      }
    }),

  listarFechamentos: protectedProcedure
    .input(
      z
        .object({
          atendenteId: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      const db = await getDb();
      if (!db) return [];

      const conds = [eq(comissoesFechadas.escritorioId, esc.escritorio.id)];
      if (input?.atendenteId) {
        conds.push(eq(comissoesFechadas.atendenteId, input.atendenteId));
      }

      return db
        .select({
          id: comissoesFechadas.id,
          atendenteId: comissoesFechadas.atendenteId,
          atendenteNome: users.name,
          periodoInicio: comissoesFechadas.periodoInicio,
          periodoFim: comissoesFechadas.periodoFim,
          totalComissao: comissoesFechadas.totalComissao,
          aliquotaUsada: comissoesFechadas.aliquotaUsada,
          fechadoEm: comissoesFechadas.fechadoEm,
          observacoes: comissoesFechadas.observacoes,
        })
        .from(comissoesFechadas)
        .innerJoin(
          colaboradores,
          eq(colaboradores.id, comissoesFechadas.atendenteId),
        )
        .innerJoin(users, eq(users.id, colaboradores.userId))
        .where(and(...conds))
        .orderBy(desc(comissoesFechadas.fechadoEm));
    }),

  obterFechamento: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "ver");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [cabec] = await db
        .select({
          id: comissoesFechadas.id,
          escritorioId: comissoesFechadas.escritorioId,
          atendenteId: comissoesFechadas.atendenteId,
          atendenteNome: users.name,
          periodoInicio: comissoesFechadas.periodoInicio,
          periodoFim: comissoesFechadas.periodoFim,
          totalBrutoRecebido: comissoesFechadas.totalBrutoRecebido,
          totalComissionavel: comissoesFechadas.totalComissionavel,
          totalNaoComissionavel: comissoesFechadas.totalNaoComissionavel,
          totalComissao: comissoesFechadas.totalComissao,
          aliquotaUsada: comissoesFechadas.aliquotaUsada,
          modoUsado: comissoesFechadas.modoUsado,
          baseFaixaUsada: comissoesFechadas.baseFaixaUsada,
          faixasUsadas: comissoesFechadas.faixasUsadas,
          valorMinimoUsado: comissoesFechadas.valorMinimoUsado,
          fechadoEm: comissoesFechadas.fechadoEm,
          observacoes: comissoesFechadas.observacoes,
        })
        .from(comissoesFechadas)
        .innerJoin(
          colaboradores,
          eq(colaboradores.id, comissoesFechadas.atendenteId),
        )
        .innerJoin(users, eq(users.id, colaboradores.userId))
        .where(eq(comissoesFechadas.id, input.id))
        .limit(1);

      if (!cabec || cabec.escritorioId !== esc.escritorio.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const itens = await db
        .select({
          asaasCobrancaId: comissoesFechadasItens.asaasCobrancaId,
          valor: comissoesFechadasItens.valor,
          foiComissionavel: comissoesFechadasItens.foiComissionavel,
          motivoExclusao: comissoesFechadasItens.motivoExclusao,
          descricao: asaasCobrancas.descricao,
          dataPagamento: asaasCobrancas.dataPagamento,
        })
        .from(comissoesFechadasItens)
        .leftJoin(
          asaasCobrancas,
          eq(asaasCobrancas.id, comissoesFechadasItens.asaasCobrancaId),
        )
        .where(eq(comissoesFechadasItens.comissaoFechadaId, input.id));

      return { ...cabec, itens };
    }),

  excluirFechamento: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await exigirAcaoFinanceiro(ctx.user.id, "excluir");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [existente] = await db
        .select({
          escritorioId: comissoesFechadas.escritorioId,
          despesaId: comissoesFechadas.despesaId,
        })
        .from(comissoesFechadas)
        .where(eq(comissoesFechadas.id, input.id))
        .limit(1);
      if (!existente || existente.escritorioId !== esc.escritorio.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Cascata da despesa automática vinculada — só se ainda pendente.
      // Despesa já paga fica preservada (não rebobinar histórico
      // financeiro com efeito real).
      if (existente.despesaId) {
        await db
          .delete(despesas)
          .where(
            and(eq(despesas.id, existente.despesaId), eq(despesas.status, "pendente")),
          );
      }

      await db
        .delete(comissoesFechadasItens)
        .where(eq(comissoesFechadasItens.comissaoFechadaId, input.id));
      await db
        .delete(comissoesFechadas)
        .where(eq(comissoesFechadas.id, input.id));

      return { success: true };
    }),
});
