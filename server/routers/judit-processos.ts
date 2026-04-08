/**
 * Router — Judit Processos (Créditos por escritório)
 *
 * Sistema de créditos pré-pagos para consultas processuais via Judit.IO.
 * Cada operação consome créditos: consulta CNJ, monitoramento, etc.
 */

import { z } from "zod";
import { eq, desc, and, like } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { juditCreditos, juditTransacoes } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { createLogger } from "../_core/logger";
import {
  calcularCustoExtraConsultaHistorica,
  estimarCustoConsulta,
} from "./judit-credit-calc";

const log = createLogger("judit-processos");

// ─── Constantes ──────────────────────────────────────────────────────────────

const PACOTES_CREDITOS = [
  { id: "pack_50", nome: "50 creditos", creditos: 50, preco: 49.9, popular: false },
  { id: "pack_200", nome: "200 creditos", creditos: 200, preco: 149.9, popular: true },
  { id: "pack_500", nome: "500 creditos", creditos: 500, preco: 299.9, popular: false },
  { id: "pack_1000", nome: "1000 creditos", creditos: 1000, preco: 499.9, popular: false },
] as const;

const CUSTOS_OPERACOES = {
  /** Consulta direta por CNJ — resultado único garantido */
  consulta_cnj: 1,
  /**
   * Consulta histórica por CPF/CNPJ/OAB/Nome — custo BASE da requisição
   * (taxa fixa da Judit). O custo TOTAL é calculado dinamicamente:
   *   custo_total = consulta_historica_base + (processos_encontrados × consulta_historica_por_processo)
   * Capped em CONSULTA_HISTORICA_MAX.
   */
  consulta_historica_base: 3,
  /** Custo adicional por processo retornado na busca histórica */
  consulta_historica_por_processo: 1,
  /** Teto máximo de créditos por busca histórica (evita sticker shock) */
  consulta_historica_max: 100,
  consulta_sintetica: 2,
  monitorar_processo: 5,
  monitorar_pessoa: 50,
  resumo_ia: 1,
  anexos: 10,
  // Compatibilidade com UI antiga — label exibido
  consulta_historica: 3, // legacy, usado só pra exibição; real é calculado
} as const;

