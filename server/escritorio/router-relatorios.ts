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
  colaboradores, setores, asaasCobrancas, categoriasCobranca,
  comissoesFechadas, users,
} from "../../drizzle/schema";
import { eq, and, sql, gte, lte, or, inArray } from "drizzle-orm";
import { createLogger } from "../_core/logger";
import { buildFiltroComissaoSQL } from "./router-financeiro";

const log = createLogger("relatorios");

const PeriodoInput = z
  .object({ dias: z.number().min(1).max(365).optional() })
  .optional();

/** Input do relatório Atendimento — preset OU range custom + setor + atendente.
 *  Sem nenhum input: mês vigente. Com setor: filtra colaboradores do setor.
 *  Com atendente: filtra conversas de um colaborador (e valida que pertence
 *  ao setor escolhido se ambos forem passados). */
const AtendimentoInput = z
  .object({
    dias: z.number().min(1).max(365).optional(),
    dataInicio: z.string().optional(), // YYYY-MM-DD
    dataFim: z.string().optional(),    // YYYY-MM-DD
    setorId: z.number().int().positive().optional(),
    atendenteId: z.number().int().positive().optional(),
  })
  .optional();

/** Mês vigente como range default — primeiro do mês até agora. */
function mesVigente(): { dataInicio: Date; dataFim: Date } {
  const agora = new Date();
  const ini = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0);
  return { dataInicio: ini, dataFim: agora };
}

/** Resolve a lista de colaboradorIds que satisfaz os filtros opcionais
 *  setorId + atendenteId, respeitando permissão (soProprios trava no
 *  próprio colaborador). Retorna null quando o filtro resultaria em
 *  "todos do escritório" (sem WHERE adicional). */
