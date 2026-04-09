/**
 * Router — Judit Processos (Créditos por escritório)
 *
 * Sistema de créditos pré-pagos para consultas processuais via Judit.IO.
 * Cada operação consome créditos: consulta CNJ, monitoramento, etc.
 */

import { z } from "zod";
import { eq, desc, and, like } from "drizzle-orm";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { juditCreditos, juditTransacoes } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { createLogger } from "../_core/logger";
import {
  CUSTOS_JUDIT,
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

// Reexportar pra compatibilidade com código antigo que importava CUSTOS_OPERACOES
// ATENÇÃO: fonte de verdade é `CUSTOS_JUDIT` em ./judit-credit-calc.ts
const CUSTOS_OPERACOES = {
  consulta_cnj: CUSTOS_JUDIT.consulta_cnj,
  consulta_historica_base: CUSTOS_JUDIT.consulta_historica_base,
  consulta_historica_por_lote_10: CUSTOS_JUDIT.consulta_historica_por_lote_10,
  consulta_sintetica: CUSTOS_JUDIT.consulta_sintetica,
  monitorar_processo: CUSTOS_JUDIT.monitorar_processo_mes,
  monitorar_pessoa: CUSTOS_JUDIT.monitorar_pessoa_mes,
  resumo_ia: CUSTOS_JUDIT.resumo_ia,
  anexos: CUSTOS_JUDIT.anexos_mes,
  // Label legacy pra UI antiga
  consulta_historica: CUSTOS_JUDIT.consulta_historica_base,
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
    .input(z.object({
      cnj: z.string().min(15).max(30),
      credencialId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();
      await consumirCreditos(esc.escritorio.id, ctx.user.id, CUSTOS_OPERACOES.consulta_cnj, "consulta_cnj", `CNJ: ${input.cnj}`);

      // Resolver credencial do cofre pra segredo de justiça
      let credential_id: string | undefined;
      if (input.credencialId) {
        const db = await getDb();
        if (db) {
          const { juditCredenciais } = await import("../../drizzle/schema");
          const [cred] = await db.select().from(juditCredenciais)
            .where(and(eq(juditCredenciais.id, input.credencialId), eq(juditCredenciais.escritorioId, esc.escritorio.id)))
            .limit(1);
          if (cred?.juditCredentialId) credential_id = cred.juditCredentialId;
        }
      }

      const request = await client.criarRequest({
        search: { search_type: "lawsuit_cnj", search_key: input.cnj.replace(/[^\d.-]/g, "") },
        ...(credential_id ? { credential_id } : {}),
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
    .input(z.object({
      tipo: z.enum(["cpf", "cnpj", "name"]),
      valor: z.string().min(3).max(100),
      credencialId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS_OPERACOES.consulta_historica_base,
        "consulta_historica_base",
        `${input.tipo.toUpperCase()}: ${input.valor}`,
      );

      // Resolver credencial do cofre pra segredo de justiça
      let credential_id: string | undefined;
      if (input.credencialId) {
        const db = await getDb();
        if (db) {
          const { juditCredenciais } = await import("../../drizzle/schema");
          const [cred] = await db.select().from(juditCredenciais)
            .where(and(eq(juditCredenciais.id, input.credencialId), eq(juditCredenciais.escritorioId, esc.escritorio.id)))
            .limit(1);
          if (cred?.juditCredentialId) credential_id = cred.juditCredentialId;
        }
      }

      const searchKey = input.tipo === "cpf" || input.tipo === "cnpj" ? input.valor.replace(/\D/g, "") : input.valor;
      const request = await client.criarRequest({
        search: { search_type: input.tipo, search_key: searchKey },
        ...(credential_id ? { credential_id } : {}),
      });
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

  /**
   * Gera um resumo IA de um processo judicial.
   * Usa a API Key OpenAI do escritório (configurada nos Agentes IA).
   * Cobra 1 crédito por resumo.
   */
  resumoIA: protectedProcedure
    .input(z.object({
      processo: z.object({
        cnj: z.string().optional(),
        tribunal: z.string().optional(),
        classe: z.string().optional(),
        assunto: z.string().optional(),
        partes: z.array(z.object({ nome: z.string(), lado: z.string() })).optional(),
        movimentacoes: z.array(z.object({ data: z.string().optional(), conteudo: z.string() })).optional(),
        valor: z.number().optional(),
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      // Cobra 1 crédito
      await consumirCreditos(esc.escritorio.id, ctx.user.id, CUSTOS_OPERACOES.resumo_ia, "resumo_ia", `Resumo IA: ${input.processo.cnj || "processo"}`);

      // Buscar config do agente IA do escritório
      const { obterConfigChatBot } = await import("../integracoes/chatbot-openai");
      const config = await obterConfigChatBot(esc.escritorio.id);
      if (!config?.openaiApiKey) {
        throw new Error("Configure um Agente de IA com API Key OpenAI para usar o resumo. Vá em Agentes IA.");
      }

      // Montar contexto do processo
      const p = input.processo;
      const partesTexto = (p.partes || []).map((pt) => `${pt.lado}: ${pt.nome}`).join("\n");
      const movsTexto = (p.movimentacoes || []).slice(0, 20).map((m) => `${m.data || ""} - ${m.conteudo}`).join("\n");

      const prompt = `Você é um assistente jurídico especialista. Analise o processo abaixo e gere um RESUMO EXECUTIVO claro e objetivo em português para um advogado. Inclua: situação atual, pontos críticos, próximos passos recomendados, e risco estimado.

PROCESSO: ${p.cnj || "N/A"}
TRIBUNAL: ${p.tribunal || "N/A"}
CLASSE: ${p.classe || "N/A"}
ASSUNTO: ${p.assunto || "N/A"}
VALOR DA CAUSA: ${p.valor ? `R$ ${p.valor.toLocaleString("pt-BR")}` : "N/A"}

PARTES:
${partesTexto || "N/A"}

ÚLTIMAS MOVIMENTAÇÕES:
${movsTexto || "Nenhuma disponível"}

Gere o resumo de forma estruturada e concisa (máximo 500 palavras).`;

      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.openaiApiKey}` },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 800,
            temperature: 0.3,
          }),
        });
        if (!res.ok) throw new Error(`OpenAI retornou ${res.status}`);
        const data = await res.json();
        const resumo = data.choices?.[0]?.message?.content?.trim() || "Não foi possível gerar o resumo.";
        return { resumo, tokensUsados: data.usage?.total_tokens || 0 };
      } catch (err: any) {
        throw new Error(`Erro ao gerar resumo IA: ${err.message}`);
      }
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

  /**
   * ADMIN ONLY — lista TODOS os monitoramentos na Judit (sem filtro de usuário).
   * O frontend de usuários usa juditUsuario.meusMonitoramentos (user-scoped).
   * Mantido apenas para painel administrativo.
   */
  listarMonitoramentos: adminProcedure
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

  /** ADMIN ONLY — pausa qualquer monitoramento na Judit (sem filtro de owner). */
  pausarMonitoramento: adminProcedure
    .input(z.object({ trackingId: z.string() }))
    .mutation(async ({ input }) => {
      const client = await getJuditClientOrThrow();
      await client.pausarMonitoramento(input.trackingId);
      return { success: true };
    }),

  /** ADMIN ONLY — reativa qualquer monitoramento na Judit (sem filtro de owner). */
  reativarMonitoramento: adminProcedure
    .input(z.object({ trackingId: z.string() }))
    .mutation(async ({ input }) => {
      const client = await getJuditClientOrThrow();
      await client.reativarMonitoramento(input.trackingId);
      return { success: true };
    }),

  /** ADMIN ONLY — deleta qualquer monitoramento na Judit (sem filtro de owner). */
  deletarMonitoramento: adminProcedure
    .input(z.object({ trackingId: z.string() }))
    .mutation(async ({ input }) => {
      const client = await getJuditClientOrThrow();
      await client.deletarMonitoramento(input.trackingId);
      return { success: true };
    }),

  /** ADMIN ONLY — busca histórico de qualquer monitoramento (sem filtro de owner). */
  historicoMonitoramento: adminProcedure
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
