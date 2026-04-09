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
      let customerKey: string | undefined;
      if (input.credencialId) {
        const db = await getDb();
        if (db) {
          const { juditCredenciais } = await import("../../drizzle/schema");
          const [cred] = await db.select().from(juditCredenciais)
            .where(and(eq(juditCredenciais.id, input.credencialId), eq(juditCredenciais.escritorioId, esc.escritorio.id)))
            .limit(1);
          if (cred?.customerKey) customerKey = cred.customerKey;
        }
      }

      const request = await client.criarRequest({
        search: { search_type: "lawsuit_cnj", search_key: input.cnj.replace(/[^\d.-]/g, "") },
        ...(customerKey ? { customer_key: customerKey } : {}),
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
      let customerKey: string | undefined;
      if (input.credencialId) {
        const db = await getDb();
        if (db) {
          const { juditCredenciais } = await import("../../drizzle/schema");
          const [cred] = await db.select().from(juditCredenciais)
            .where(and(eq(juditCredenciais.id, input.credencialId), eq(juditCredenciais.escritorioId, esc.escritorio.id)))
            .limit(1);
          if (cred?.customerKey) customerKey = cred.customerKey;
        }
      }

      const searchKey = input.tipo === "cpf" || input.tipo === "cnpj" ? input.valor.replace(/\D/g, "") : input.valor;
      const request = await client.criarRequest({
        search: { search_type: input.tipo, search_key: searchKey },
        ...(customerKey ? { customer_key: customerKey } : {}),
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
            // Contar apenas respostas tipo lawsuit (não application_info/application_error)
            const lawsuits = (resultado?.page_data || []).filter(
              (r: any) => r.response_type === "lawsuit" || r.response_type === "lawsuits",
            );
            const totalProcessos = lawsuits.length;
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
   * Busca o processo completo na Judit (todas as movimentações, partes, autos).
   * Diferente do monitoramento que só traz atualizações, isso faz um request
   * fresh e retorna o histórico inteiro. Cobra 1 crédito (consulta CNJ).
   */
  buscarProcessoCompleto: protectedProcedure
    .input(z.object({
      cnj: z.string().min(15).max(30),
      credencialId: z.number().optional(),
      /** Se informado, salva o resultado em juditRespostas vinculado ao monitoramento */
      monitoramentoId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();
      await consumirCreditos(esc.escritorio.id, ctx.user.id, CUSTOS_OPERACOES.consulta_cnj, "consulta_cnj_completa", `Histórico completo: ${input.cnj}`);

      let customerKey: string | undefined;
      if (input.credencialId) {
        const db = await getDb();
        if (db) {
          const { juditCredenciais } = await import("../../drizzle/schema");
          const [cred] = await db.select().from(juditCredenciais)
            .where(and(eq(juditCredenciais.id, input.credencialId), eq(juditCredenciais.escritorioId, esc.escritorio.id)))
            .limit(1);
          if (cred?.customerKey) customerKey = cred.customerKey;
        }
      }

      const request = await client.criarRequest({
        search: { search_type: "lawsuit_cnj", search_key: input.cnj.replace(/[^\d.-]/g, "") },
        ...(customerKey ? { customer_key: customerKey } : {}),
      });

      // Polling (max 45s)
      const startTime = Date.now();
      while (Date.now() - startTime < 45000) {
        await new Promise((r) => setTimeout(r, 2500));
        const status = await client.consultarRequest(request.request_id);
        if (status.status === "completed") {
          const responses = await client.buscarRespostas(request.request_id, 1, 10);
          const lawsuit = responses.page_data.find((r: any) => r.response_type === "lawsuit");
          if (lawsuit?.response_data) {
            // Salvar em juditRespostas pra ficar persistido (não precisa buscar de novo)
            if (input.monitoramentoId) {
              try {
                const db = await getDb();
                if (db) {
                  const { juditRespostas } = await import("../../drizzle/schema");
                  await db.insert(juditRespostas).values({
                    monitoramentoId: input.monitoramentoId,
                    responseId: lawsuit.response_id || `manual_${Date.now()}`,
                    requestId: request.request_id,
                    responseType: "lawsuit",
                    responseData: JSON.stringify(lawsuit.response_data),
                    stepsCount: (lawsuit.response_data as any).steps?.length || 0,
                  });
                }
              } catch { /* best-effort */ }
            }
            return { processo: lawsuit.response_data, encontrado: true };
          }
          return { processo: null, encontrado: false, mensagem: "Processo não encontrado ou sem acesso." };
        }
      }
      return { processo: null, encontrado: false, mensagem: "Consulta em andamento. Tente novamente." };
    }),

  /**
   * Gera resumo IA detalhado de um processo.
   *
   * Fluxo:
   * 1. Busca processo COMPLETO na Judit (todos os autos/movimentações)
   * 2. Se agente IA configurado → manda pro OpenAI pra análise profunda
   * 3. Se não → monta resumo estruturado com os dados da Judit
   *
   * Cobra 1 crédito.
   */
  /**
   * Gera resumo IA de um processo via Judit (judit_ia: ["summary"]).
   *
   * Fluxo:
   * 1. Faz request com judit_ia: ["summary"] pra Judit gerar resumo nativo
   * 2. Polling até completed
   * 3. Extrai resumo IA + dados do processo (lawsuit) da resposta
   * 4. Se tiver agente IA (OpenAI) configurado, enriquece com análise detalhada
   *
   * Cobra 1 crédito.
   */
  resumoIA: protectedProcedure
    .input(z.object({ cnj: z.string().min(15).max(30) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();

      await consumirCreditos(esc.escritorio.id, ctx.user.id, CUSTOS_OPERACOES.resumo_ia, "resumo_ia", `Resumo IA: ${input.cnj}`);

      // 1. Request com judit_ia: ["summary"] pra resumo nativo + dados completos
      const request = await client.solicitarResumoIA(input.cnj.replace(/[^\d.-]/g, ""));

      // 2. Polling
      let processoData: any = null;
      let resumoJudit: string | null = null;
      const startTime = Date.now();
      while (Date.now() - startTime < 35000) {
        await new Promise((r) => setTimeout(r, 2500));
        const status = await client.consultarRequest(request.request_id);
        if (status.status === "completed") {
          const responses = await client.buscarRespostas(request.request_id, 1, 20);
          for (const r of responses.page_data) {
            if (r.response_type === "lawsuit" && !processoData) {
              processoData = r.response_data;
            }
            // Resumo IA da Judit pode vir como outro response_type
            if (r.response_type === "ai_summary" || r.response_type === "lawsuit_summary") {
              const rd = r.response_data as any;
              resumoJudit = rd?.summary || rd?.text || rd?.content || null;
            }
          }
          break;
        }
      }

      if (!processoData && !resumoJudit) {
        return { resumo: "Não foi possível obter os dados. Tente novamente em alguns segundos.", fonte: "erro" };
      }

      // 3. Se Judit retornou resumo IA nativo, usar direto
      if (resumoJudit) {
        return { resumo: resumoJudit, fonte: "judit_ia", processo: processoData };
      }

      // 4. Fallback: se tiver OpenAI configurado, gerar análise detalhada
      if (processoData) {
        const d = processoData;
        try {
          const { obterConfigChatBot } = await import("../integracoes/chatbot-openai");
          const config = await obterConfigChatBot(esc.escritorio.id);
          if (config?.openaiApiKey) {
            const partesTexto = (d.parties || []).map((p: any) => {
              const advs = (p.lawyers || []).map((l: any) => `  Adv: ${l.name} (OAB ${l.main_document || ""})`).join("\n");
              return `${p.side === "Active" ? "AUTOR" : "RÉU"}: ${p.name}${advs ? "\n" + advs : ""}`;
            }).join("\n");
            const movsTexto = (d.steps || []).slice(0, 30).map((s: any) => `${s.step_date || "S/D"} — ${s.content}`).join("\n");

            const prompt = `Analise DETALHADAMENTE este processo judicial — entre nos autos e dê um resumo executivo para o advogado.

PROCESSO: ${d.code || input.cnj} | ${d.tribunal_acronym || ""} | ${d.classifications?.[0]?.name || ""} | ${(d.subjects || []).map((s: any) => s.name).join(", ")}
VALOR: ${d.amount ? `R$ ${Number(d.amount).toLocaleString("pt-BR")}` : "N/A"} | DISTRIBUIÇÃO: ${d.distribution_date || "N/A"}
VARA: ${d.courts?.[0]?.name || "N/A"}

PARTES:\n${partesTexto || "N/A"}

MOVIMENTAÇÕES (${d.steps?.length || 0} total):\n${movsTexto || "Nenhuma"}

Resumo executivo: 1) Situação atual 2) Cronologia importante 3) Pontos críticos 4) Próximos passos 5) Risco. Cite datas e movimentações específicas.`;

            const res = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.openaiApiKey}` },
              body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 1500, temperature: 0.2 }),
            });
            if (res.ok) {
              const data = await res.json();
              const resumo = data.choices?.[0]?.message?.content?.trim();
              if (resumo) return { resumo, fonte: "ia", processo: processoData };
            }
          }
        } catch { /* fallback */ }

        // 5. Fallback final: resumo estruturado
        const partesCurto = (d.parties || []).map((p: any) => `${p.side === "Active" ? "Autor" : "Réu"}: ${p.name}`).join("; ");
        const ultimasMoves = (d.steps || []).slice(0, 5).map((s: any) => `• ${s.step_date || ""} — ${s.content}`).join("\n");
        return {
          resumo: [
            `**${d.code || input.cnj}** — ${d.tribunal_acronym || ""} ${d.courts?.[0]?.name || ""}`,
            d.classifications?.[0]?.name ? `**Classe:** ${d.classifications[0].name}` : null,
            d.amount ? `**Valor:** R$ ${Number(d.amount).toLocaleString("pt-BR")}` : null,
            `**Partes:** ${partesCurto}`,
            d.steps?.length ? `**${d.steps.length} movimentações.** Últimas:` : null,
            ultimasMoves || null,
          ].filter(Boolean).join("\n"),
          fonte: "estruturado",
          processo: processoData,
        };
      }

      return { resumo: "Processo não encontrado.", fonte: "erro" };
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
