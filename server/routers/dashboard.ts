/**
 * Router — Dashboard do usuário
 *
 * Estatísticas de uso, créditos, histórico de cálculos e resumo
 * inteligente do escritório (compromissos, leads, financeiro, processos).
 */

import { eq, and, desc, asc, gte, lte, lt, or } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getDb,
  getEstatisticasUso,
  getCalculosRecentes,
  getUserCreditsInfo,
} from "../db";
import {
  agendamentos,
  tarefas,
  conversas,
  contatos,
  leads,
  asaasCobrancas,
  processosMonitorados,
  movimentacoesProcesso,
  notificacoes,
} from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { createLogger } from "../_core/logger";

const log = createLogger("dashboard-router");

export const dashboardRouter = router({
  /** Estatísticas de uso do utilizador */
  stats: protectedProcedure.query(async ({ ctx }) => {
    return getEstatisticasUso(ctx.user.id);
  }),

  /** Histórico de cálculos recentes */
  historico: protectedProcedure.query(async ({ ctx }) => {
    return getCalculosRecentes(ctx.user.id, 5);
  }),

  /** Informações de créditos */
  credits: protectedProcedure.query(async ({ ctx }) => {
    return getUserCreditsInfo(ctx.user.id);
  }),

  /** Resumo do escritório para dashboard inteligente */
  resumoEscritorio: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;

    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;

    const escritorioId = esc.escritorio.id;
    const now = new Date();
    const hojeInicio = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const hojeFim = new Date(hojeInicio.getTime() + 86400000);

    try {
      // ─── Agenda ─────────────────────────────────────────────
      const compromissosHoje = await db
        .select({
          id: agendamentos.id,
          titulo: agendamentos.titulo,
          dataInicio: agendamentos.dataInicio,
          tipo: agendamentos.tipo,
          corHex: agendamentos.corHex,
        })
        .from(agendamentos)
        .where(
          and(
            eq(agendamentos.escritorioId, escritorioId),
            gte(agendamentos.dataInicio, hojeInicio),
            lte(agendamentos.dataInicio, hojeFim),
            or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento")),
          ),
        )
        .orderBy(asc(agendamentos.dataInicio))
        .limit(5);

      const tarefasHoje = await db
        .select({
          id: tarefas.id,
          titulo: tarefas.titulo,
          dataVencimento: tarefas.dataVencimento,
          prioridade: tarefas.prioridade,
        })
        .from(tarefas)
        .where(
          and(
            eq(tarefas.escritorioId, escritorioId),
            gte(tarefas.dataVencimento, hojeInicio),
            lte(tarefas.dataVencimento, hojeFim),
            or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")),
          ),
        )
        .limit(5);

      const tarefasAtrasadas = await db
        .select({ id: tarefas.id })
        .from(tarefas)
        .where(
          and(
            eq(tarefas.escritorioId, escritorioId),
            lt(tarefas.dataVencimento, hojeInicio),
            or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")),
          ),
        );

      const compromissosAtrasados = await db
        .select({ id: agendamentos.id })
        .from(agendamentos)
        .where(
          and(
            eq(agendamentos.escritorioId, escritorioId),
            lt(agendamentos.dataInicio, hojeInicio),
            or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento")),
          ),
        );

      // ─── CRM / Conversas ────────────────────────────────────
      const conversasAguardando = await db
        .select({ id: conversas.id })
        .from(conversas)
        .where(and(eq(conversas.escritorioId, escritorioId), eq(conversas.status, "aguardando")));

      const conversasAbertas = await db
        .select({ id: conversas.id })
        .from(conversas)
        .where(and(eq(conversas.escritorioId, escritorioId), eq(conversas.status, "em_atendimento")));

      const totalContatos = await db
        .select({ id: contatos.id })
        .from(contatos)
        .where(eq(contatos.escritorioId, escritorioId));

      // ─── Pipeline / Leads ───────────────────────────────────
      const leadsAbertos = await db
        .select({ id: leads.id, valorEstimado: leads.valorEstimado })
        .from(leads)
        .where(
          and(
            eq(leads.escritorioId, escritorioId),
            or(
              eq(leads.etapaFunil, "novo"),
              eq(leads.etapaFunil, "qualificado"),
              eq(leads.etapaFunil, "proposta"),
              eq(leads.etapaFunil, "negociacao"),
            ),
          ),
        );

      let valorPipeline = 0;
      for (const l of leadsAbertos) {
        valorPipeline += parseFloat((l.valorEstimado as string | null) || "0") || 0;
      }

      // ─── Financeiro ─────────────────────────────────────────
      let finRecebido = 0;
      let finPendente = 0;
      let finVencido = 0;
      let finTotal = 0;
      try {
        const cobrancasLocal = await db
          .select()
          .from(asaasCobrancas)
          .where(eq(asaasCobrancas.escritorioId, escritorioId));
        finTotal = cobrancasLocal.length;
        for (const c of cobrancasLocal) {
          const val = parseFloat(c.valor) || 0;
          if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status)) finRecebido += val;
          else if (c.status === "PENDING") finPendente += val;
          else if (c.status === "OVERDUE") finVencido += val;
        }
      } catch {
        /* ignore — sem integração asaas */
      }

      // ─── Processos ──────────────────────────────────────────
      const processosAtivos = await db
        .select({ id: processosMonitorados.id })
        .from(processosMonitorados)
        .where(
          and(eq(processosMonitorados.userId, ctx.user.id), eq(processosMonitorados.status, "ativo")),
        );

      const totalProcessos = processosAtivos.length;
      const processosIds = processosAtivos.map((p) => p.id);

      // Movimentações não lidas
      let movimentacoesNaoLidas = 0;
      const movimentacoesRecentes: Array<{
        id: number;
        nome: string;
        numeroCnj: string;
        dataHora: string;
      }> = [];

      if (processosIds.length > 0) {
        for (const pid of processosIds.slice(0, 50)) {
          const naoLidas = await db
            .select({ id: movimentacoesProcesso.id })
            .from(movimentacoesProcesso)
            .where(and(eq(movimentacoesProcesso.processoId, pid), eq(movimentacoesProcesso.lida, false)));
          movimentacoesNaoLidas += naoLidas.length;
        }

        // Últimas 5 movimentações
        for (const pid of processosIds.slice(0, 20)) {
          const movs = await db
            .select({
              id: movimentacoesProcesso.id,
              nome: movimentacoesProcesso.nome,
              dataHora: movimentacoesProcesso.dataHora,
              processoId: movimentacoesProcesso.processoId,
            })
            .from(movimentacoesProcesso)
            .where(eq(movimentacoesProcesso.processoId, pid))
            .orderBy(desc(movimentacoesProcesso.dataHora))
            .limit(2);
          for (const m of movs) {
            const [proc] = await db
              .select({ numeroCnj: processosMonitorados.numeroCnj })
              .from(processosMonitorados)
              .where(eq(processosMonitorados.id, m.processoId))
              .limit(1);
            movimentacoesRecentes.push({
              id: m.id,
              nome: m.nome,
              numeroCnj: proc?.numeroCnj || "",
              dataHora: m.dataHora,
            });
          }
        }
        movimentacoesRecentes.sort((a, b) => (b.dataHora || "").localeCompare(a.dataHora || ""));
      }

      // Notificações não lidas
      const notifsNaoLidas = await db
        .select({ id: notificacoes.id })
        .from(notificacoes)
        .where(and(eq(notificacoes.userId, ctx.user.id), eq(notificacoes.lida, false)));

      return {
        agenda: {
          compromissosHoje: compromissosHoje.map((c) => ({
            id: c.id,
            titulo: c.titulo,
            hora: (c.dataInicio as Date).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            tipo: c.tipo,
            cor: c.corHex,
          })),
          tarefasHoje: tarefasHoje.map((t) => ({ id: t.id, titulo: t.titulo, prioridade: t.prioridade })),
          atrasados: tarefasAtrasadas.length + compromissosAtrasados.length,
        },
        crm: {
          conversasAguardando: conversasAguardando.length,
          conversasAbertas: conversasAbertas.length,
          totalContatos: totalContatos.length,
        },
        pipeline: {
          leadsAbertos: leadsAbertos.length,
          valorPipeline,
        },
        financeiro: {
          recebido: finRecebido,
          pendente: finPendente,
          vencido: finVencido,
          totalCobrancas: finTotal,
        },
        processos: {
          ativos: totalProcessos,
          movimentacoesNaoLidas,
          movimentacoesRecentes: movimentacoesRecentes.slice(0, 5),
        },
        notificacoesNaoLidas: notifsNaoLidas.length,
      };
    } catch (err) {
      log.error({ err: String(err) }, "Erro ao montar resumo do escritório");
      return null;
    }
  }),
});
