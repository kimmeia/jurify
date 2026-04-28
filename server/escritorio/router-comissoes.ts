import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, between, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  asaasCobrancas,
  categoriasCobranca,
  colaboradores,
  comissoesFechadas,
  comissoesFechadasItens,
  users,
} from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { listarFaixasComissao, obterRegraComissao } from "./db-financeiro";
import {
  calcularComissao,
  type CobrancaParaComissao,
  type FaixaComissao,
  type MotivoExclusao,
} from "../../shared/calculo-comissao";

/** Status Asaas que contam como pagamento confirmado pra fins de comissão. */
const STATUS_PAGOS = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];

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
      message: "Apenas dono ou gestor pode operar comissões.",
    });
  }
}

/** Simulação detalhada: cobranças de um atendente no período + cálculo. */
async function simularComissao(
  escritorioId: number,
  atendenteId: number,
  periodoInicio: string,
  periodoFim: string,
) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

  const regraRow = await obterRegraComissao(escritorioId);
  const aliquotaPercent = regraRow ? Number(regraRow.aliquotaPercent) : 0;
  const valorMinimo = regraRow ? Number(regraRow.valorMinimoCobranca) : 0;
  const modo = regraRow?.modo ?? "flat";
  const baseFaixa = regraRow?.baseFaixa ?? "comissionavel";

  // Carrega faixas só quando relevantes — quando modo='flat', evita um SELECT.
  const faixasRows = modo === "faixas" ? await listarFaixasComissao(escritorioId) : [];
  const faixas: FaixaComissao[] = faixasRows.map((f) => ({
    limiteAte: f.limiteAte === null ? null : Number(f.limiteAte),
    aliquotaPercent: Number(f.aliquotaPercent),
  }));

  // LEFT JOIN com categorias para hidratar `comissionavel` (null quando sem categoria).
  const linhas = await db
    .select({
      id: asaasCobrancas.id,
      valor: asaasCobrancas.valor,
      dataPagamento: asaasCobrancas.dataPagamento,
      status: asaasCobrancas.status,
      atendenteId: asaasCobrancas.atendenteId,
      categoriaId: asaasCobrancas.categoriaId,
      comissionavelOverride: asaasCobrancas.comissionavelOverride,
      categoriaNome: categoriasCobranca.nome,
      categoriaComissionavel: categoriasCobranca.comissionavel,
      descricao: asaasCobrancas.descricao,
      asaasPaymentId: asaasCobrancas.asaasPaymentId,
    })
    .from(asaasCobrancas)
    .leftJoin(
      categoriasCobranca,
      eq(categoriasCobranca.id, asaasCobrancas.categoriaId),
    )
    .where(
      and(
        eq(asaasCobrancas.escritorioId, escritorioId),
        eq(asaasCobrancas.atendenteId, atendenteId),
        isNotNull(asaasCobrancas.dataPagamento),
        between(asaasCobrancas.dataPagamento, periodoInicio, periodoFim),
        inArray(asaasCobrancas.status, STATUS_PAGOS),
      ),
    )
    .orderBy(asc(asaasCobrancas.dataPagamento));

  const cobrancasParaCalculo: CobrancaParaComissao[] = linhas.map((l) => ({
    id: l.id,
    valor: Number(l.valor),
    dataPagamento: new Date(l.dataPagamento + "T00:00:00"),
    atendenteId: l.atendenteId,
    categoriaComissionavel: l.categoriaComissionavel ?? null,
    comissionavelOverride: l.comissionavelOverride ?? null,
  }));

  const resultado = calcularComissao(cobrancasParaCalculo, {
    modo,
    aliquotaPercent,
    valorMinimo,
    faixas,
    baseFaixa,
  });

  // Para o UI, devolvemos os mesmos itens enriquecidos (descrição, categoria, etc.).
  const linhasMap = new Map(linhas.map((l) => [l.id, l]));
  const enriquecer = (id: number, motivo?: MotivoExclusao) => {
    const l = linhasMap.get(id)!;
    return {
      id: l.id,
      asaasPaymentId: l.asaasPaymentId,
      valor: Number(l.valor),
      dataPagamento: l.dataPagamento,
      descricao: l.descricao,
      categoriaNome: l.categoriaNome,
      categoriaComissionavel: l.categoriaComissionavel,
      comissionavelOverride: l.comissionavelOverride,
      motivoExclusao: motivo ?? null,
    };
  };

  return {
    regra: {
      aliquotaPercent,
      valorMinimo,
      modo,
      baseFaixa,
      faixas,
    },
    aliquotaAplicada: resultado.aliquotaAplicada,
    faixaAplicada: resultado.faixaAplicada ?? null,
    comissionaveis: resultado.comissionaveis.map((c) => enriquecer(c.id)),
    naoComissionaveis: resultado.naoComissionaveis.map((n) =>
      enriquecer(n.cobranca.id, n.motivo),
    ),
    totais: resultado.totais,
  };
}

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
      requireGestao(esc.colaborador.cargo);
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

  fechar: protectedProcedure
    .input(
      z.object({
        atendenteId: z.number(),
        periodoInicio: dataInput,
        periodoFim: dataInput,
        observacoes: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const sim = await simularComissao(
        esc.escritorio.id,
        input.atendenteId,
        input.periodoInicio,
        input.periodoFim,
      );

      // Persiste cabeçalho + itens. Ambos são INSERTs novos: um fechamento
      // pode coexistir com outros do mesmo atendente, mesmo período (re-fechamento
      // após correção). Histórico é cumulativo, não sobrescrito.
      const [novo] = await db
        .insert(comissoesFechadas)
        .values({
          escritorioId: esc.escritorio.id,
          atendenteId: input.atendenteId,
          periodoInicio: input.periodoInicio,
          periodoFim: input.periodoFim,
          totalBrutoRecebido: sim.totais.bruto.toFixed(2),
          totalComissionavel: sim.totais.comissionavel.toFixed(2),
          totalNaoComissionavel: sim.totais.naoComissionavel.toFixed(2),
          totalComissao: sim.totais.valorComissao.toFixed(2),
          // No modo flat, a alíquota usada = regra.aliquotaPercent. No modo faixas,
          // = a alíquota da faixa atingida (já calculada por `aliquotaAplicada`).
          aliquotaUsada: sim.aliquotaAplicada.toFixed(2),
          modoUsado: sim.regra.modo,
          baseFaixaUsada: sim.regra.modo === "faixas" ? sim.regra.baseFaixa : null,
          faixasUsadas:
            sim.regra.modo === "faixas"
              ? JSON.stringify(sim.regra.faixas)
              : null,
          valorMinimoUsado: sim.regra.valorMinimo.toFixed(2),
          fechadoPorUserId: ctx.user.id,
          observacoes: input.observacoes ?? null,
        })
        .$returningId();

      const itens = [
        ...sim.comissionaveis.map((c) => ({
          comissaoFechadaId: novo.id,
          asaasCobrancaId: c.id,
          valor: c.valor.toFixed(2),
          foiComissionavel: true,
          motivoExclusao: null,
        })),
        ...sim.naoComissionaveis.map((c) => ({
          comissaoFechadaId: novo.id,
          asaasCobrancaId: c.id,
          valor: c.valor.toFixed(2),
          foiComissionavel: false,
          motivoExclusao: c.motivoExclusao,
        })),
      ];

      if (itens.length > 0) {
        await db.insert(comissoesFechadasItens).values(itens);
      }

      return { id: novo.id };
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
      requireGestao(esc.colaborador.cargo);
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
      requireGestao(esc.colaborador.cargo);
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
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [existente] = await db
        .select({ escritorioId: comissoesFechadas.escritorioId })
        .from(comissoesFechadas)
        .where(eq(comissoesFechadas.id, input.id))
        .limit(1);
      if (!existente || existente.escritorioId !== esc.escritorio.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
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
