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
import { checkPermission } from "./check-permission";
import {
  atribuirCobrancasEmMassa,
  atualizarCategoriaCobranca,
  atualizarCategoriaDespesa,
  criarCategoriaCobranca,
  criarCategoriaDespesa,
  garantirCategoriasPadrao,
  listarCategoriasCobranca,
  listarCategoriasDespesa,
  listarFaixasComissao,
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

/**
 * Gate de leitura do módulo Financeiro. Respeita matriz `financeiro.ver`
 * incluindo cargos personalizados. Atendente/SDR/estagiário têm
 * `financeiro=(false, false, false, false, false)` na matriz padrão →
 * negados. Gestor/dono têm `verTodos=true` → liberados.
 *
 * Diferente de `requireGestao` que checa cargo legado hardcoded — esta
 * função respeita configuração customizada do admin no painel.
 */
async function requireFinanceiroVer(userId: number): Promise<void> {
  const perm = await checkPermission(userId, "financeiro", "ver");
  if (!perm.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Sem permissão para acessar Financeiro.",
    });
  }
}

const NOME_CAT = z.string().min(1).max(80);

export const financeiroRouter = router({
  // ─── Categorias de cobrança ────────────────────────────────────────────────

  listarCategoriasCobranca: protectedProcedure.query(async ({ ctx }) => {
    await requireFinanceiroVer(ctx.user.id);
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
    await requireFinanceiroVer(ctx.user.id);
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
    await requireFinanceiroVer(ctx.user.id);
    const esc = await requireEscritorio(ctx.user.id);
    const regra = await obterRegraComissao(esc.escritorio.id);
    const faixas = await listarFaixasComissao(esc.escritorio.id);
    if (!regra) {
      // Defaults sem persistir.
      return {
        aliquotaPercent: "0.00",
        modo: "flat" as const,
        baseFaixa: "comissionavel" as const,
        valorMinimoCobranca: "0.00",
        faixas: [] as Array<{ limiteAte: string | null; aliquotaPercent: string }>,
      };
    }
    return {
      aliquotaPercent: regra.aliquotaPercent,
      modo: regra.modo,
      baseFaixa: regra.baseFaixa,
      valorMinimoCobranca: regra.valorMinimoCobranca,
      faixas: faixas.map((f) => ({
        limiteAte: f.limiteAte,
        aliquotaPercent: f.aliquotaPercent,
      })),
    };
  }),

  salvarRegraComissao: protectedProcedure
    .input(
      z.object({
        modo: z.enum(["flat", "faixas"]).default("flat"),
        aliquotaPercent: z.number().min(0).max(100),
        valorMinimoCobranca: z.number().min(0),
        baseFaixa: z.enum(["bruto", "comissionavel"]).default("comissionavel"),
        /**
         * Tabela de faixas. Última faixa pode ter `limiteAte: null` para
         * representar "sem teto". Vazia quando modo='flat'.
         */
        faixas: z
          .array(
            z.object({
              limiteAte: z.number().min(0).nullable(),
              aliquotaPercent: z.number().min(0).max(100),
            }),
          )
          .max(20)
          .default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);

      // Validação extra de coerência das faixas:
      if (input.modo === "faixas") {
        if (input.faixas.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Modo 'faixas' exige pelo menos uma faixa configurada.",
          });
        }
        // Limites finitos devem ser estritamente crescentes; só a última pode ser null.
        let anterior = -1;
        for (let i = 0; i < input.faixas.length; i++) {
          const f = input.faixas[i];
          if (f.limiteAte === null && i !== input.faixas.length - 1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Apenas a última faixa pode ter limite 'sem teto'.",
            });
          }
          if (f.limiteAte !== null) {
            if (f.limiteAte <= anterior) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Os limites das faixas precisam ser crescentes.",
              });
            }
            anterior = f.limiteAte;
          }
        }
      }

      await salvarRegraComissao(esc.escritorio.id, {
        modo: input.modo,
        aliquotaPercent: input.aliquotaPercent,
        valorMinimoCobranca: input.valorMinimoCobranca,
        baseFaixa: input.baseFaixa,
        faixas: input.faixas,
      });
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
          /** Mostra apenas cobranças cujo estado de comissão está
           *  indefinido — sem categoria E sem `comissionavelOverride`.
           *  Cenário típico: PIX direto pro Asaas que cria cobrança
           *  via webhook sem categoria atribuída. */
          apenasSemDecisaoComissao: z.boolean().default(false),
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
      if (input?.apenasSemDecisaoComissao) {
        // "Sem decisão" = sem override AND sem categoria. Se tem
        // categoria (mesmo não-comissionável), foi uma decisão tomada.
        conds.push(isNull(asaasCobrancas.comissionavelOverride));
        conds.push(isNull(asaasCobrancas.categoriaId));
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
          // Flag herdada da categoria — usada pelo UI pra resolver o
          // estado "Sim/Não/Indefinido" da coluna Comissão na tabela
          // Atribuir. Quando comissionavelOverride é null, usamos esta;
          // se ambas null → "Indefinido" (precisa decisão).
          categoriaComissionavel: categoriasCobranca.comissionavel,
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
