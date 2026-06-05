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
import { protectedProcedure, router, createCallerFactory } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { checkPermission } from "../escritorio/check-permission";
import { getDb } from "../db";
import {
  conversas, mensagens, leads, contatos, calculosHistorico,
  kanbanCards, kanbanColunas, kanbanMovimentacoes,
  colaboradores, setores, asaasCobrancas, categoriasCobranca,
  comissoesFechadas, users, canaisIntegrados,
} from "../../drizzle/schema";
import { eq, and, sql, gte, lte, or, inArray } from "drizzle-orm";
import { createLogger } from "../_core/logger";
import { STATUS_PAGO_ASAAS } from "../_core/asaas-status";
import { buildFiltroComissaoSQL } from "./router-financeiro";
import {
  resolverPeriodoNoFuso,
  subtrairUmMesISO,
  inicioDoDiaNoFuso,
  fimDoDiaNoFuso,
  dataHojeBR,
  FUSO_HORARIO_PADRAO,
} from "../../shared/escritorio-types";
import { gerarComercialPdf, type DetalheAtendentePdf } from "./relatorios-comercial-pdf";

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
    canalId: z.number().int().positive().optional(),
  })
  .optional();

/** Meta mensal proporcional ao range — `meta * (diasNoRange / diasNoMes)`.
 *  Usa o mês civil de `dataInicio` como denominador. Ranges multi-mês
 *  aceitam a aproximação (mesma escala). */
