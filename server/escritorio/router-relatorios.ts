/**
 * Router Relatórios — KPIs + Análises do escritório.
 *
 * Consolidação de Métricas + Relatórios (antes eram 2 módulos separados
 * com funções sobrepostas). Agora 4 endpoints com filtro de período:
 *
 * - atendimento: conversas + mensagens (Operacional antigo de Relatórios)
 * - comercial: leads + funil + origem + taxa de conversão
 * - producao: Kanban — cards, atrasados, movimentações (Operacional de Métricas)
 * - calculos: histórico de cálculos do usuário (Financeiro antigo)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { checkPermission } from "../escritorio/check-permission";
import { getDb } from "../db";
import {
  conversas, mensagens, leads, contatos, calculosHistorico,
  kanbanCards, kanbanColunas, kanbanMovimentacoes,
} from "../../drizzle/schema";
import { eq, and, sql, gte, lte, or, inArray } from "drizzle-orm";
import { createLogger } from "../_core/logger";

const log = createLogger("relatorios");

const PeriodoInput = z
  .object({ dias: z.number().min(1).max(365).optional() })
  .optional();

/** Input do relatório Comercial — aceita preset de dias OU range
 *  customizado (dataInicio/dataFim) + filtro opcional por atendente.
 *  Quando dataInicio+dataFim vêm preenchidos, sobrepõem `dias`. */
const ComercialInput = z
  .object({
    dias: z.number().min(1).max(365).optional(),
    dataInicio: z.string().optional(), // YYYY-MM-DD
    dataFim: z.string().optional(),    // YYYY-MM-DD
    responsavelId: z.number().int().positive().optional(),
  })
  .optional();

const ProducaoInput = z
  .object({
    dias: z.number().min(1).max(365).optional(),
    /** Se presente, filtra os KPIs de Produção ao funil escolhido.
     *  Ausente/null = todos os funis do escritório. */
    funilId: z.number().optional(),
  })
  .optional();