async function resolverColaboradorIds(args: {
  db: any;
  escritorioId: number;
  setorId?: number;
  atendenteId?: number;
  soProprios: boolean;
  proprioColabId: number;
}): Promise<number[] | null> {
  const { db, escritorioId, setorId, atendenteId, soProprios, proprioColabId } = args;

  if (soProprios) return [proprioColabId];

  if (atendenteId) {
    if (setorId) {
      const [c] = await db
        .select({ id: colaboradores.id })
        .from(colaboradores)
        .where(and(
          eq(colaboradores.escritorioId, escritorioId),
          eq(colaboradores.id, atendenteId),
          eq(colaboradores.setorId, setorId),
        ))
        .limit(1);
      return c ? [atendenteId] : [-1];
    }
    return [atendenteId];
  }

  if (setorId) {
    const rows = await db
      .select({ id: colaboradores.id })
      .from(colaboradores)
      .where(and(
        eq(colaboradores.escritorioId, escritorioId),
        eq(colaboradores.setorId, setorId),
      ));
    return rows.length ? rows.map((r: any) => r.id) : [-1];
  }

  return null;
}

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
  /** Atendimento — conversas e mensagens, filtradas por período + setor +
   *  atendente. Default sem filtros = mês vigente do escritório inteiro.
   *  Respeita verProprios (trava no próprio colaborador). */
  atendimento: protectedProcedure.input(AtendimentoInput).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;
    const db = await getDb();
    if (!db) return null;
    const eid = esc.escritorio.id;

    // Range: range custom > preset dias > mês vigente
    let dataInicio: Date;
    let dataFim: Date;
    if (input?.dataInicio && input?.dataFim) {
      dataInicio = new Date(`${input.dataInicio}T00:00:00`);
      dataFim = new Date(`${input.dataFim}T23:59:59`);
    } else if (input?.dias) {
      dataInicio = desdeDias(input.dias);
      dataFim = new Date();
    } else {
      const m = mesVigente();
      dataInicio = m.dataInicio;
      dataFim = m.dataFim;
    }

    const perm = await checkPermission(ctx.user.id, "relatorios", "ver");
    if (!perm.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem permissão para acessar relatórios.",
      });
    }
    const soProprios = !perm.verTodos && perm.verProprios;
    const colabId = esc.colaborador.id;

    const colaboradorIds = await resolverColaboradorIds({
      db,
      escritorioId: eid,
      setorId: input?.setorId,
      atendenteId: input?.atendenteId,
      soProprios,
      proprioColabId: colabId,
    });

    const filtroResp = colaboradorIds
      ? [inArray(conversas.atendenteId, colaboradorIds)]
      : [];

    const baseConv = and(
      eq(conversas.escritorioId, eid),
      gte(conversas.createdAt, dataInicio),
      lte(conversas.createdAt, dataFim),
      ...filtroResp,
    );

    const statusRows = await db
      .select({ status: conversas.status, total: sql<number>`COUNT(*)` })
      .from(conversas)
      .where(baseConv)
      .groupBy(conversas.status);

    const msgRows = await db
      .select({ direcao: mensagens.direcao, total: sql<number>`COUNT(*)` })
      .from(mensagens)
      .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
      .where(and(
        eq(conversas.escritorioId, eid),
        gte(mensagens.createdAt, dataInicio),
        lte(mensagens.createdAt, dataFim),
        ...filtroResp,
      ))
      .groupBy(mensagens.direcao);

    const convsPorDia = await db
      .select({ dia: sql<string>`DATE(createdAtConv)`, total: sql<number>`COUNT(*)` })
      .from(conversas)
      .where(baseConv)
      .groupBy(sql`DATE(createdAtConv)`)
      .orderBy(sql`DATE(createdAtConv)`);

    const msgsPorDia = await db
      .select({ dia: sql<string>`DATE(createdAtMsg)`, total: sql<number>`COUNT(*)` })
      .from(mensagens)
      .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
      .where(and(
        eq(conversas.escritorioId, eid),
        gte(mensagens.createdAt, dataInicio),
        lte(mensagens.createdAt, dataFim),
        ...filtroResp,
      ))
      .groupBy(sql`DATE(createdAtMsg)`)
      .orderBy(sql`DATE(createdAtMsg)`);

    const conversasPorStatus: Record<string, number> = {};
    for (const r of statusRows) conversasPorStatus[r.status as string] = Number(r.total);

    const msgsDirecao: Record<string, number> = {};
    for (const r of msgRows) msgsDirecao[r.direcao as string] = Number(r.total);

    return {
      periodo: {
        dataInicio: dataInicio.toISOString().slice(0, 10),
        dataFim: dataFim.toISOString().slice(0, 10),
      },
      filtros: {
        setorId: input?.setorId ?? null,
        atendenteId: input?.atendenteId ?? null,
      },
      conversasPorStatus,
      totalConversas: Object.values(conversasPorStatus).reduce((a, b) => a + b, 0),
      mensagensEnviadas: msgsDirecao["saida"] || 0,
      mensagensRecebidas: msgsDirecao["entrada"] || 0,
      totalMensagens: (msgsDirecao["saida"] || 0) + (msgsDirecao["entrada"] || 0),
      conversasPorDia: convsPorDia.map((r: any) => ({ dia: String(r.dia), total: Number(r.total) })),
      mensagensPorDia: msgsPorDia.map((r: any) => ({ dia: String(r.dia), total: Number(r.total) })),
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

    log.debug({
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
        valor: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL(14,2))), 0)`,
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

  /**
   * Comercial — Dashboard estilo Looker. Voltado pra times de fechamento
   * (setor tipo='comercial'). Retorna:
   *  - KPIs: faturado, contratos, ticket médio, comissão (atual + período anterior + variação %)
   *  - Ranking de atendentes (qualquer atendente em setor comercial; entra
   *    no ranking mesmo com 0 vendas)
   *  - Meta vs realizado por atendente
   *  - Cobranças por dia (linha do tempo)
   *
   * Filtros aceitos:
   *  - dataInicio / dataFim (default mês vigente)
   *  - setorId — força um setor específico (default: 1º setor tipo='comercial')
   *  - atendenteId — filtra um colaborador específico (valida que pertence
   *    a um setor tipo='comercial')
   *
   * Permissão: verProprios trava o usuário nele mesmo. verTodos vê o ranking
   * completo.
   */
  comercialDashboard: protectedProcedure
    .input(
      z
        .object({
          dataInicio: z.string().optional(),
          dataFim: z.string().optional(),
          setorId: z.number().int().positive().optional(),
          atendenteId: z.number().int().positive().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;
      const db = await getDb();
      if (!db) return null;
      const eid = esc.escritorio.id;

      // Permissão
      const perm = await checkPermission(ctx.user.id, "relatorios", "ver");
      if (!perm.allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sem permissão para acessar relatórios.",
        });
      }
      const soProprios = !perm.verTodos && perm.verProprios;
      const colabId = esc.colaborador.id;

      // ── Range: dataInicio/dataFim sobrepõe; default = mês vigente ─────────
      let dataInicio: Date;
      let dataFim: Date;
      if (input?.dataInicio && input?.dataFim) {
        dataInicio = new Date(`${input.dataInicio}T00:00:00`);
        dataFim = new Date(`${input.dataFim}T23:59:59`);
      } else {
        const m = mesVigente();
        dataInicio = m.dataInicio;
        dataFim = m.dataFim;
      }

      // Período anterior: quando o range cai inteiro num único mês civil,
      // compara com os MESMOS DIAS no mês anterior (ex.: 1-13 mai vs 1-13
      // abr) — padrão MTD vs LMTD que gestor espera. Pra ranges cross-mês,
      // mantém o fallback "mesmos N dias antes" (sliding window).
      const mesmoMesCivil =
        dataInicio.getFullYear() === dataFim.getFullYear()
        && dataInicio.getMonth() === dataFim.getMonth();
      let dataInicioAnterior: Date;
      let dataFimAnterior: Date;
      if (mesmoMesCivil) {
        // Subtrai 1 mês preservando hora/dia. Date() trata overflow
        // (ex.: 31 mar - 1 mês = 3 mar). Pra dashboard isso é aceitável e
        // raro: ranges começam em dia 1 da maioria dos usos.
        dataInicioAnterior = new Date(dataInicio);
        dataInicioAnterior.setMonth(dataInicioAnterior.getMonth() - 1);
        dataFimAnterior = new Date(dataFim);
        dataFimAnterior.setMonth(dataFimAnterior.getMonth() - 1);
      } else {
        const duracaoMs = dataFim.getTime() - dataInicio.getTime();
        dataFimAnterior = new Date(dataInicio.getTime() - 1);
        dataInicioAnterior = new Date(dataFimAnterior.getTime() - duracaoMs);
      }

      // ── Atendentes elegíveis (do setor escolhido ou tipo='comercial') ─────
      // Se setorId vier, usa esse setor. Senão, pega TODOS os colaboradores
      // ativos cujo setor é tipo='comercial' (qualquer setor comercial).
      let atendentesComerciais: Array<{
        id: number;
        userName: string | null;
        userEmail: string | null;
        metaMensal: string | null;
        setorId: number | null;
        setorNome: string | null;
      }> = [];

      const colabsBase = db
        .select({
          id: colaboradores.id,
          userName: users.name,
          userEmail: users.email,
          metaMensal: colaboradores.metaMensal,
          setorId: colaboradores.setorId,
          setorNome: setores.nome,
        })
        .from(colaboradores)
        .innerJoin(users, eq(colaboradores.userId, users.id))
        .leftJoin(setores, eq(colaboradores.setorId, setores.id));

      if (input?.setorId) {
        atendentesComerciais = await colabsBase.where(and(
          eq(colaboradores.escritorioId, eid),
          eq(colaboradores.ativo, true),
          eq(colaboradores.setorId, input.setorId),
        ));
      } else {
        atendentesComerciais = await colabsBase.where(and(
          eq(colaboradores.escritorioId, eid),
          eq(colaboradores.ativo, true),
          eq(setores.tipo, "comercial"),
        ));
      }

      // soProprios trava no próprio colaborador. atendenteId filtra se
      // verTodos. Se atendenteId não pertence ao setor comercial filtrado,
      // ignora (segurança).
      let idsAtendentes = atendentesComerciais.map((c) => c.id);
      if (soProprios) {
        idsAtendentes = idsAtendentes.includes(colabId) ? [colabId] : [];
      } else if (input?.atendenteId) {
        idsAtendentes = idsAtendentes.includes(input.atendenteId)
          ? [input.atendenteId]
          : [];
      }

      // Filtra a lista de atendentes do ranking se atendenteId/soProprios
      const rankingAtendentes = atendentesComerciais.filter((c) =>
        idsAtendentes.includes(c.id),
      );

      if (idsAtendentes.length === 0) {
        return {
          periodo: {
            dataInicio: dataInicio.toISOString().slice(0, 10),
            dataFim: dataFim.toISOString().slice(0, 10),
          },
          periodoAnterior: {
            dataInicio: dataInicioAnterior.toISOString().slice(0, 10),
            dataFim: dataFimAnterior.toISOString().slice(0, 10),
          },
          kpis: {
            faturado: 0,
            faturadoPeriodoAnterior: 0,
            variacaoFaturado: 0,
            contratos: 0,
            contratosPeriodoAnterior: 0,
            variacaoContratos: 0,
            ticketMedio: 0,
            comissao: 0,
          },
          ranking: [],
          cobrancasPorDia: [],
          filtros: {
            setorId: input?.setorId ?? null,
            atendenteId: input?.atendenteId ?? null,
          },
        };
      }

      const STATUS_PAGO = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];

      // ── KPIs período atual ────────────────────────────────────────────────
      const dataInicioStr = dataInicio.toISOString().slice(0, 10);
      const dataFimStr = dataFim.toISOString().slice(0, 10);
      const dataInicioAnteriorStr = dataInicioAnterior.toISOString().slice(0, 10);
      const dataFimAnteriorStr = dataFimAnterior.toISOString().slice(0, 10);

      // Subquery: contatos com lead fechado_ganho no período corrente / anterior.
      // O ranking comercial só conta cobranças cujo cliente fechou DENTRO do
      // mesmo período da análise — clientes antigos que pagam agora ficam fora
      // da meta corrente.
      const contatosFechadosAtual = db
        .select({ id: leads.contatoId })
        .from(leads)
        .where(and(
          eq(leads.escritorioId, eid),
          eq(leads.etapaFunil, "fechado_ganho"),
          gte(leads.createdAt, dataInicio),
          lte(leads.createdAt, dataFim),
        ));
      const contatosFechadosAnt = db
        .select({ id: leads.contatoId })
        .from(leads)
        .where(and(
          eq(leads.escritorioId, eid),
          eq(leads.etapaFunil, "fechado_ganho"),
          gte(leads.createdAt, dataInicioAnterior),
          lte(leads.createdAt, dataFimAnterior),
        ));

      const [agg] = await db
        .select({
          totalFaturado: sql<number>`COALESCE(SUM(CAST(${asaasCobrancas.valor} AS DECIMAL(14,2))), 0)`,
          contratos: sql<number>`COUNT(DISTINCT COALESCE(${asaasCobrancas.parcelamentoLocalId}, CAST(${asaasCobrancas.id} AS CHAR)))`,
        })
        .from(asaasCobrancas)
        .leftJoin(categoriasCobranca, eq(categoriasCobranca.id, asaasCobrancas.categoriaId))
        .where(and(
          eq(asaasCobrancas.escritorioId, eid),
          inArray(asaasCobrancas.atendenteId, idsAtendentes),
          inArray(asaasCobrancas.status, STATUS_PAGO),
          gte(asaasCobrancas.dataPagamento, dataInicioStr),
          lte(asaasCobrancas.dataPagamento, dataFimStr),
          buildFiltroComissaoSQL(["sim"])!,
          inArray(asaasCobrancas.contatoId, contatosFechadosAtual),
        ));

      const totalFaturado = Number(agg?.totalFaturado || 0);
      const contratos = Number(agg?.contratos || 0);
      const ticketMedio = contratos > 0 ? +(totalFaturado / contratos).toFixed(2) : 0;

      // ── KPIs período anterior ─────────────────────────────────────────────
      const [aggAnt] = await db
        .select({
          totalFaturado: sql<number>`COALESCE(SUM(CAST(${asaasCobrancas.valor} AS DECIMAL(14,2))), 0)`,
          contratos: sql<number>`COUNT(DISTINCT COALESCE(${asaasCobrancas.parcelamentoLocalId}, CAST(${asaasCobrancas.id} AS CHAR)))`,
        })
        .from(asaasCobrancas)
        .leftJoin(categoriasCobranca, eq(categoriasCobranca.id, asaasCobrancas.categoriaId))
        .where(and(
          eq(asaasCobrancas.escritorioId, eid),
          inArray(asaasCobrancas.atendenteId, idsAtendentes),
          inArray(asaasCobrancas.status, STATUS_PAGO),
          gte(asaasCobrancas.dataPagamento, dataInicioAnteriorStr),
          lte(asaasCobrancas.dataPagamento, dataFimAnteriorStr),
          buildFiltroComissaoSQL(["sim"])!,
          inArray(asaasCobrancas.contatoId, contatosFechadosAnt),
        ));
      const faturadoAnterior = Number(aggAnt?.totalFaturado || 0);
      const contratosAnterior = Number(aggAnt?.contratos || 0);
      const variacaoFaturado = faturadoAnterior > 0
        ? +(((totalFaturado - faturadoAnterior) / faturadoAnterior) * 100).toFixed(1)
        : totalFaturado > 0 ? 100 : 0;
      const variacaoContratos = contratosAnterior > 0
        ? +(((contratos - contratosAnterior) / contratosAnterior) * 100).toFixed(1)
        : contratos > 0 ? 100 : 0;

      // ── Comissão a receber (fechamentos no período) ───────────────────────
      // Overlap: período da comissão SE SOBREPÕE ao range do dashboard.
      // O filtro antigo exigia que o período da comissão estivesse 100%
      // dentro do range — comissão mensal não aparecia em filtro de
      // quinzena. Agora qualquer interseção entra (valor exibido é o
      // total da comissão, não proporcional ao overlap).
      const comissoesRows = await db
        .select({
          total: sql<number>`COALESCE(SUM(CAST(${comissoesFechadas.totalComissao} AS DECIMAL(14,2))), 0)`,
        })
        .from(comissoesFechadas)
        .where(and(
          eq(comissoesFechadas.escritorioId, eid),
          inArray(comissoesFechadas.atendenteId, idsAtendentes),
          lte(comissoesFechadas.periodoInicio, dataFimStr),
          gte(comissoesFechadas.periodoFim, dataInicioStr),
        ));
      const comissaoTotal = Number(comissoesRows[0]?.total || 0);

      // ── Ranking por atendente ─────────────────────────────────────────────
      // 4 dimensões medidas por atendente:
      //  1) valorFechado: soma valorEstimado dos leads movidos pra
      //     fechado_ganho no período (pipeline). Fonte mais ampla — inclui
      //     pagamentos manuais ou cobranças fora do Asaas.
      //  2) contratosFechados: count desses leads.
      //  3) faturado: soma valor das cobranças pagas (caixa real).
      //  4) contratosPagos: count DISTINCT de contratos pagos
      //     (agrupa parcelas de um mesmo parcelamentoLocalId como 1 só).
      //
      // Taxa de conversão = contratosPagos / contratosFechados.
      // Quando contratosFechados=0 mas tem cobrança paga avulsa: conversão NaN — tratamos como null no front.

      // 1+2: leads ganhos
      const leadsGanhosRows = await db
        .select({
          responsavelId: leads.responsavelId,
          valorFechado: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL(14,2))), 0)`,
          contratosFechados: sql<number>`COUNT(*)`,
        })
        .from(leads)
        .where(and(
          eq(leads.escritorioId, eid),
          inArray(leads.responsavelId, idsAtendentes),
          eq(leads.etapaFunil, "fechado_ganho"),
          gte(leads.createdAt, dataInicio),
          lte(leads.createdAt, dataFim),
        ))
        .groupBy(leads.responsavelId);

      const mapaLeads = new Map<number, { valorFechado: number; contratosFechados: number }>();
      for (const r of leadsGanhosRows) {
        if (r.responsavelId == null) continue;
        mapaLeads.set(Number(r.responsavelId), {
          valorFechado: Number(r.valorFechado || 0),
          contratosFechados: Number(r.contratosFechados || 0),
        });
      }

      // 3+4: cobranças pagas (faturado + contagem com DISTINCT por parent).
      // Filtros aplicados pra refletir a META comercial real:
      //   - status pago (RECEIVED/CONFIRMED/RECEIVED_IN_CASH)
      //   - comissionável efetivo (override=true OR override NULL + cat=true)
      //   - cliente da cobrança tem lead fechado_ganho no MESMO período
      const porAtendenteRows = await db
        .select({
          atendenteId: asaasCobrancas.atendenteId,
          totalFaturado: sql<number>`COALESCE(SUM(CAST(${asaasCobrancas.valor} AS DECIMAL(14,2))), 0)`,
          cobrancas: sql<number>`COUNT(*)`,
          // 1 contrato = 1 parcelamento (todas as parcelas) OU 1 cobrança avulsa.
          // COALESCE pra não confundir distintos com NULLs. Usado pra
          // computar ticketMedio internamente — não vai pro payload final.
          contratosPagos: sql<number>`COUNT(DISTINCT COALESCE(${asaasCobrancas.parcelamentoLocalId}, CAST(${asaasCobrancas.id} AS CHAR)))`,
        })
        .from(asaasCobrancas)
        .leftJoin(categoriasCobranca, eq(categoriasCobranca.id, asaasCobrancas.categoriaId))
        .where(and(
          eq(asaasCobrancas.escritorioId, eid),
          inArray(asaasCobrancas.atendenteId, idsAtendentes),
          inArray(asaasCobrancas.status, STATUS_PAGO),
          gte(asaasCobrancas.dataPagamento, dataInicioStr),
          lte(asaasCobrancas.dataPagamento, dataFimStr),
          buildFiltroComissaoSQL(["sim"])!,
          inArray(asaasCobrancas.contatoId, contatosFechadosAtual),
        ))
        .groupBy(asaasCobrancas.atendenteId);

      const mapaPorAtendente = new Map<number, {
        faturado: number;
        cobrancas: number;
        contratosPagos: number;
      }>();
      for (const r of porAtendenteRows) {
        if (r.atendenteId == null) continue;
        mapaPorAtendente.set(Number(r.atendenteId), {
          faturado: Number(r.totalFaturado || 0),
          cobrancas: Number(r.cobrancas || 0),
          contratosPagos: Number(r.contratosPagos || 0),
        });
      }

      // Atendentes do setor sempre aparecem no ranking (mesmo com 0 vendas)
      // pra dar visibilidade de quem não vendeu. Ordenado por faturado desc.
      const ranking = rankingAtendentes
        .map((c) => {
          const pagos = mapaPorAtendente.get(c.id) ?? { faturado: 0, cobrancas: 0, contratosPagos: 0 };
          const leadsDados = mapaLeads.get(c.id) ?? { valorFechado: 0, contratosFechados: 0 };
          const meta = c.metaMensal != null ? Number(c.metaMensal) : null;
          const progressoMeta = meta && meta > 0
            ? +((pagos.faturado / meta) * 100).toFixed(1)
            : null;
          return {
            atendenteId: c.id,
            nome: c.userName || c.userEmail || `#${c.id}`,
            setorNome: c.setorNome,
            // Pipeline (leads fechados)
            valorFechado: leadsDados.valorFechado,
            contratosFechados: leadsDados.contratosFechados,
            // Caixa (cobranças comissionáveis de clientes fechados no período)
            faturado: pagos.faturado,
            // ticketMedio = faturado / contratosPagos, calculado aqui pra UI
            // não precisar do contratosPagos no payload.
            ticketMedio: pagos.contratosPagos > 0
              ? +(pagos.faturado / pagos.contratosPagos).toFixed(2)
              : 0,
            meta,
            progressoMeta,
          };
        })
        .sort((a, b) => b.faturado - a.faturado);

      // ── Cobranças por dia (linha do tempo) ────────────────────────────────
      // Mesmo filtro do KPI agregado pra manter consistência entre o
      // gráfico e o total "Faturado" mostrado no topo.
      const porDiaRows = await db
        .select({
          dia: sql<string>`DATE(${asaasCobrancas.dataPagamento})`,
          faturado: sql<number>`COALESCE(SUM(CAST(${asaasCobrancas.valor} AS DECIMAL(14,2))), 0)`,
          // Parcelas do mesmo parcelamento contam como 1 contrato, igual ao
          // KPI agregado do topo — evita gráfico mostrar "3 contratos no
          // dia X" quando são 3 parcelas do mesmo cliente.
          contratos: sql<number>`COUNT(DISTINCT COALESCE(${asaasCobrancas.parcelamentoLocalId}, CAST(${asaasCobrancas.id} AS CHAR)))`,
        })
        .from(asaasCobrancas)
        .leftJoin(categoriasCobranca, eq(categoriasCobranca.id, asaasCobrancas.categoriaId))
        .where(and(
          eq(asaasCobrancas.escritorioId, eid),
          inArray(asaasCobrancas.atendenteId, idsAtendentes),
          inArray(asaasCobrancas.status, STATUS_PAGO),
          gte(asaasCobrancas.dataPagamento, dataInicioStr),
          lte(asaasCobrancas.dataPagamento, dataFimStr),
          buildFiltroComissaoSQL(["sim"])!,
          inArray(asaasCobrancas.contatoId, contatosFechadosAtual),
        ))
        .groupBy(sql`DATE(${asaasCobrancas.dataPagamento})`)
        .orderBy(sql`DATE(${asaasCobrancas.dataPagamento})`);

      return {
        periodo: {
          dataInicio: dataInicioStr,
          dataFim: dataFimStr,
        },
        periodoAnterior: {
          dataInicio: dataInicioAnteriorStr,
          dataFim: dataFimAnteriorStr,
        },
        kpis: {
          faturado: totalFaturado,
          faturadoPeriodoAnterior: faturadoAnterior,
          variacaoFaturado,
          contratos,
          contratosPeriodoAnterior: contratosAnterior,
          variacaoContratos,
          ticketMedio,
          comissao: comissaoTotal,
        },
        ranking,
        cobrancasPorDia: porDiaRows.map((r) => ({
          dia: String(r.dia),
          faturado: Number(r.faturado || 0),
          contratos: Number(r.contratos || 0),
        })),
        filtros: {
          setorId: input?.setorId ?? null,
          atendenteId: input?.atendenteId ?? null,
        },
      };
    }),

  /**
   * Detalhamento por atendente do dashboard Comercial — drill-down do ranking.
   *
   * Pra cada cliente fechado/pago pelo atendente no período:
   *   - `valorFechado`: soma `leads.valorEstimado` (etapaFunil=fechado_ganho)
   *   - `contratosFechados`: count desses leads
   *   - `valorRecebido`: soma cobranças pagas
   *   - `contratosPagos`: count DISTINCT(COALESCE(parcelamentoLocalId, id))
   *
   * Combina por contatoId (cliente pode ter sido fechado mas ainda não pagou,
   * ou pago sem ter lead — caso de cobrança avulsa direta). Ordenado por
   * valor fechado desc; clientes sem fechado mas com pagamento vão no fim.
   */
  detalheAtendenteComercial: protectedProcedure
    .input(z.object({
      atendenteId: z.number().int().positive(),
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;
      const db = await getDb();
      if (!db) return null;
      const eid = esc.escritorio.id;

      const perm = await checkPermission(ctx.user.id, "relatorios", "ver");
      if (!perm.allowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para acessar relatórios." });
      }
      // verProprios: só pode ver o detalhe do próprio atendente
      if (!perm.verTodos && perm.verProprios && input.atendenteId !== esc.colaborador.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode ver o próprio detalhamento." });
      }

      // Range: default = mês vigente
      let dataInicio: Date;
      let dataFim: Date;
      if (input.dataInicio && input.dataFim) {
        dataInicio = new Date(`${input.dataInicio}T00:00:00`);
        dataFim = new Date(`${input.dataFim}T23:59:59`);
      } else {
        const m = mesVigente();
        dataInicio = m.dataInicio;
        dataFim = m.dataFim;
      }
      const dataInicioStr = dataInicio.toISOString().slice(0, 10);
      const dataFimStr = dataFim.toISOString().slice(0, 10);
      const STATUS_PAGO_LOCAL = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];

      // ── Leads fechado_ganho do atendente, agrupados por contatoId ──────────
      const leadsRows = await db
        .select({
          contatoId: leads.contatoId,
          valorFechado: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL(14,2))), 0)`,
          contratosFechados: sql<number>`COUNT(*)`,
        })
        .from(leads)
        .where(and(
          eq(leads.escritorioId, eid),
          eq(leads.responsavelId, input.atendenteId),
          eq(leads.etapaFunil, "fechado_ganho"),
          gte(leads.createdAt, dataInicio),
          lte(leads.createdAt, dataFim),
        ))
        .groupBy(leads.contatoId);

      // ── Cobranças pagas do atendente, agrupadas por contatoId ──────────────
      const cobrancasRows = await db
        .select({
          contatoId: asaasCobrancas.contatoId,
          valorRecebido: sql<number>`COALESCE(SUM(CAST(${asaasCobrancas.valor} AS DECIMAL(14,2))), 0)`,
          contratosPagos: sql<number>`COUNT(DISTINCT COALESCE(${asaasCobrancas.parcelamentoLocalId}, CAST(${asaasCobrancas.id} AS CHAR)))`,
        })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, eid),
          eq(asaasCobrancas.atendenteId, input.atendenteId),
          inArray(asaasCobrancas.status, STATUS_PAGO_LOCAL),
          gte(asaasCobrancas.dataPagamento, dataInicioStr),
          lte(asaasCobrancas.dataPagamento, dataFimStr),
        ))
        .groupBy(asaasCobrancas.contatoId);

      // ── Combinar por contatoId ─────────────────────────────────────────────
      type Linha = {
        contatoId: number;
        valorFechado: number;
        contratosFechados: number;
        valorRecebido: number;
        contratosPagos: number;
      };
      const mapaPorContato = new Map<number, Linha>();
      for (const r of leadsRows) {
        if (r.contatoId == null) continue;
        mapaPorContato.set(Number(r.contatoId), {
          contatoId: Number(r.contatoId),
          valorFechado: Number(r.valorFechado || 0),
          contratosFechados: Number(r.contratosFechados || 0),
          valorRecebido: 0,
          contratosPagos: 0,
        });
      }
      for (const r of cobrancasRows) {
        if (r.contatoId == null) continue;
        const id = Number(r.contatoId);
        const atual = mapaPorContato.get(id);
        if (atual) {
          atual.valorRecebido = Number(r.valorRecebido || 0);
          atual.contratosPagos = Number(r.contratosPagos || 0);
        } else {
          mapaPorContato.set(id, {
            contatoId: id,
            valorFechado: 0,
            contratosFechados: 0,
            valorRecebido: Number(r.valorRecebido || 0),
            contratosPagos: Number(r.contratosPagos || 0),
          });
        }
      }

      const idsContatos = Array.from(mapaPorContato.keys());
      if (idsContatos.length === 0) {
        return { itens: [], totalFechado: 0, totalRecebido: 0 };
      }

      // ── Nomes dos contatos ────────────────────────────────────────────────
      const contatosRows = await db
        .select({ id: contatos.id, nome: contatos.nome })
        .from(contatos)
        .where(and(eq(contatos.escritorioId, eid), inArray(contatos.id, idsContatos)));
      const mapaNome = new Map<number, string>();
      for (const c of contatosRows) mapaNome.set(c.id, c.nome);

      // ── Monta resposta ────────────────────────────────────────────────────
      let totalFechado = 0;
      let totalRecebido = 0;
      const itens = Array.from(mapaPorContato.values()).map((l) => {
        totalFechado += l.valorFechado;
        totalRecebido += l.valorRecebido;
        // Status: pago / parcial / aguardando / só_pago (sem lead)
        let status: "pago" | "parcial" | "aguardando" | "so_pago";
        if (l.valorFechado === 0 && l.valorRecebido > 0) status = "so_pago";
        else if (l.valorRecebido === 0) status = "aguardando";
        else if (l.valorRecebido + 0.01 >= l.valorFechado) status = "pago";
        else status = "parcial";
        return { ...l, nome: mapaNome.get(l.contatoId) || `Cliente #${l.contatoId}`, status };
      });

      itens.sort((a, b) => {
        // Fechados primeiro (desc por valor); depois "só pagos" no fim
        if ((a.valorFechado > 0) !== (b.valorFechado > 0)) {
          return a.valorFechado > 0 ? -1 : 1;
        }
        return b.valorFechado - a.valorFechado || b.valorRecebido - a.valorRecebido;
      });

      return { itens, totalFechado, totalRecebido };
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

    log.debug({
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