export function metaProporcionalPeriodo(
  metaMensal: number,
  dataInicio: Date,
  dataFim: Date,
): number {
  const dayMs = 24 * 60 * 60 * 1000;
  const diasNoRange =
    Math.floor((dataFim.getTime() - dataInicio.getTime()) / dayMs) + 1;
  const diasNoMes = new Date(
    dataInicio.getFullYear(),
    dataInicio.getMonth() + 1,
    0,
  ).getDate();
  return metaMensal * (diasNoRange / diasNoMes);
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

export function desdeDias(dias: number): Date {
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

    // Range: range custom > preset dias > mês vigente (no fuso do escritório)
    const tz = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
    let dataInicio: Date;
    let dataFim: Date;
    if (input?.dias && !(input?.dataInicio && input?.dataFim)) {
      dataInicio = desdeDias(input.dias);
      dataFim = new Date();
    } else {
      const p = resolverPeriodoNoFuso(new Date(), tz, input);
      dataInicio = p.dataInicio;
      dataFim = p.dataFim;
    }
    // Período anterior pra cálculo de deltas (mesmo número de dias antes).
    // Ex: período 01-30/Maio (30d) → anterior 01-31/Abril (30d).
    const dur = dataFim.getTime() - dataInicio.getTime();
    const dataInicioAnt = new Date(dataInicio.getTime() - dur);
    const dataFimAnt = new Date(dataInicio.getTime() - 1);

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

    const filtroAtendConv = colaboradorIds
      ? [inArray(conversas.atendenteId, colaboradorIds)]
      : [];
    const filtroRespLead = colaboradorIds
      ? [inArray(leads.responsavelId, colaboradorIds)]
      : [];
    const filtroCanal = input?.canalId
      ? [eq(conversas.canalId, input.canalId)]
      : [];

    const baseConv = and(
      eq(conversas.escritorioId, eid),
      gte(conversas.createdAt, dataInicio),
      lte(conversas.createdAt, dataFim),
      ...filtroAtendConv,
      ...filtroCanal,
    );
    // Pra contar leads filtrados por canal, precisa join com conversas.
    // Conditions reusados em vários querys de leads.
    const baseLeadCriacao = (di: Date, df: Date) => and(
      eq(leads.escritorioId, eid),
      gte(leads.createdAt, di),
      lte(leads.createdAt, df),
      ...filtroRespLead,
    );
    const baseLeadFechado = (di: Date, df: Date, etapa: "fechado_ganho" | "fechado_perdido") => and(
      eq(leads.escritorioId, eid),
      eq(leads.etapaFunil, etapa),
      sql`${leads.fechadoEm} IS NOT NULL`,
      gte(leads.fechadoEm, di),
      lte(leads.fechadoEm, df),
      ...filtroRespLead,
    );

    // ─── Conversas: status, mensagens, por dia ──────────────────────────
    const [statusRows, msgRows, convsPorDia] = await Promise.all([
      db.select({ status: conversas.status, total: sql<number>`COUNT(*)` })
        .from(conversas).where(baseConv).groupBy(conversas.status),
      db.select({ direcao: mensagens.direcao, total: sql<number>`COUNT(*)` })
        .from(mensagens)
        .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
        .where(and(
          eq(conversas.escritorioId, eid),
          gte(mensagens.createdAt, dataInicio),
          lte(mensagens.createdAt, dataFim),
          ...filtroAtendConv,
          ...filtroCanal,
        ))
        .groupBy(mensagens.direcao),
      db.select({ dia: sql<string>`DATE(createdAtConv)`, total: sql<number>`COUNT(*)` })
        .from(conversas).where(baseConv)
        .groupBy(sql`DATE(createdAtConv)`)
        .orderBy(sql`DATE(createdAtConv)`),
    ]);

    const conversasPorStatus: Record<string, number> = {};
    for (const r of statusRows) conversasPorStatus[r.status as string] = Number(r.total);
    const msgsDirecao: Record<string, number> = {};
    for (const r of msgRows) msgsDirecao[r.direcao as string] = Number(r.total);
    const totalConversas = Object.values(conversasPorStatus).reduce((a, b) => a + b, 0);

    // ─── Leads: funil, agregados, por dia, motivos de perda ────────────
    // Canal filtra via join com conversas (NULL → fora se filtroCanal ativo).
    const joinCanalLead = (q: any) => input?.canalId
      ? q.innerJoin(conversas, eq(leads.conversaId, conversas.id))
      : q;

    const [
      leadsRecebidosRow,
      leadsRecebidosAntRow,
      leadsGanhosRow,
      leadsGanhosAntRow,
      leadsPerdidosRow,
      leadsPerdidosAntRow,
      leadsEmPipelineRow,
      funilRows,
      motivosRows,
      cicloRows,
    ] = await Promise.all([
      joinCanalLead(
        db.select({ total: sql<number>`COUNT(*)` }).from(leads)
      ).where(baseLeadCriacao(dataInicio, dataFim)),
      joinCanalLead(
        db.select({ total: sql<number>`COUNT(*)` }).from(leads)
      ).where(baseLeadCriacao(dataInicioAnt, dataFimAnt)),
      joinCanalLead(
        db.select({
          total: sql<number>`COUNT(*)`,
          // CAST com fallback porque valorEstimado é varchar (texto BR
          // sempre normalizado pra "9999.99" em criarLead/atualizarLead).
          valor: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL(15,2))), 0)`,
        }).from(leads)
      ).where(baseLeadFechado(dataInicio, dataFim, "fechado_ganho")),
      joinCanalLead(
        db.select({
          total: sql<number>`COUNT(*)`,
          valor: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL(15,2))), 0)`,
        }).from(leads)
      ).where(baseLeadFechado(dataInicioAnt, dataFimAnt, "fechado_ganho")),
      joinCanalLead(
        db.select({
          total: sql<number>`COUNT(*)`,
          valor: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL(15,2))), 0)`,
        }).from(leads)
      ).where(baseLeadFechado(dataInicio, dataFim, "fechado_perdido")),
      joinCanalLead(
        db.select({
          total: sql<number>`COUNT(*)`,
        }).from(leads)
      ).where(baseLeadFechado(dataInicioAnt, dataFimAnt, "fechado_perdido")),
      // "Em pipeline" = leads abertos no momento (etapa ≠ fechado_*), criados
      // dentro do range — ou seja, leads recebidos no período que ainda não
      // foram resolvidos. Sem janela = todos pipeline atual do escritório.
      joinCanalLead(
        db.select({
          total: sql<number>`COUNT(*)`,
          valor: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL(15,2))), 0)`,
        }).from(leads)
      ).where(and(
        eq(leads.escritorioId, eid),
        sql`${leads.etapaFunil} NOT IN ('fechado_ganho', 'fechado_perdido')`,
        ...filtroRespLead,
      )),
      // Funil completo: todos leads CRIADOS no período por etapa atual.
      // Mostra a foto: "dos N que entraram, X estão em proposta, Y ganhou, Z perdeu".
      joinCanalLead(
        db.select({
          etapa: leads.etapaFunil,
          total: sql<number>`COUNT(*)`,
          valor: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL(15,2))), 0)`,
        }).from(leads)
      ).where(baseLeadCriacao(dataInicio, dataFim))
        .groupBy(leads.etapaFunil),
      // Motivos de perda dos leads FECHADOS NO PERÍODO.
      joinCanalLead(
        db.select({
          motivo: leads.motivoPerda,
          total: sql<number>`COUNT(*)`,
        }).from(leads)
      ).where(baseLeadFechado(dataInicio, dataFim, "fechado_perdido"))
        .groupBy(leads.motivoPerda)
        .orderBy(sql`COUNT(*) DESC`),
      // Ciclo médio = dias entre createdAt e fechadoEm dos ganhos do período.
      joinCanalLead(
        db.select({
          diasMedio: sql<number>`AVG(DATEDIFF(${leads.fechadoEm}, ${leads.createdAt}))`,
        }).from(leads)
      ).where(baseLeadFechado(dataInicio, dataFim, "fechado_ganho")),
    ]);

    const leadsRecebidos = Number(leadsRecebidosRow[0]?.total || 0);
    const leadsRecebidosAnt = Number(leadsRecebidosAntRow[0]?.total || 0);
    const leadsGanhos = Number(leadsGanhosRow[0]?.total || 0);
    const valorGanho = Number(leadsGanhosRow[0]?.valor || 0);
    const leadsGanhosAnt = Number(leadsGanhosAntRow[0]?.total || 0);
    const valorGanhoAnt = Number(leadsGanhosAntRow[0]?.valor || 0);
    const leadsPerdidos = Number(leadsPerdidosRow[0]?.total || 0);
    const valorPerdido = Number(leadsPerdidosRow[0]?.valor || 0);
    const leadsPerdidosAnt = Number(leadsPerdidosAntRow[0]?.total || 0);
    const leadsEmPipeline = Number(leadsEmPipelineRow[0]?.total || 0);
    const valorEmPipeline = Number(leadsEmPipelineRow[0]?.valor || 0);

    // ─── Tempo médio de primeira resposta ───────────────────────────────
    // Média do delta entre createdAt da conversa e primeira mensagem de SAÍDA.
    // Conversas que ninguém respondeu ainda são EXCLUÍDAS do cálculo (não
    // distorce a média com NULL/uma resposta hipotética).
    const tempoPriRespRow = await db.execute(sql`
      SELECT AVG(TIMESTAMPDIFF(SECOND, c.createdAtConv, m.primeiraSaida)) AS segMedio
      FROM ${conversas} c
      INNER JOIN (
        SELECT conversaIdMsg, MIN(createdAtMsg) AS primeiraSaida
        FROM ${mensagens}
        WHERE direcaoMsg = 'saida'
        GROUP BY conversaIdMsg
      ) m ON m.conversaIdMsg = c.id
      WHERE c.escritorioIdConv = ${eid}
        AND c.createdAtConv >= ${dataInicio}
        AND c.createdAtConv <= ${dataFim}
        ${input?.canalId ? sql`AND c.canalIdConv = ${input.canalId}` : sql``}
    `);
    const segMedioPriResp = Number((tempoPriRespRow as any)[0]?.[0]?.segMedio ?? (tempoPriRespRow as any).rows?.[0]?.segMedio ?? 0);

    // ─── Por canal: agrupa conversas no período ─────────────────────────
    const porCanalRows = await db
      .select({
        canalId: conversas.canalId,
        canalNome: canaisIntegrados.nome,
        canalTelefone: canaisIntegrados.telefone,
        canalTipo: canaisIntegrados.tipo,
        total: sql<number>`COUNT(*)`,
      })
      .from(conversas)
      .leftJoin(canaisIntegrados, eq(conversas.canalId, canaisIntegrados.id))
      .where(baseConv)
      .groupBy(conversas.canalId, canaisIntegrados.nome, canaisIntegrados.telefone, canaisIntegrados.tipo)
      .orderBy(sql`COUNT(*) DESC`);

    // ─── Ranking + tabela detalhada por atendente ───────────────────────
    // Combina 2 fontes: leads (responsavelId) pra valor/ganhos/perdidos +
    // conversas (atendenteId) pra atendimentos. Atendente pode ter um sem
    // ter o outro. Resolvemos via UNION + agregação no app.
    const filtroColabIdsArr = colaboradorIds && colaboradorIds.length > 0 ? colaboradorIds : null;
    const [leadsPorResp, atendPorAtend] = await Promise.all([
      joinCanalLead(
        db.select({
          colabId: leads.responsavelId,
          etapa: leads.etapaFunil,
          valor: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL(15,2))), 0)`,
          total: sql<number>`COUNT(*)`,
        }).from(leads)
      ).where(and(
        eq(leads.escritorioId, eid),
        // Para o ranking, considera leads criados OU fechados no período
        // pra cobrir "leads que entraram" e "leads que saíram".
        or(
          and(gte(leads.createdAt, dataInicio), lte(leads.createdAt, dataFim)),
          and(sql`${leads.fechadoEm} IS NOT NULL`, gte(leads.fechadoEm, dataInicio), lte(leads.fechadoEm, dataFim)),
        ),
        filtroColabIdsArr ? inArray(leads.responsavelId, filtroColabIdsArr) : sql`1=1`,
      ))
        .groupBy(leads.responsavelId, leads.etapaFunil),
      db.select({
        colabId: conversas.atendenteId,
        atendimentos: sql<number>`COUNT(*)`,
      })
        .from(conversas)
        .where(baseConv)
        .groupBy(conversas.atendenteId),
    ]);

    // Lista master de colaboradores (nome + email) pra hidratar a tabela.
    const todosColabRows = await db
      .select({ id: colaboradores.id, nome: users.name, email: users.email })
      .from(colaboradores)
      .innerJoin(users, eq(colaboradores.userId, users.id))
      .where(eq(colaboradores.escritorioId, eid));
    const nomePorColab = new Map<number, { nome: string; email: string }>();
    for (const c of todosColabRows) nomePorColab.set(c.id, { nome: c.nome || c.email || `#${c.id}`, email: c.email || "" });

    const porAtendente = new Map<number, {
      colabId: number;
      nome: string;
      atendimentos: number;
      leadsTotal: number;
      ganhos: number;
      perdidos: number;
      emAberto: number;
      valorFechado: number;
    }>();
    const garantir = (id: number) => {
      if (!porAtendente.has(id)) {
        porAtendente.set(id, {
          colabId: id, nome: nomePorColab.get(id)?.nome || `#${id}`,
          atendimentos: 0, leadsTotal: 0, ganhos: 0, perdidos: 0, emAberto: 0, valorFechado: 0,
        });
      }
      return porAtendente.get(id)!;
    };
    for (const r of leadsPorResp) {
      if (!r.colabId) continue;
      const x = garantir(r.colabId);
      const t = Number(r.total);
      const v = Number(r.valor || 0);
      x.leadsTotal += t;
      if (r.etapa === "fechado_ganho") { x.ganhos += t; x.valorFechado += v; }
      else if (r.etapa === "fechado_perdido") { x.perdidos += t; }
      else { x.emAberto += t; }
    }
    for (const r of atendPorAtend) {
      if (!r.colabId) continue;
      const x = garantir(r.colabId);
      x.atendimentos += Number(r.atendimentos);
    }
    const tabelaAtendentes = [...porAtendente.values()]
      .map((a) => ({
        ...a,
        taxaConversao: a.ganhos + a.perdidos > 0
          ? Math.round((a.ganhos / (a.ganhos + a.perdidos)) * 100)
          : null,
      }))
      // Recomendação aprovada: ordena por valor fechado decrescente.
      .sort((a, b) => b.valorFechado - a.valorFechado);

    // ─── Volume diário (leads recebidos × ganhos × perdidos) ────────────
    const [recebidosPorDia, ganhosPorDia, perdidosPorDia] = await Promise.all([
      joinCanalLead(
        db.select({ dia: sql<string>`DATE(${leads.createdAt})`, total: sql<number>`COUNT(*)` }).from(leads)
      ).where(baseLeadCriacao(dataInicio, dataFim))
        .groupBy(sql`DATE(${leads.createdAt})`).orderBy(sql`DATE(${leads.createdAt})`),
      joinCanalLead(
        db.select({ dia: sql<string>`DATE(${leads.fechadoEm})`, total: sql<number>`COUNT(*)` }).from(leads)
      ).where(baseLeadFechado(dataInicio, dataFim, "fechado_ganho"))
        .groupBy(sql`DATE(${leads.fechadoEm})`).orderBy(sql`DATE(${leads.fechadoEm})`),
      joinCanalLead(
        db.select({ dia: sql<string>`DATE(${leads.fechadoEm})`, total: sql<number>`COUNT(*)` }).from(leads)
      ).where(baseLeadFechado(dataInicio, dataFim, "fechado_perdido"))
        .groupBy(sql`DATE(${leads.fechadoEm})`).orderBy(sql`DATE(${leads.fechadoEm})`),
    ]);

    // ─── Funil: hidrata todas as etapas mesmo zeradas pra UI ────────────
    const ETAPAS_ORDEM: Array<"novo" | "qualificado" | "proposta" | "negociacao" | "fechado_ganho" | "fechado_perdido"> = [
      "novo", "qualificado", "proposta", "negociacao", "fechado_ganho", "fechado_perdido",
    ];
    const funilMap = new Map<string, { total: number; valor: number }>();
    for (const r of funilRows) funilMap.set(r.etapa as string, { total: Number(r.total), valor: Number(r.valor || 0) });
    const funil = ETAPAS_ORDEM.map((etapa) => ({
      etapa,
      total: funilMap.get(etapa)?.total || 0,
      valor: funilMap.get(etapa)?.valor || 0,
    }));

    // ─── Derivados ──────────────────────────────────────────────────────
    const taxaConversao = leadsGanhos + leadsPerdidos > 0
      ? Math.round((leadsGanhos / (leadsGanhos + leadsPerdidos)) * 100)
      : null;
    const ticketMedio = leadsGanhos > 0 ? valorGanho / leadsGanhos : null;
    const cicloMedioDias = Number((cicloRows as any[])[0]?.diasMedio || 0);
    // Conversa → Lead: das conversas iniciadas, quantas geraram lead.
    const convsComLeadRow = await db.execute(sql`
      SELECT COUNT(DISTINCT c.id) AS total
      FROM ${conversas} c
      INNER JOIN ${leads} l ON l.conversaIdLead = c.id
      WHERE c.escritorioIdConv = ${eid}
        AND c.createdAtConv >= ${dataInicio}
        AND c.createdAtConv <= ${dataFim}
        ${input?.canalId ? sql`AND c.canalIdConv = ${input.canalId}` : sql``}
    `);
    const convsComLead = Number((convsComLeadRow as any)[0]?.[0]?.total ?? (convsComLeadRow as any).rows?.[0]?.total ?? 0);
    const conversaParaLead = totalConversas > 0 ? Math.round((convsComLead / totalConversas) * 100) : null;

    return {
      periodo: {
        dataInicio: dataInicio.toISOString().slice(0, 10),
        dataFim: dataFim.toISOString().slice(0, 10),
      },
      filtros: {
        setorId: input?.setorId ?? null,
        atendenteId: input?.atendenteId ?? null,
        canalId: input?.canalId ?? null,
      },
      // KPIs Funil
      leadsRecebidos,
      leadsRecebidosAnt,
      leadsEmPipeline,
      valorEmPipeline,
      leadsGanhos,
      valorGanho,
      leadsGanhosAnt,
      valorGanhoAnt,
      leadsPerdidos,
      valorPerdido,
      leadsPerdidosAnt,
      // KPIs Operação (mantém compat com nomes antigos)
      conversasPorStatus,
      totalConversas,
      mensagensEnviadas: msgsDirecao["saida"] || 0,
      mensagensRecebidas: msgsDirecao["entrada"] || 0,
      totalMensagens: (msgsDirecao["saida"] || 0) + (msgsDirecao["entrada"] || 0),
      segMedioPriResp,
      // KPIs Desempenho
      taxaConversao,
      ticketMedio,
      conversaParaLead,
      cicloMedioDias,
      // Visualizações
      funil,
      porCanal: porCanalRows.map((r) => ({
        canalId: r.canalId,
        nome: r.canalNome || (r.canalTipo as string) || "Sem canal",
        telefone: r.canalTelefone,
        tipo: r.canalTipo,
        total: Number(r.total),
      })),
      tabelaAtendentes,
      motivosPerda: (motivosRows as Array<{ motivo: string | null; total: number }>)
        .filter((r) => r.motivo)
        .map((r) => ({ motivo: r.motivo as string, total: Number(r.total) })),
      // Volume diário — fusiona as 3 séries por dia pra UI plotar fácil.
      volumeDiario: (() => {
        const map = new Map<string, { dia: string; recebidos: number; ganhos: number; perdidos: number }>();
        const garantirDia = (d: string) => {
          if (!map.has(d)) map.set(d, { dia: d, recebidos: 0, ganhos: 0, perdidos: 0 });
          return map.get(d)!;
        };
        for (const r of recebidosPorDia) garantirDia(String(r.dia)).recebidos = Number(r.total);
        for (const r of ganhosPorDia) garantirDia(String(r.dia)).ganhos = Number(r.total);
        for (const r of perdidosPorDia) garantirDia(String(r.dia)).perdidos = Number(r.total);
        return [...map.values()].sort((a, b) => a.dia.localeCompare(b.dia));
      })(),
      // Mantém retrocompatibilidade pra UI antiga não quebrar enquanto migra.
      conversasPorDia: convsPorDia.map((r: any) => ({ dia: String(r.dia), total: Number(r.total) })),
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

    // ── Período: range custom sobrepõe preset de dias (no fuso do escritório) ─
    const tz = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
    const dias = input?.dias || 30;
    let dataInicio: Date;
    let dataFim: Date;
    if (input?.dataInicio && input?.dataFim) {
      const p = resolverPeriodoNoFuso(new Date(), tz, input);
      dataInicio = p.dataInicio;
      dataFim = p.dataFim;
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
    // dropdown comprometido). E mesmo verTodos: valida que o
    // responsavelId pertence ao escritório (evita enumeração silenciosa).
    let responsavelValidado: number | null = null;
    if (!soProprios && input?.responsavelId) {
      const [c] = await db
        .select({ id: colaboradores.id })
        .from(colaboradores)
        .where(and(
          eq(colaboradores.escritorioId, eid),
          eq(colaboradores.id, input.responsavelId),
        ))
        .limit(1);
      responsavelValidado = c ? input.responsavelId : null;
    }
    const filtroAtendente = soProprios ? colabId : responsavelValidado;

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
    //
    // Quando filtra por atendente: mostra origem dos contatos cujos LEADS
    // no período pertencem ao atendente — alinha com os KPIs "Total leads"
    // e "Contratos fechados" que filtram por leads.responsavelId. Filtrar
    // por contatos.responsavelId aqui dava resultado dessincronizado
    // (contato podia estar com outro dono mesmo com lead trabalhado pelo
    // atendente filtrado).
    const filtroOrigemPorLead = filtroAtendente
      ? [
          inArray(
            contatos.id,
            db
              .select({ id: leads.contatoId })
              .from(leads)
              .where(and(
                eq(leads.escritorioId, eid),
                eq(leads.responsavelId, filtroAtendente),
                ...rangeLead,
              )),
          ),
        ]
      : [];
    const origemRows = await db
      .select({ origem: contatos.origem, total: sql<number>`COUNT(*)` })
      .from(contatos)
      .where(
        and(
          eq(contatos.escritorioId, eid),
          inArray(contatos.origem, [...ORIGENS_LEAD]),
          ...rangeContato,
          ...filtroOrigemPorLead,
        ),
      )
      .groupBy(contatos.origem);

    // ── Fechamentos por origem (texto livre vindo do catálogo do escritório)
    // Diferente de "Contatos por origem" (enum de canal de captação),
    // aqui agregamos leads.origemLead — texto preenchido no cadastro do
    // fechamento (ex: "Google revisional", "Meta leilão", "BNI", "Indicação").
    // Filtra apenas leads que viraram contrato (etapaFunil=fechado_ganho).
    const fechamentosOrigemRows = await db
      .select({
        origem: leads.origemLead,
        total: sql<number>`COUNT(*)`,
      })
      .from(leads)
      .where(
        and(
          eq(leads.escritorioId, eid),
          eq(leads.etapaFunil, "fechado_ganho"),
          ...rangeLead,
          ...filtroLeadResp,
          sql`${leads.origemLead} IS NOT NULL AND ${leads.origemLead} != ''`,
        ),
      )
      .groupBy(leads.origemLead);

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
      fechamentosPorOrigem: fechamentosOrigemRows.map((r) => ({
        origem: (r.origem || "Sem origem") as string,
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

      // ── Range: dataInicio/dataFim sobrepõe; default = mês vigente (no fuso) ─
      const tz = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
      const { dataInicio, dataFim, dataInicioStr, dataFimStr } =
        resolverPeriodoNoFuso(new Date(), tz, input);

      // Período anterior: quando o range cai inteiro num único mês civil,
      // compara com os MESMOS DIAS no mês anterior (ex.: 1-13 mai vs 1-13
      // abr) — padrão MTD vs LMTD que gestor espera. Pra ranges cross-mês,
      // mantém o fallback "mesmos N dias antes" (sliding window).
      // A aritmética de mês é feita sobre as STRINGS civis (subtrairUmMesISO),
      // não sobre Date UTC — senão o "fim do dia no fuso" (que cai no dia
      // seguinte em UTC à noite) deslocaria o mês anterior em 1 dia.
      const mesmoMesCivil = dataInicioStr.slice(0, 7) === dataFimStr.slice(0, 7);
      let dataInicioAnterior: Date;
      let dataFimAnterior: Date;
      let dataInicioAnteriorStr: string;
      let dataFimAnteriorStr: string;
      if (mesmoMesCivil) {
        dataInicioAnteriorStr = subtrairUmMesISO(dataInicioStr);
        dataFimAnteriorStr = subtrairUmMesISO(dataFimStr);
        dataInicioAnterior = inicioDoDiaNoFuso(dataInicioAnteriorStr, tz);
        dataFimAnterior = fimDoDiaNoFuso(dataFimAnteriorStr, tz);
      } else {
        const duracaoMs = dataFim.getTime() - dataInicio.getTime();
        dataFimAnterior = new Date(dataInicio.getTime() - 1);
        dataInicioAnterior = new Date(dataFimAnterior.getTime() - duracaoMs);
        dataInicioAnteriorStr = dataHojeBR(tz, dataInicioAnterior);
        dataFimAnteriorStr = dataHojeBR(tz, dataFimAnterior);
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
            dataInicio: dataInicioStr,
            dataFim: dataFimStr,
          },
          periodoAnterior: {
            dataInicio: dataInicioAnteriorStr,
            dataFim: dataFimAnteriorStr,
          },
          kpis: {
            faturado: 0,
            faturadoPeriodoAnterior: 0,
            variacaoFaturado: 0,
            contratos: 0,
            contratosPeriodoAnterior: 0,
            variacaoContratos: 0,
            contratosFechados: 0,
            contratosFechadosPeriodoAnterior: 0,
            variacaoContratosFechados: 0,
            valorTotalFechado: 0,
            ticketMedio: 0,
            comissao: 0,
          },
          ranking: [],
          cobrancasPorDia: [],
          etapas: {} as Record<string, { total: number; valor: number }>,
          contatosPorOrigem: [] as Array<{ origem: string; total: number }>,
          fechamentosPorOrigem: [] as Array<{ origem: string; total: number }>,
          filtros: {
            setorId: input?.setorId ?? null,
            atendenteId: input?.atendenteId ?? null,
          },
        };
      }

      // ── KPIs período atual ────────────────────────────────────────────────
      // (dataInicioStr/dataFimStr e os *AnteriorStr já resolvidos no fuso acima)

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
          inArray(asaasCobrancas.status, STATUS_PAGO_ASAAS as unknown as string[]),
          gte(asaasCobrancas.dataPagamento, dataInicioStr),
          lte(asaasCobrancas.dataPagamento, dataFimStr),
          buildFiltroComissaoSQL(["sim"])!,
          // "Cliente real" = COALESCE(beneficiário, pagador). Resolve o
          // caso clássico Carlos+esposa: cobrança paga por Maria (contatoId)
          // tem contatoBeneficiarioId=Carlos. Carlos é quem fechou o lead;
          // sem COALESCE a cobrança ficava de fora do recebido do atendente.
          sql`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}) IN (${contatosFechadosAtual})`,
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
          inArray(asaasCobrancas.status, STATUS_PAGO_ASAAS as unknown as string[]),
          gte(asaasCobrancas.dataPagamento, dataInicioAnteriorStr),
          lte(asaasCobrancas.dataPagamento, dataFimAnteriorStr),
          buildFiltroComissaoSQL(["sim"])!,
          sql`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}) IN (${contatosFechadosAnt})`,
        ));
      const faturadoAnterior = Number(aggAnt?.totalFaturado || 0);
      const contratosAnterior = Number(aggAnt?.contratos || 0);
      const variacaoFaturado = faturadoAnterior > 0
        ? +(((totalFaturado - faturadoAnterior) / faturadoAnterior) * 100).toFixed(1)
        : totalFaturado > 0 ? 100 : 0;
      const variacaoContratos = contratosAnterior > 0
        ? +(((contratos - contratosAnterior) / contratosAnterior) * 100).toFixed(1)
        : contratos > 0 ? 100 : 0;

      // ── Contratos fechados (leads.fechado_ganho) — atual e anterior ───────
      // Reusa o mesmo filtro do ranking (idsAtendentes + createdAt range).
      // O total do período atual também é refletido em `etapas.fechado_ganho.total`,
      // mas mantemos no kpis pra alinhar com faturado/contratos (variação + payload anterior).
      const [contratosFechadosAtualAgg] = await db
        .select({ total: sql<number>`COUNT(*)`, valor: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL(14,2))), 0)` })
        .from(leads)
        .where(and(
          eq(leads.escritorioId, eid),
          eq(leads.etapaFunil, "fechado_ganho"),
          inArray(leads.responsavelId, idsAtendentes),
          gte(leads.createdAt, dataInicio),
          lte(leads.createdAt, dataFim),
        ));
      const [contratosFechadosAntAgg] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(leads)
        .where(and(
          eq(leads.escritorioId, eid),
          eq(leads.etapaFunil, "fechado_ganho"),
          inArray(leads.responsavelId, idsAtendentes),
          gte(leads.createdAt, dataInicioAnterior),
          lte(leads.createdAt, dataFimAnterior),
        ));
      const contratosFechados = Number(contratosFechadosAtualAgg?.total || 0);
      const valorTotalFechado = Number(contratosFechadosAtualAgg?.valor || 0);
      const contratosFechadosPeriodoAnterior = Number(contratosFechadosAntAgg?.total || 0);
      const variacaoContratosFechados = contratosFechadosPeriodoAnterior > 0
        ? +(((contratosFechados - contratosFechadosPeriodoAnterior) / contratosFechadosPeriodoAnterior) * 100).toFixed(1)
        : contratosFechados > 0 ? 100 : 0;

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
          inArray(asaasCobrancas.status, STATUS_PAGO_ASAAS as unknown as string[]),
          gte(asaasCobrancas.dataPagamento, dataInicioStr),
          lte(asaasCobrancas.dataPagamento, dataFimStr),
          buildFiltroComissaoSQL(["sim"])!,
          sql`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}) IN (${contatosFechadosAtual})`,
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
          // Proporcionalizar meta ao range: ranges não-mensais (1-7 mai)
          // davam % falsamente baixa se comparassem com meta mensal cheia.
          const metaPeriodo = meta != null && meta > 0
            ? +metaProporcionalPeriodo(meta, dataInicio, dataFim).toFixed(2)
            : null;
          const progressoMeta = metaPeriodo && metaPeriodo > 0
            ? +((pagos.faturado / metaPeriodo) * 100).toFixed(1)
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
            metaPeriodo,
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
          inArray(asaasCobrancas.status, STATUS_PAGO_ASAAS as unknown as string[]),
          gte(asaasCobrancas.dataPagamento, dataInicioStr),
          lte(asaasCobrancas.dataPagamento, dataFimStr),
          buildFiltroComissaoSQL(["sim"])!,
          sql`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}) IN (${contatosFechadosAtual})`,
        ))
        .groupBy(sql`DATE(${asaasCobrancas.dataPagamento})`)
        .orderBy(sql`DATE(${asaasCobrancas.dataPagamento})`);

      // ── Funil de Vendas ───────────────────────────────────────────────────
      // Mesmo filtro do ranking (idsAtendentes + createdAt range) pra evitar
      // divergência: a soma de "contratosFechados" do ranking precisa bater
      // com o total da etapa "Ganho" do funil.
      const etapaRows = await db
        .select({
          etapa: leads.etapaFunil,
          total: sql<number>`COUNT(*)`,
          valor: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL(14,2))), 0)`,
        })
        .from(leads)
        .where(and(
          eq(leads.escritorioId, eid),
          inArray(leads.responsavelId, idsAtendentes),
          gte(leads.createdAt, dataInicio),
          lte(leads.createdAt, dataFim),
        ))
        .groupBy(leads.etapaFunil);

      const etapas: Record<string, { total: number; valor: number }> = {};
      for (const r of etapaRows) {
        etapas[r.etapa as string] = {
          total: Number(r.total),
          valor: Number(r.valor),
        };
      }

      // ── Contatos por canal de captação ────────────────────────────────────
      // Whitelist de origens "ativas". Filtra contatos cujo lead no período
      // pertence a um dos idsAtendentes (mesmo critério do ranking).
      const contatosOrigemRows = await db
        .select({
          origem: contatos.origem,
          total: sql<number>`COUNT(*)`,
        })
        .from(contatos)
        .where(and(
          eq(contatos.escritorioId, eid),
          inArray(contatos.origem, [...ORIGENS_LEAD]),
          gte(contatos.createdAt, dataInicio),
          lte(contatos.createdAt, dataFim),
          inArray(
            contatos.id,
            db.select({ id: leads.contatoId })
              .from(leads)
              .where(and(
                eq(leads.escritorioId, eid),
                inArray(leads.responsavelId, idsAtendentes),
                gte(leads.createdAt, dataInicio),
                lte(leads.createdAt, dataFim),
              )),
          ),
        ))
        .groupBy(contatos.origem);

      // ── Fechamentos por origem (texto livre do catálogo do escritório) ────
      const fechamentosOrigemRows = await db
        .select({
          origem: leads.origemLead,
          total: sql<number>`COUNT(*)`,
        })
        .from(leads)
        .where(and(
          eq(leads.escritorioId, eid),
          eq(leads.etapaFunil, "fechado_ganho"),
          inArray(leads.responsavelId, idsAtendentes),
          gte(leads.createdAt, dataInicio),
          lte(leads.createdAt, dataFim),
          sql`${leads.origemLead} IS NOT NULL AND ${leads.origemLead} != ''`,
        ))
        .groupBy(leads.origemLead);

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
          contratosFechados,
          contratosFechadosPeriodoAnterior,
          variacaoContratosFechados,
          valorTotalFechado,
          ticketMedio,
          comissao: comissaoTotal,
        },
        ranking,
        cobrancasPorDia: porDiaRows.map((r) => ({
          dia: String(r.dia),
          faturado: Number(r.faturado || 0),
          contratos: Number(r.contratos || 0),
        })),
        etapas,
        contatosPorOrigem: contatosOrigemRows.map((r) => ({
          origem: r.origem as string,
          total: Number(r.total),
        })),
        fechamentosPorOrigem: fechamentosOrigemRows.map((r) => ({
          origem: (r.origem || "Sem origem") as string,
          total: Number(r.total),
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
   *   - `valorRecebido`: soma cobranças pagas comissionáveis
   *   - `contratosPagos`: count DISTINCT(COALESCE(parcelamentoLocalId, id))
   *
   * IMPORTANTE: o cálculo de `valorRecebido` aplica EXATAMENTE os mesmos
   * filtros do ranking comercial (`comercialDashboard`):
   *   1) Só cobranças comissionáveis (`buildFiltroComissaoSQL(["sim"])`).
   *   2) Só cobranças cujo CLIENTE REAL tem lead fechado_ganho no MESMO
   *      período (subquery `contatosFechadosAtual`). "Cliente real" usa
   *      COALESCE(beneficiário, pagador) — caso esposa paga marido.
   *
   * Sem esses filtros, a soma do drawer (ex: R$ 6.000) divergia do card
   * do ranking (ex: R$ 3.500) — gestor via números conflitantes pra mesma
   * atendente. Cobrança não-comissionável (custas, ressarcimento) ou
   * cliente antigo que pagou agora fica fora da meta comercial corrente.
   *
   * Combina por contatoId (cliente pode ter fechado sem pagar, ou pago
   * sem lead próprio — quando lead é de outro atendente do setor mas
   * pagamento veio pra ele). Ordenado por valor fechado desc.
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

      // atendenteId precisa pertencer ao mesmo escritório do caller — sem isso,
      // verTodos podia consultar IDs de outros escritórios (queries filtram por
      // eid e dariam vazio, mas ainda é vetor de enumeração silenciosa).
      const [atendente] = await db
        .select({ id: colaboradores.id })
        .from(colaboradores)
        .where(and(
          eq(colaboradores.escritorioId, eid),
          eq(colaboradores.id, input.atendenteId),
        ))
        .limit(1);
      if (!atendente) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Atendente não encontrado." });
      }

      // Range: default = mês vigente (no fuso do escritório)
      const tz = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
      const { dataInicio, dataFim, dataInicioStr, dataFimStr } = resolverPeriodoNoFuso(
        new Date(),
        tz,
        { dataInicio: input.dataInicio, dataFim: input.dataFim },
      );

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

      // ── Subquery: contatos com lead fechado_ganho no período ───────────────
      // Mesma definição do `comercialDashboard` — independe de QUAL atendente
      // fechou o lead (basta o cliente ter um fechamento no período).
      const contatosFechadosAtual = db
        .select({ id: leads.contatoId })
        .from(leads)
        .where(and(
          eq(leads.escritorioId, eid),
          eq(leads.etapaFunil, "fechado_ganho"),
          gte(leads.createdAt, dataInicio),
          lte(leads.createdAt, dataFim),
        ));

      // ── Cobranças pagas COMISSIONÁVEIS de clientes fechados no período ─────
      // Cliente real = COALESCE(beneficiário, pagador). Resolve "esposa
      // pagou pelo marido": cobrança paga por Maria com beneficiário
      // Carlos agrupa em Carlos. Sem isso, Maria apareceria como cliente
      // separada no drawer, confundindo gestão.
      //
      // Filtros idênticos ao `comercialDashboard.porAtendenteRows` —
      // garante que a soma do drawer bate com o card "Recebido" do ranking.
      const cobrancasRows = await db
        .select({
          contatoId: sql<number>`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId})`,
          valorRecebido: sql<number>`COALESCE(SUM(CAST(${asaasCobrancas.valor} AS DECIMAL(14,2))), 0)`,
          contratosPagos: sql<number>`COUNT(DISTINCT COALESCE(${asaasCobrancas.parcelamentoLocalId}, CAST(${asaasCobrancas.id} AS CHAR)))`,
        })
        .from(asaasCobrancas)
        .leftJoin(categoriasCobranca, eq(categoriasCobranca.id, asaasCobrancas.categoriaId))
        .where(and(
          eq(asaasCobrancas.escritorioId, eid),
          eq(asaasCobrancas.atendenteId, input.atendenteId),
          inArray(asaasCobrancas.status, STATUS_PAGO_ASAAS as unknown as string[]),
          gte(asaasCobrancas.dataPagamento, dataInicioStr),
          lte(asaasCobrancas.dataPagamento, dataFimStr),
          buildFiltroComissaoSQL(["sim"])!,
          sql`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}) IN (${contatosFechadosAtual})`,
        ))
        .groupBy(sql`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId})`);

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
    const [cardsAtrasados] = await cardsBase(
      and(eq(kanbanCards.atrasado, true), gte(kanbanCards.createdAt, desde)),
    );
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

  /** Cálculos — histórico de cálculos do usuário.
   *  Gateado por permissão `calculos` (não `relatorios`) pra que atendente
   *  consiga ver o próprio histórico mesmo sem perm de relatórios. Filtra
   *  por `userId`, isolamento natural. */
  calculos: protectedProcedure.input(PeriodoInput).query(async ({ ctx, input }) => {
    const perm = await checkPermission(ctx.user.id, "calculos", "ver");
    if (!perm.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem permissão para ver histórico de cálculos.",
      });
    }
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

