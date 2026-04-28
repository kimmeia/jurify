import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import {
  atualizarCategoriaCobranca,
  atualizarCategoriaDespesa,
  criarCategoriaCobranca,
  criarCategoriaDespesa,
  garantirCategoriasPadrao,
  listarCategoriasCobranca,
  listarCategoriasDespesa,
  obterRegraComissao,
  salvarRegraComissao,
} from "./db-financeiro";

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
      message: "Apenas dono ou gestor pode gerenciar configurações financeiras.",
    });
  }
}

const NOME_CAT = z.string().min(1).max(80);

export const financeiroRouter = router({
  // ─── Categorias de cobrança ────────────────────────────────────────────────

  listarCategoriasCobranca: protectedProcedure.query(async ({ ctx }) => {
    const esc = await requireEscritorio(ctx.user.id);
    await garantirCategoriasPadrao(esc.escritorio.id);
    return listarCategoriasCobranca(esc.escritorio.id);
  }),

  criarCategoriaCobranca: protectedProcedure
    .input(z.object({ nome: NOME_CAT, comissionavel: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const id = await criarCategoriaCobranca(
        esc.escritorio.id,
        input.nome.trim(),
        input.comissionavel,
      );
      return { id };
    }),

  atualizarCategoriaCobranca: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        nome: NOME_CAT.optional(),
        comissionavel: z.boolean().optional(),
        ativo: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const { id, ...dados } = input;
      await atualizarCategoriaCobranca(id, esc.escritorio.id, dados);
      return { success: true };
    }),

  // ─── Categorias de despesa ─────────────────────────────────────────────────

  listarCategoriasDespesa: protectedProcedure.query(async ({ ctx }) => {
    const esc = await requireEscritorio(ctx.user.id);
    await garantirCategoriasPadrao(esc.escritorio.id);
    return listarCategoriasDespesa(esc.escritorio.id);
  }),

  criarCategoriaDespesa: protectedProcedure
    .input(z.object({ nome: NOME_CAT }))
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const id = await criarCategoriaDespesa(esc.escritorio.id, input.nome.trim());
      return { id };
    }),

  atualizarCategoriaDespesa: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        nome: NOME_CAT.optional(),
        ativo: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const { id, ...dados } = input;
      await atualizarCategoriaDespesa(id, esc.escritorio.id, dados);
      return { success: true };
    }),

  // ─── Regra de comissão (singleton por escritório) ──────────────────────────

  obterRegraComissao: protectedProcedure.query(async ({ ctx }) => {
    const esc = await requireEscritorio(ctx.user.id);
    const regra = await obterRegraComissao(esc.escritorio.id);
    // Quando o escritório nunca configurou, retorna defaults sem persistir nada.
    return regra ?? {
      aliquotaPercent: "0.00",
      valorMinimoCobranca: "0.00",
    };
  }),

  salvarRegraComissao: protectedProcedure
    .input(
      z.object({
        aliquotaPercent: z.number().min(0).max(100),
        valorMinimoCobranca: z.number().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      await salvarRegraComissao(
        esc.escritorio.id,
        input.aliquotaPercent,
        input.valorMinimoCobranca,
      );
      return { success: true };
    }),
});