function desdeDias(dias: number): Date {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

/** Origens "ativas" — só os canais por onde leads de fato CHEGAM ao
 *  escritório. Asaas é cobrança (cliente já existente) e telefone/site
 *  não fazem parte do funil de captação direto. */
const ORIGENS_LEAD = ["whatsapp", "instagram", "facebook", "manual"] as const;

export const relatoriosRouter = router({
  /** Atendimento — conversas e mensagens.
   *  Respeita verProprios: filtra conversas por responsavelId. */
  atendimento: protectedProcedure.input(PeriodoInput).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;
    const db = await getDb();
    if (!db) return null;
    const eid = esc.escritorio.id;
    const dias = input?.dias || 30;
    const desde = desdeDias(dias);

    const perm = await checkPermission(ctx.user.id, "relatorios", "ver");
    if (!perm.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem permissão para acessar relatórios.",
      });
    }
    const soProprios = !perm.verTodos && perm.verProprios;
    const colabId = esc.colaborador.id;
    const filtroResp = soProprios ? [eq(conversas.atendenteId, colabId)] : [];

    log.info({
      proc: "atendimento",
      userId: ctx.user.id,
      colabId,
      escritorioId: eid,
      cargo: esc.colaborador.cargo,
      perm: { verTodos: perm.verTodos, verProprios: perm.verProprios, allowed: perm.allowed },
      soProprios,
      dias,
    }, "[relatorios] diagnóstico atendimento");

    const statusRows = await db
      .select({ status: conversas.status, total: sql<number>`COUNT(*)` })
      .from(conversas)
      .where(and(eq(conversas.escritorioId, eid), gte(conversas.createdAt, desde), ...filtroResp))
      .groupBy(conversas.status);

    const msgRows = await db
      .select({ direcao: mensagens.direcao, total: sql<number>`COUNT(*)` })
      .from(mensagens)
      .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
      .where(and(eq(conversas.escritorioId, eid), gte(mensagens.createdAt, desde), ...filtroResp))
      .groupBy(mensagens.direcao);

    const convsPorDia = await db
      .select({ dia: sql<string>`DATE(createdAtConv)`, total: sql<number>`COUNT(*)` })
      .from(conversas)
      .where(and(eq(conversas.escritorioId, eid), gte(conversas.createdAt, desde), ...filtroResp))
      .groupBy(sql`DATE(createdAtConv)`)
      .orderBy(sql`DATE(createdAtConv)`);

    const msgsPorDia = await db
      .select({ dia: sql<string>`DATE(createdAtMsg)`, total: sql<number>`COUNT(*)` })
      .from(mensagens)
      .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
      .where(and(eq(conversas.escritorioId, eid), gte(mensagens.createdAt, desde), ...filtroResp))
      .groupBy(sql`DATE(createdAtMsg)`)
      .orderBy(sql`DATE(createdAtMsg)`);

    const conversasPorStatus: Record<string, number> = {};
    for (const r of statusRows) conversasPorStatus[r.status as string] = Number(r.total);

    const msgsDirecao: Record<string, number> = {};
    for (const r of msgRows) msgsDirecao[r.direcao as string] = Number(r.total);

    return {
      periodo: dias,
      conversasPorStatus,
      totalConversas: Object.values(conversasPorStatus).reduce((a, b) => a + b, 0),
      mensagensEnviadas: msgsDirecao["saida"] || 0,
      mensagensRecebidas: msgsDirecao["entrada"] || 0,
      totalMensagens: (msgsDirecao["saida"] || 0) + (msgsDirecao["entrada"] || 0),
      conversasPorDia: convsPorDia.map((r) => ({ dia: String(r.dia), total: Number(r.total) })),
      mensagensPorDia: msgsPorDia.map((r) => ({ dia: String(r.dia), total: Number(r.total) })),
    };
  }),

  /**
   * Comercial — leads, funil, origem e taxa de conversão.
   *
   * Filtros aceitos:
   *  - `dias` (preset 7/15/30/90/365) OU `dataInicio`+`dataFim` (range custom)
   *  - `responsavelId` (atendente específico) — só aplicado se o usuário tem
   *    permissão `verTodos`; quem tem só `verProprios` continua filtrado pelo
   *    próprio colaboradorId.
   *
   * Definições:
   *  - Contratos fechados = leads com `etapaFunil = 'fechado_ganho'` no
   *    período. É o que o atendente "moveu para Ganho" no pipeline.
   *  - Conversão = contratos fechados / total de leads do período.
   *  - Origem dos contatos = whitelist `ORIGENS_LEAD` (whatsapp, instagram,
   *    facebook, manual). Asaas é cobrança (cliente existente, não lead).
   */
  comercial: protectedProcedure.input(ComercialInput).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;
    const db = await getDb();
    if (!db) return null;
    const eid = esc.escritorio.id;

    // ── Período: range custom sobrepõe preset de dias ──────────────────────
    const dias = input?.dias || 30;
    let dataInicio: Date;
    let dataFim: Date;
    if (input?.dataInicio && input?.dataFim) {
      dataInicio = new Date(`${input.dataInicio}T00:00:00`);
      dataFim = new Date(`${input.dataFim}T23:59:59`);
    } else {
      dataInicio = desdeDias(dias);
      dataFim = new Date();
    }

    // ── Permissão + filtro por atendente ───────────────────────────────────
    const perm = await checkPermission(ctx.user.id, "relatorios", "ver");
    if (!perm.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem permissão para acessar relatórios.",
      });
    }
    const soProprios = !perm.verTodos && perm.verProprios;
    const colabId = esc.colaborador.id;

    // verProprios trava no próprio colaborador. verTodos pode escolher um.
    // Atendente sem verTodos só pode filtrar por ELE MESMO — ignora qualquer
    // tentativa de filtrar por outro colaborador via input (proteção contra
    // dropdown comprometido).
    const filtroAtendente = soProprios
      ? colabId
      : (input?.responsavelId ?? null);

    log.info({
      proc: "comercial",
      userId: ctx.user.id,
      colabId,
      escritorioId: eid,
      cargo: esc.colaborador.cargo,
      perm: { verTodos: perm.verTodos, verProprios: perm.verProprios, allowed: perm.allowed },
      soProprios,
      inputResponsavelId: input?.responsavelId ?? null,
      filtroAtendente,
      dataInicio: dataInicio.toISOString(),
      dataFim: dataFim.toISOString(),
    }, "[relatorios] diagnóstico comercial");

    const filtroLeadResp = filtroAtendente
      ? [eq(leads.responsavelId, filtroAtendente)]
      : [];
    const filtroContResp = filtroAtendente
      ? [eq(contatos.responsavelId, filtroAtendente)]
      : [];
    const filtroConvResp = filtroAtendente
      ? [eq(conversas.atendenteId, filtroAtendente)]
      : [];

    const rangeLead = [gte(leads.createdAt, dataInicio), lte(leads.createdAt, dataFim)];
    const rangeContato = [gte(contatos.createdAt, dataInicio), lte(contatos.createdAt, dataFim)];
    const rangeConv = [gte(conversas.createdAt, dataInicio), lte(conversas.createdAt, dataFim)];

    // ── Etapas do funil (com valor estimado) ───────────────────────────────
    const etapaRows = await db
      .select({
        etapa: leads.etapaFunil,
        total: sql<number>`COUNT(*)`,
        valor: sql<number>`COALESCE(SUM(CAST(valorEstimado AS DECIMAL(14,2))), 0)`,
      })
      .from(leads)
      .where(and(eq(leads.escritorioId, eid), ...rangeLead, ...filtroLeadResp))
      .groupBy(leads.etapaFunil);

    // ── Leads por mês (sempre 6m, gráfico de tendência longa) ──────────────
    const leadsPorMes = await db
      .select({
        mes: sql<string>`DATE_FORMAT(createdAtLead,'%Y-%m')`,
        total: sql<number>`COUNT(*)`,
      })
      .from(leads)
      .where(
        and(
          eq(leads.escritorioId, eid),
          sql`createdAtLead >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)`,
          ...filtroLeadResp,
        ),
      )
      .groupBy(sql`DATE_FORMAT(createdAtLead,'%Y-%m')`)
      .orderBy(sql`DATE_FORMAT(createdAtLead,'%Y-%m')`);

    // ── Contatos por origem (whitelist + range do período) ─────────────────
    // Excluímos asaas/site/telefone: o relatório foca em CAPTAÇÃO ativa de
    // leads (canais por onde o cliente novo chega).
    const origemRows = await db
      .select({ origem: contatos.origem, total: sql<number>`COUNT(*)` })
      .from(contatos)
      .where(
        and(
          eq(contatos.escritorioId, eid),
          inArray(contatos.origem, [...ORIGENS_LEAD]),
          ...rangeContato,
          ...filtroContResp,
        ),
      )
      .groupBy(contatos.origem);

    // ── Conversas atendidas no período ─────────────────────────────────────
    const [conversasTotal] = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(conversas)
      .where(and(eq(conversas.escritorioId, eid), ...rangeConv, ...filtroConvResp));

    // ── Agregações finais ──────────────────────────────────────────────────
    const etapas: Record<string, { total: number; valor: number }> = {};
    for (const r of etapaRows) {
      etapas[r.etapa as string] = { total: Number(r.total), valor: Number(r.valor) };
    }
    const totalLeads = Object.values(etapas).reduce((a, b) => a + b.total, 0);
    const leadsGanhos = etapas["fechado_ganho"]?.total || 0;
    const leadsPerdidos = etapas["fechado_perdido"]?.total || 0;
    const taxaConversao =
      totalLeads > 0 ? parseFloat(((leadsGanhos / totalLeads) * 100).toFixed(1)) : 0;
    const valorGanho = etapas["fechado_ganho"]?.valor || 0;
    const valorPerdido = etapas["fechado_perdido"]?.valor || 0;
    const valorPipeline = Object.entries(etapas)
      .filter(([k]) => !["fechado_ganho", "fechado_perdido"].includes(k))
      .reduce((a, [, v]) => a + v.valor, 0);

    return {
      periodo: dias,
      dataInicio: dataInicio.toISOString(),
      dataFim: dataFim.toISOString(),
      // KPIs
      conversasAtendidas: Number(conversasTotal?.total || 0),
      totalLeads,
      leadsGanhos,
      leadsPerdidos,
      taxaConversao,
      valorGanho,
      valorPipeline,
      valorPerdido,
      // Detalhes
      etapas,
      leadsPorMes: leadsPorMes.map((r) => ({ mes: String(r.mes), total: Number(r.total) })),
      contatosPorOrigem: origemRows.map((r) => ({
        origem: r.origem as string,
        total: Number(r.total),
      })),
    };
  }),

  /** Produção — Kanban, cards, atrasados, movimentações.
   *  Aceita filtro opcional por `funilId` (ou todos os funis do escritório).
   */
  producao: protectedProcedure.input(ProducaoInput).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;
    const db = await getDb();
    if (!db) return null;
    const eid = esc.escritorio.id;
    const dias = input?.dias || 30;
    const desde = desdeDias(dias);
    const funilId = input?.funilId;

    // Permissão: verProprios filtra cards por responsavelId
    const perm = await checkPermission(ctx.user.id, "relatorios", "ver");
    if (!perm.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem permissão para acessar relatórios.",
      });
    }
    const soProprios = !perm.verTodos && perm.verProprios;
    const colabId = esc.colaborador.id;
    const filtroResp = soProprios ? [eq(kanbanCards.responsavelId, colabId)] : [];

    log.info({
      proc: "producao",
      userId: ctx.user.id,
      colabId,
      escritorioId: eid,
      cargo: esc.colaborador.cargo,
      perm: { verTodos: perm.verTodos, verProprios: perm.verProprios, allowed: perm.allowed },
      soProprios,
      funilId: funilId ?? null,
      dias,
    }, "[relatorios] diagnóstico producao");

    // ── Helpers ─────────────────────────────────────────────────────────────
    // Quando há filtro de funil, todos os counts de cards precisam fazer
    // JOIN com kanbanColunas (pois o funilId mora na coluna, não no card).

    const cardsBase = (extraWhere: any) => {
      const conditions = [eq(kanbanCards.escritorioId, eid), extraWhere, ...filtroResp];
      const q = db
        .select({ total: sql<number>`COUNT(${kanbanCards.id})` })
        .from(kanbanCards);
      if (funilId !== undefined) {
        return q
          .innerJoin(kanbanColunas, eq(kanbanCards.colunaId, kanbanColunas.id))
          .where(and(...conditions, eq(kanbanColunas.funilId, funilId)));
      }
      return q.where(and(...conditions));
    };

    const [cardsTotal] = await cardsBase(gte(kanbanCards.createdAt, desde));
    const [cardsAtrasados] = await cardsBase(eq(kanbanCards.atrasado, true));
    const [cardsDentroPrazo] = await cardsBase(
      and(eq(kanbanCards.atrasado, false), gte(kanbanCards.createdAt, desde)),
    );

    // ── Movimentações ──────────────────────────────────────────────────────
    // IMPORTANTE: antes a query não filtrava por escritório, contando movs
    // de todos os escritórios do sistema. Agora SEMPRE faz JOIN com card +
    // coluna para garantir isolamento (e aplicar filtro de funil quando vier).
    const movsQuery = db
      .select({ total: sql<number>`COUNT(${kanbanMovimentacoes.id})` })
      .from(kanbanMovimentacoes)
      .innerJoin(kanbanCards, eq(kanbanMovimentacoes.cardId, kanbanCards.id))
      .innerJoin(kanbanColunas, eq(kanbanCards.colunaId, kanbanColunas.id));

    const movsConditions = [
      gte(kanbanMovimentacoes.createdAt, desde),
      eq(kanbanCards.escritorioId, eid),
      ...filtroResp,
    ];
    if (funilId !== undefined) movsConditions.push(eq(kanbanColunas.funilId, funilId));
    const [movsTotal] = await movsQuery.where(and(...movsConditions));

    // ── Distribuição por etapa (coluna) ────────────────────────────────────
    const colunasConditions = [eq(kanbanCards.escritorioId, eid), ...filtroResp];
    if (funilId !== undefined) colunasConditions.push(eq(kanbanColunas.funilId, funilId));
    const cardsPorColuna = await db
      .select({
        colunaNome: kanbanColunas.nome,
        total: sql<number>`COUNT(${kanbanCards.id})`,
      })
      .from(kanbanCards)
      .innerJoin(kanbanColunas, eq(kanbanCards.colunaId, kanbanColunas.id))
      .where(and(...colunasConditions))
      .groupBy(kanbanColunas.id, kanbanColunas.nome);

    const total = Number(cardsTotal?.total || 0);
    const dentro = Number(cardsDentroPrazo?.total || 0);

    return {
      periodo: dias,
      funilId: funilId ?? null,
      cardsTotal: total,
      cardsAtrasados: Number(cardsAtrasados?.total || 0),
      cardsDentroPrazo: dentro,
      movimentacoes: Number(movsTotal?.total || 0),
      cardsPorColuna: cardsPorColuna.map((c) => ({
        coluna: c.colunaNome,
        total: Number(c.total),
      })),
      taxaDentroPrazo: total > 0 ? Math.round((dentro / total) * 100) : 100,
    };
  }),

  /** Cálculos — histórico de cálculos do usuário */
  calculos: protectedProcedure.input(PeriodoInput).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return null;
    const dias = input?.dias || 30;
    const desde = desdeDias(dias);

    const calcRows = await db
      .select({ tipo: calculosHistorico.tipo, total: sql<number>`COUNT(*)` })
      .from(calculosHistorico)
      .where(
        and(
          eq(calculosHistorico.userId, ctx.user.id),
          gte(calculosHistorico.createdAt, desde),
        ),
      )
      .groupBy(calculosHistorico.tipo);

    const calcPorMes = await db
      .select({
        mes: sql<string>`DATE_FORMAT(createdAt,'%Y-%m')`,
        total: sql<number>`COUNT(*)`,
      })
      .from(calculosHistorico)
      .where(
        and(
          eq(calculosHistorico.userId, ctx.user.id),
          sql`createdAt >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)`,
        ),
      )
      .groupBy(sql`DATE_FORMAT(createdAt,'%Y-%m')`)
      .orderBy(sql`DATE_FORMAT(createdAt,'%Y-%m')`);

    const calculosPorTipo: Record<string, number> = {};
    for (const r of calcRows) calculosPorTipo[r.tipo as string] = Number(r.total);

    return {
      periodo: dias,
      calculosPorTipo,
      totalCalculos: Object.values(calculosPorTipo).reduce((a, b) => a + b, 0),
      calculosPorMes: calcPorMes.map((r) => ({
        mes: String(r.mes),
        total: Number(r.total),
      })),
    };
  }),
});