/**
 * Caller do próprio router — definido DEPOIS de `relatoriosRouter` pra não
 * criar referência circular (se `exportarComercialPdf` vivesse dentro do
 * router, referenciá-lo no próprio inicializador seria erro de tipo).
 */
const chamarRelatorios = createCallerFactory(relatoriosRouter);

/**
 * Export do dashboard Comercial em PDF. Mesclado no namespace `relatorios`
 * em `server/routers.ts`. Reusa `comercialDashboard` + `detalheAtendenteComercial`
 * via caller — os mesmos filtros/permissão da tela, então os números do PDF
 * batem exatamente com os da UI (sem duplicar a lógica de SQL).
 */
export const relatoriosPdfRouter = router({
  exportarComercialPdf: protectedProcedure
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
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado." });
      }
      const caller = chamarRelatorios(ctx);

      // comercialDashboard já aplica permissão de relatórios + resolve período.
      const data = await caller.comercialDashboard(input);
      if (!data) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sem dados para o período." });
      }

      // Drill-down por atendente do ranking (todos). verProprios já restringe
      // o ranking ao próprio colaborador, então o loop respeita a permissão.
      const detalhes: DetalheAtendentePdf[] = [];
      for (const r of data.ranking) {
        const det = await caller.detalheAtendenteComercial({
          atendenteId: r.atendenteId,
          dataInicio: data.periodo.dataInicio,
          dataFim: data.periodo.dataFim,
        });
        if (det && det.itens.length > 0) {
          detalhes.push({
            atendenteId: r.atendenteId,
            nome: r.nome,
            setorNome: r.setorNome,
            totalFechado: det.totalFechado,
            totalRecebido: det.totalRecebido,
            itens: det.itens,
          });
        }
      }

      const buffer = await gerarComercialPdf({
        data,
        detalhes,
        nomeEscritorio: esc.escritorio.nome,
      });

      return {
        filename: `relatorio_comercial_${data.periodo.dataInicio}_${data.periodo.dataFim}.pdf`,
        base64: buffer.toString("base64"),
        mimeType: "application/pdf",
      };
    }),
});
