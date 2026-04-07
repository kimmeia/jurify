/**
 * Router — Dashboard do usuário
 *
 * Estatísticas de uso, créditos, histórico de cálculos e resumo
 * inteligente do escritório (compromissos, leads, financeiro, processos).
 */

import { eq, and, desc, asc, gte, lte, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
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
  mensagens,
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

  /**
   * Série temporal de fluxo de caixa — últimos N dias agrupados por dia.
   * Retorna pontos com recebido e pendente para gráficos de linha/área.
   */
  cashFlow: protectedProcedure
    .input(
      z
        .object({
          days: z.number().int().min(7).max(365).default(30),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { pontos: [], totalRecebido: 0, totalPendente: 0, totalVencido: 0 };

      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return { pontos: [], totalRecebido: 0, totalPendente: 0, totalVencido: 0 };

      const days = input?.days ?? 30;
      const inicio = new Date();
      inicio.setDate(inicio.getDate() - days);
      inicio.setHours(0, 0, 0, 0);

      try {
        const cobrancas = await db
          .select({
            valor: asaasCobrancas.valor,
            status: asaasCobrancas.status,
            vencimento: asaasCobrancas.vencimento,
            dataPagamento: asaasCobrancas.dataPagamento,
            createdAt: asaasCobrancas.createdAt,
          })
          .from(asaasCobrancas)
          .where(
            and(
              eq(asaasCobrancas.escritorioId, esc.escritorio.id),
              gte(asaasCobrancas.createdAt, inicio),
            ),
          );

        // Agrupar por dia
        const porDia = new Map<string, { recebido: number; pendente: number }>();
        for (let i = 0; i <= days; i++) {
          const d = new Date(inicio);
          d.setDate(d.getDate() + i);
          const key = d.toISOString().slice(0, 10);
          porDia.set(key, { recebido: 0, pendente: 0 });
        }

        let totalRecebido = 0;
        let totalPendente = 0;
        let totalVencido = 0;
        const hoje = new Date().toISOString().slice(0, 10);

        for (const c of cobrancas) {
          const valor = parseFloat(c.valor) || 0;
          const pago = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status);

          if (pago) {
            totalRecebido += valor;
            const dia = (c.dataPagamento || "").slice(0, 10) ||
              (c.createdAt as Date).toISOString().slice(0, 10);
            if (porDia.has(dia)) porDia.get(dia)!.recebido += valor;
          } else if (c.status === "PENDING") {
            totalPendente += valor;
            const dia = (c.vencimento || "").slice(0, 10);
            if (porDia.has(dia)) porDia.get(dia)!.pendente += valor;
          } else if (c.status === "OVERDUE" || (c.vencimento && c.vencimento < hoje && !pago)) {
            totalVencido += valor;
          }
        }

        const pontos = Array.from(porDia.entries()).map(([data, v]) => ({
          data,
          recebido: Math.round(v.recebido * 100) / 100,
          pendente: Math.round(v.pendente * 100) / 100,
        }));

        return { pontos, totalRecebido, totalPendente, totalVencido };
      } catch (err) {
        log.warn({ err: String(err) }, "Falha ao calcular cash flow");
        return { pontos: [], totalRecebido: 0, totalPendente: 0, totalVencido: 0 };
      }
    }),

  /**
   * Feed de atividades recentes do escritório.
   * Combina: pagamentos, mensagens de entrada, movimentações processuais,
   * tarefas concluídas e agendamentos criados. Ordenado por data desc.
   */
  activityFeed: protectedProcedure
    .input(z.object({ limit: z.number().int().min(5).max(50).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];

      const limit = input?.limit ?? 20;
      const desde = new Date();
      desde.setDate(desde.getDate() - 7); // últimos 7 dias

      try {
        type FeedItem = {
          id: string;
          tipo: "pagamento" | "mensagem" | "movimentacao" | "tarefa" | "agendamento" | "lead";
          titulo: string;
          descricao: string;
          timestamp: string;
          link?: string;
        };

        const items: FeedItem[] = [];

        // 1. Pagamentos recebidos
        try {
          const pagtos = await db
            .select({
              id: asaasCobrancas.id,
              valor: asaasCobrancas.valor,
              descricao: asaasCobrancas.descricao,
              dataPagamento: asaasCobrancas.dataPagamento,
              updatedAt: asaasCobrancas.updatedAt,
            })
            .from(asaasCobrancas)
            .where(
              and(
                eq(asaasCobrancas.escritorioId, esc.escritorio.id),
                or(
                  eq(asaasCobrancas.status, "RECEIVED"),
                  eq(asaasCobrancas.status, "CONFIRMED"),
                  eq(asaasCobrancas.status, "RECEIVED_IN_CASH"),
                ),
                gte(asaasCobrancas.updatedAt, desde),
              ),
            )
            .orderBy(desc(asaasCobrancas.updatedAt))
            .limit(limit);

          for (const p of pagtos) {
            items.push({
              id: `pag-${p.id}`,
              tipo: "pagamento",
              titulo: `Pagamento recebido`,
              descricao: `R$ ${parseFloat(p.valor).toFixed(2)} — ${p.descricao || "cobrança"}`,
              timestamp: (p.updatedAt as Date).toISOString(),
              link: "/financeiro",
            });
          }
        } catch {
          /* asaas pode não estar configurado */
        }

        // 2. Mensagens de entrada (últimas)
        const msgsEntrada = await db
          .select({
            id: mensagens.id,
            conteudo: mensagens.conteudo,
            createdAt: mensagens.createdAt,
            conversaId: mensagens.conversaId,
            contatoNome: contatos.nome,
          })
          .from(mensagens)
          .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
          .innerJoin(contatos, eq(conversas.contatoId, contatos.id))
          .where(
            and(
              eq(conversas.escritorioId, esc.escritorio.id),
              eq(mensagens.direcao, "entrada"),
              gte(mensagens.createdAt, desde),
            ),
          )
          .orderBy(desc(mensagens.createdAt))
          .limit(limit);

        for (const m of msgsEntrada) {
          items.push({
            id: `msg-${m.id}`,
            tipo: "mensagem",
            titulo: `Nova mensagem de ${m.contatoNome}`,
            descricao: (m.conteudo || "").slice(0, 80),
            timestamp: (m.createdAt as Date).toISOString(),
            link: "/atendimento",
          });
        }

        // 3. Movimentações processuais
        const processosDoUser = await db
          .select({ id: processosMonitorados.id, numeroCnj: processosMonitorados.numeroCnj })
          .from(processosMonitorados)
          .where(eq(processosMonitorados.userId, ctx.user.id));

        if (processosDoUser.length > 0) {
          const procIds = processosDoUser.slice(0, 30).map((p) => p.id);
          const procMap = new Map(processosDoUser.map((p) => [p.id, p.numeroCnj]));

          for (const pid of procIds) {
            const movs = await db
              .select({
                id: movimentacoesProcesso.id,
                nome: movimentacoesProcesso.nome,
                dataHora: movimentacoesProcesso.dataHora,
                createdAt: movimentacoesProcesso.createdAt,
                processoId: movimentacoesProcesso.processoId,
              })
              .from(movimentacoesProcesso)
              .where(
                and(
                  eq(movimentacoesProcesso.processoId, pid),
                  gte(movimentacoesProcesso.createdAt, desde),
                ),
              )
              .orderBy(desc(movimentacoesProcesso.createdAt))
              .limit(3);

            for (const m of movs) {
              items.push({
                id: `mov-${m.id}`,
                tipo: "movimentacao",
                titulo: `Movimentação processual`,
                descricao: `${procMap.get(m.processoId) || ""} — ${m.nome.slice(0, 60)}`,
                timestamp: (m.createdAt as Date).toISOString(),
                link: "/processos",
              });
            }
          }
        }

        // 4. Tarefas concluídas recentemente
        const tarefasConcluidas = await db
          .select({
            id: tarefas.id,
            titulo: tarefas.titulo,
            concluidaAt: tarefas.concluidaAt,
          })
          .from(tarefas)
          .where(
            and(
              eq(tarefas.escritorioId, esc.escritorio.id),
              eq(tarefas.status, "concluida"),
              gte(tarefas.concluidaAt, desde),
            ),
          )
          .orderBy(desc(tarefas.concluidaAt))
          .limit(limit);

        for (const t of tarefasConcluidas) {
          if (!t.concluidaAt) continue;
          items.push({
            id: `tar-${t.id}`,
            tipo: "tarefa",
            titulo: `Tarefa concluída`,
            descricao: t.titulo,
            timestamp: (t.concluidaAt as Date).toISOString(),
            link: "/tarefas",
          });
        }

        // 5. Novos leads criados
        const leadsNovos = await db
          .select({
            id: leads.id,
            createdAt: leads.createdAt,
            etapaFunil: leads.etapaFunil,
            contatoNome: contatos.nome,
          })
          .from(leads)
          .innerJoin(contatos, eq(leads.contatoId, contatos.id))
          .where(
            and(eq(leads.escritorioId, esc.escritorio.id), gte(leads.createdAt, desde)),
          )
          .orderBy(desc(leads.createdAt))
          .limit(limit);

        for (const l of leadsNovos) {
          items.push({
            id: `lead-${l.id}`,
            tipo: "lead",
            titulo: `Novo lead`,
            descricao: `${l.contatoNome} — etapa: ${l.etapaFunil}`,
            timestamp: (l.createdAt as Date).toISOString(),
            link: "/atendimento",
          });
        }

        // Ordena e limita
        items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return items.slice(0, limit);
      } catch (err) {
        log.warn({ err: String(err) }, "Falha ao montar activity feed");
        return [];
      }
    }),
});
