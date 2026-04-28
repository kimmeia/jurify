import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  asaasCobrancas,
  categoriasCobranca,
  contatos,
} from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "./db-escritorio";
import {
  atribuirCobrancasEmMassa,
  atualizarCategoriaCobranca,
  atualizarCategoriaDespesa,
  criarCategoriaCobranca,
  criarCategoriaDespesa,
  garantirCategoriasPadrao,
  listarCategoriasCobranca,
  listarCategoriasDespesa,
  obterRegraComissao,
  reconciliarCobrancasOrfas,
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

  // ─── Cobranças sincronizadas: atribuição em massa + reconciliação ──────────

  /**
   * Lista cobranças do escritório para a tela de atribuição. Suporta filtro
   * `apenasSemAtribuicao` que limita o resultado às cobranças sem atendente
   * OU sem categoria — o caso típico após sync do Asaas.
   */
  listarCobrancasParaAtribuicao: protectedProcedure
    .input(
      z
        .object({
          apenasSemAtribuicao: z.boolean().default(false),
          limit: z.number().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) return [];

      const conds = [eq(asaasCobrancas.escritorioId, esc.escritorio.id)];
      if (input?.apenasSemAtribuicao) {
        conds.push(
          or(
            isNull(asaasCobrancas.atendenteId),
            isNull(asaasCobrancas.categoriaId),
          )!,
        );
      }

      return db
        .select({
          id: asaasCobrancas.id,
          asaasPaymentId: asaasCobrancas.asaasPaymentId,
          contatoId: asaasCobrancas.contatoId,
          contatoNome: contatos.nome,
          valor: asaasCobrancas.valor,
          status: asaasCobrancas.status,
          dataPagamento: asaasCobrancas.dataPagamento,
          vencimento: asaasCobrancas.vencimento,
          descricao: asaasCobrancas.descricao,
          atendenteId: asaasCobrancas.atendenteId,
          categoriaId: asaasCobrancas.categoriaId,
          categoriaNome: categoriasCobranca.nome,
          comissionavelOverride: asaasCobrancas.comissionavelOverride,
        })
        .from(asaasCobrancas)
        .leftJoin(contatos, eq(contatos.id, asaasCobrancas.contatoId))
        .leftJoin(
          categoriasCobranca,
          eq(categoriasCobranca.id, asaasCobrancas.categoriaId),
        )
        .where(and(...conds))
        .orderBy(desc(asaasCobrancas.createdAt))
        .limit(input?.limit ?? 200);
    }),

  atribuirCobrancasEmMassa: protectedProcedure
    .input(
      z.object({
        cobrancaIds: z.array(z.number()).min(1).max(500),
        atendenteId: z.number().nullable().optional(),
        categoriaId: z.number().nullable().optional(),
        comissionavelOverride: z.boolean().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const r = await atribuirCobrancasEmMassa(
        esc.escritorio.id,
        input.cobrancaIds,
        {
          atendenteId: input.atendenteId,
          categoriaId: input.categoriaId,
          comissionavelOverride: input.comissionavelOverride,
        },
      );
      return r;
    }),

  /**
   * Re-roda a cascata de inferência sobre cobranças órfãs (sem atendente).
   * Atribuições manuais nunca são sobrescritas. Útil após preencher o
   * `atendenteResponsavelId` de um cliente que tinha cobranças passadas.
   */
  reconciliarCobrancasOrfas: protectedProcedure
    .input(z.object({ contatoId: z.number().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      return reconciliarCobrancasOrfas(esc.escritorio.id, input?.contatoId);
    }),
});