const PACOTE_QUANTIDADES: Record<string, number> = {
  pack_50: 50,
  pack_200: 200,
  pack_500: 500,
  pack_1000: 1000,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getJuditClientOrThrow() {
  const { getJuditClient } = await import("../integracoes/judit-webhook");
  const client = await getJuditClient();
  if (!client) throw new Error("Judit não configurada. Peça ao administrador.");
  return client;
}

async function consumirCreditos(
  escritorioId: number,
  userId: number,
  custo: number,
  operacao: string,
  detalhes: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");
  const [cr] = await db
    .select()
    .from(juditCreditos)
    .where(eq(juditCreditos.escritorioId, escritorioId))
    .limit(1);
  const saldo = cr?.saldo ?? 0;
  if (saldo < custo) {
    throw new Error(`Créditos insuficientes. Necessário: ${custo}, disponível: ${saldo}.`);
  }
  await db
    .update(juditCreditos)
    .set({ saldo: saldo - custo, totalConsumido: (cr?.totalConsumido || 0) + custo })
    .where(eq(juditCreditos.escritorioId, escritorioId));
  await db.insert(juditTransacoes).values({
    escritorioId,
    tipo: "consumo",
    quantidade: custo,
    saldoAnterior: saldo,
    saldoDepois: saldo - custo,
    operacao,
    detalhes,
    userId,
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const juditProcessosRouter = router({
  saldo: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    const baseResponse = {
      saldo: 0,
      totalComprado: 0,
      totalConsumido: 0,
      pacotes: PACOTES_CREDITOS,
      custos: CUSTOS_OPERACOES,
    };
    if (!esc) return baseResponse;
    const db = await getDb();
    if (!db) return baseResponse;
    try {
      const [row] = await db
        .select()
        .from(juditCreditos)
        .where(eq(juditCreditos.escritorioId, esc.escritorio.id))
        .limit(1);
      return {
        saldo: row?.saldo ?? 0,
        totalComprado: row?.totalComprado ?? 0,
        totalConsumido: row?.totalConsumido ?? 0,
        pacotes: PACOTES_CREDITOS,
        custos: CUSTOS_OPERACOES,
      };
    } catch {
      return baseResponse;
    }
  }),

  transacoes: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];
      try {
        return await db
          .select()
          .from(juditTransacoes)
          .where(eq(juditTransacoes.escritorioId, esc.escritorio.id))
          .orderBy(desc(juditTransacoes.createdAt))
          .limit(input?.limit ?? 50);
      } catch {
        return [];
      }
    }),

  adicionarCreditos: protectedProcedure
    .input(z.object({ pacoteId: z.string().optional(), quantidade: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");
      const qty = input.pacoteId ? PACOTE_QUANTIDADES[input.pacoteId] || 0 : input.quantidade || 0;
      if (qty <= 0) throw new Error("Quantidade inválida");

      const [row] = await db
        .select()
        .from(juditCreditos)
        .where(eq(juditCreditos.escritorioId, esc.escritorio.id))
        .limit(1);
      const saldoAtual = row?.saldo ?? 0;
      const novoSaldo = saldoAtual + qty;

      if (row) {
        await db
          .update(juditCreditos)
          .set({ saldo: novoSaldo, totalComprado: (row.totalComprado || 0) + qty })
          .where(eq(juditCreditos.escritorioId, esc.escritorio.id));
      } else {
        await db
          .insert(juditCreditos)
          .values({ escritorioId: esc.escritorio.id, saldo: qty, totalComprado: qty, totalConsumido: 0 });
      }

      await db.insert(juditTransacoes).values({
        escritorioId: esc.escritorio.id,
        tipo: "compra",
        quantidade: qty,
        saldoAnterior: saldoAtual,
        saldoDepois: novoSaldo,
        operacao: input.pacoteId || "manual",
        detalhes: `+${qty} créditos`,
        userId: ctx.user.id,
      });
      return { novoSaldo, adicionados: qty };
    }),

  consultarCNJ: protectedProcedure
    .input(z.object({ cnj: z.string().min(15).max(30) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();
      await consumirCreditos(esc.escritorio.id, ctx.user.id, CUSTOS_OPERACOES.consulta_cnj, "consulta_cnj", `CNJ: ${input.cnj}`);
      const request = await client.criarRequest({
        search: { search_type: "lawsuit_cnj", search_key: input.cnj.replace(/[^\d.-]/g, "") },
      });
      return { requestId: request.request_id, status: request.status };
    }),

  /**
   * Retorna a estimativa de custo de uma consulta antes de executar.
   * Usado pelo frontend pra mostrar aviso ao usuário.
   */
  estimarCusto: protectedProcedure
    .input(z.object({ tipo: z.enum(["cpf", "cnpj", "oab", "name", "lawsuit_cnj"]) }))
    .query(({ input }) => estimarCustoConsulta(input.tipo)),

  consultarDocumento: protectedProcedure
    .input(z.object({ tipo: z.enum(["cpf", "cnpj", "oab", "name"]), valor: z.string().min(3).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();
      // Cobra APENAS o custo base aqui (request na Judit). O custo
      // variável (por processo encontrado) é cobrado em `resultados`
      // quando a gente sabe quantos resultados vieram.
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS_OPERACOES.consulta_historica_base,
        "consulta_historica_base",
        `${input.tipo.toUpperCase()}: ${input.valor}`,
      );
      const searchKey = input.tipo === "cpf" || input.tipo === "cnpj" ? input.valor.replace(/\D/g, "") : input.valor;
      const request = await client.criarRequest({ search: { search_type: input.tipo, search_key: searchKey } });
      return { requestId: request.request_id, status: request.status };
    }),

  statusConsulta: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .query(async ({ input }) => {
      const client = await getJuditClientOrThrow();
      const status = await client.consultarRequest(input.requestId);
      return { status: status.status, requestId: status.request_id, updatedAt: status.updated_at };
    }),

  /**
   * Retorna os resultados da consulta E cobra crédito adicional por
   * processo encontrado (uma vez só, idempotente via transaction log).
   *
   * Mudança de query → mutation porque tem efeito colateral (cobrança).
   * Na primeira chamada com este requestId:
   *   1. Busca resultados na Judit
   *   2. Verifica se já cobrou extra pra este requestId
   *   3. Se não cobrou: calcula (qtd × por_processo) capped no máximo
   *      e consome créditos
   *   4. Retorna os dados
   *
   * Chamadas subsequentes (paginação) só retornam, sem cobrar de novo.
   */
  resultados: protectedProcedure
    .input(z.object({ requestId: z.string(), page: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();
      const resultado = await client.buscarRespostas(input.requestId, input.page ?? 1, 20);

      // Cobrança de crédito variável por processo — só na primeira
      // chamada (page=1 ou undefined)
      const isPrimeiraPage = !input.page || input.page === 1;
      if (isPrimeiraPage) {
        const db = await getDb();
        if (db) {
          // Verifica se já foi cobrado extra pra este requestId
          const jaCobrado = await db
            .select()
            .from(juditTransacoes)
            .where(
              and(
                eq(juditTransacoes.escritorioId, esc.escritorio.id),
                eq(juditTransacoes.operacao, "consulta_historica_extra"),
                like(juditTransacoes.detalhes, `%${input.requestId}%`),
              ),
            )
            .limit(1);

          if (jaCobrado.length === 0) {
            const totalProcessos = resultado?.all_count ?? resultado?.page_data?.length ?? 0;
            // Usa helper puro pra calcular o custo extra (testável)
            const custoExtra = calcularCustoExtraConsultaHistorica(totalProcessos);

            if (custoExtra > 0) {
              try {
                await consumirCreditos(
                  esc.escritorio.id,
                  ctx.user.id,
                  custoExtra,
                  "consulta_historica_extra",
                  `req:${input.requestId} (${totalProcessos} processos)`,
                );
              } catch (err: any) {
                // Se falhar por saldo insuficiente, devolve os dados mas
                // marca o resultado pra UI avisar o usuário
                log.warn(
                  { err: err.message, requestId: input.requestId, totalProcessos },
                  "Créditos insuficientes pro custo variável — retornando resultados mesmo assim",
                );
                return {
                  ...resultado,
                  custoExtraErro: err.message,
                  custoExtraNecessario: custoExtra,
                };
              }
            }

            return {
              ...resultado,
              custoExtraCobrado: custoExtra,
              totalProcessosEncontrados: totalProcessos,
            };
          }
        }
      }

      return resultado;
    }),

  monitorarProcesso: protectedProcedure
    .input(z.object({ cnj: z.string().min(15).max(30) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS_OPERACOES.monitorar_processo,
        "monitorar_processo",
        `Monitorar CNJ: ${input.cnj}`,
      );
      const tracking = await client.criarMonitoramento({
        recurrence: 1,
        search: { search_type: "lawsuit_cnj", search_key: input.cnj.replace(/[^\d.-]/g, "") },
      });
      return { trackingId: tracking.tracking_id, status: tracking.status };
    }),

  monitorarPessoa: protectedProcedure
    .input(z.object({ tipo: z.enum(["cpf", "cnpj", "oab", "name"]), valor: z.string().min(3).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS_OPERACOES.monitorar_pessoa,
        "monitorar_pessoa",
        `Monitorar ${input.tipo.toUpperCase()}: ${input.valor}`,
      );
      const searchKey = input.tipo === "cpf" || input.tipo === "cnpj" ? input.valor.replace(/\D/g, "") : input.valor;
      const tracking = await client.criarMonitoramento({
        recurrence: 1,
        search: { search_type: input.tipo, search_key: searchKey },
      });
      return { trackingId: tracking.tracking_id, status: tracking.status };
    }),

  listarMonitoramentos: protectedProcedure
    .input(z.object({ page: z.number().optional(), tipo: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const { getJuditClient } = await import("../integracoes/judit-webhook");
        const client = await getJuditClient();
        if (!client) return { monitoramentos: [], total: 0 };
        const res = await client.listarMonitoramentos(input?.page ?? 1, 20, undefined, input?.tipo);
        return { monitoramentos: res.page_data, total: res.all_count, pages: res.all_pages_count };
      } catch {
        return { monitoramentos: [], total: 0 };
      }
    }),

  pausarMonitoramento: protectedProcedure
    .input(z.object({ trackingId: z.string() }))
    .mutation(async ({ input }) => {
      const client = await getJuditClientOrThrow();
      await client.pausarMonitoramento(input.trackingId);
      return { success: true };
    }),

  reativarMonitoramento: protectedProcedure
    .input(z.object({ trackingId: z.string() }))
    .mutation(async ({ input }) => {
      const client = await getJuditClientOrThrow();
      await client.reativarMonitoramento(input.trackingId);
      return { success: true };
    }),

  deletarMonitoramento: protectedProcedure
    .input(z.object({ trackingId: z.string() }))
    .mutation(async ({ input }) => {
      const client = await getJuditClientOrThrow();
      await client.deletarMonitoramento(input.trackingId);
      return { success: true };
    }),

  historicoMonitoramento: protectedProcedure
    .input(z.object({ trackingId: z.string(), page: z.number().optional() }))
    .query(async ({ input }) => {
      try {
        const { getJuditClient } = await import("../integracoes/judit-webhook");
        const client = await getJuditClient();
        if (!client) return null;
        return await client.buscarRespostasTracking(input.trackingId, input.page ?? 1, 20);
      } catch {
        return null;
      }
    }),
});
