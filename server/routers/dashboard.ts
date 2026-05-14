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
  notificacoes,
} from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { checkPermission } from "../escritorio/check-permission";
import { createLogger } from "../_core/logger";
import { parseValorBR } from "../../shared/valor-br";
import { dataHojeBR } from "../../shared/escritorio-types";

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

  /**
   * Informações de créditos.
   *
   * Pós-migration 0073 (saldo único): retorna saldo do escritório
   * (calc + processos + monitoramentos juntos) no formato esperado
   * pelo header (creditsTotal, creditsUsed, creditsRemaining).
   *
   * Quando user não tem escritório (ex: trial recém-cadastrado),
   * cai pro user_credits legado.
   */
  credits: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { getEscritorioPorUsuario } = await import("../escritorio/db-escritorio");
      const { getSaldoEscritorio } = await import("../billing/escritorio-creditos");

      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (esc) {
        const s = await getSaldoEscritorio(esc.escritorio.id);
        // Mantém shape esperado pelo frontend: creditsTotal/Used/Remaining.
        // creditsTotal = saldo + cotaMensal_consumida_aprox.
        // Heurística: usamos saldo "atual" como creditsRemaining,
        // total = saldo + totalConsumido pra mostrar evolução fiel.
        return {
          creditsTotal: s.saldo + s.totalConsumido,
          creditsUsed: s.totalConsumido,
          creditsRemaining: s.saldo,
          resetAt: s.ultimoReset,
        };
      }
    } catch {
      /* fallback */
    }
    return getUserCreditsInfo(ctx.user.id);
  }),

  /** Resumo do escritório para dashboard inteligente.
   *  Respeita a permissão "dashboard" do colaborador:
   *  - verTodos → mostra tudo do escritório
   *  - verProprios only → filtra só o que é do colaborador (responsável
   *    ou criador). Garante que atendentes/estagiários vejam só seus dados.
   */
  resumoEscritorio: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;

    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;

    const escritorioId = esc.escritorio.id;
    const now = new Date();
    const hojeInicio = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const hojeFim = new Date(hojeInicio.getTime() + 86400000);

    // Decide escopo baseado em permissão "dashboard"
    const perm = await checkPermission(ctx.user.id, "dashboard", "ver");
    const soProprios = !perm.verTodos && perm.verProprios;
    const colabId = esc.colaborador.id;

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
            ...(soProprios
              ? [or(eq(agendamentos.responsavelId, colabId), eq(agendamentos.criadoPorId, colabId))!]
              : []),
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
            ...(soProprios
              ? [or(eq(tarefas.responsavelId, colabId), eq(tarefas.criadoPor, colabId))!]
              : []),
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
            ...(soProprios
              ? [or(eq(tarefas.responsavelId, colabId), eq(tarefas.criadoPor, colabId))!]
              : []),
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
            ...(soProprios
              ? [or(eq(agendamentos.responsavelId, colabId), eq(agendamentos.criadoPorId, colabId))!]
              : []),
          ),
        );

      // ─── CRM / Conversas ────────────────────────────────────
      const conversasAguardando = await db
        .select({ id: conversas.id })
        .from(conversas)
        .where(and(
          eq(conversas.escritorioId, escritorioId),
          eq(conversas.status, "aguardando"),
          ...(soProprios ? [eq(conversas.atendenteId, colabId)] : []),
        ));

      const conversasAbertas = await db
        .select({ id: conversas.id })
        .from(conversas)
        .where(and(
          eq(conversas.escritorioId, escritorioId),
          eq(conversas.status, "em_atendimento"),
          ...(soProprios ? [eq(conversas.atendenteId, colabId)] : []),
        ));

      const totalContatos = await db
        .select({ id: contatos.id })
        .from(contatos)
        .where(and(
          eq(contatos.escritorioId, escritorioId),
          ...(soProprios ? [eq(contatos.responsavelId, colabId)] : []),
        ));

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
            ...(soProprios ? [eq(leads.responsavelId, colabId)] : []),
          ),
        );

      let valorPipeline = 0;
      for (const l of leadsAbertos) {
        valorPipeline += parseValorBR(l.valorEstimado as string | null);
      }

      // ─── Financeiro ─────────────────────────────────────────
      // Dados financeiros são do escritório (não pertencem a um
      // colaborador). Pra quem tem só verProprios, ocultamos os totais.
      let finRecebido = 0;
      let finPendente = 0;
      let finVencido = 0;
      let finTotal = 0;
      if (!soProprios) {
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
      }

      // ─── Processos (motor próprio) ──────────────────────────
      // Monitoramento próprio entra na Sprint 2. Por enquanto, conta
      // só clienteProcessos (vinculados manualmente) e mostra lista
      // vazia de movimentações.
      const totalProcessos = 0;
      const movimentacoesRecentes: Array<{
        id: number;
        nome: string;
        numeroCnj: string;
        dataHora: string;
      }> = [];

      // Não lidas = notificações de tipo "movimentacao" ainda não lidas
      const movsNaoLidasRows = await db
        .select({ id: notificacoes.id })
        .from(notificacoes)
        .where(
          and(
            eq(notificacoes.userId, ctx.user.id),
            eq(notificacoes.tipo, "movimentacao"),
            eq(notificacoes.lida, false),
          ),
        );
      const movimentacoesNaoLidas = movsNaoLidasRows.length;

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

      // Se só tem verProprios no dashboard, dados financeiros do
      // escritório não aparecem pra ele — retorna série vazia.
      const perm = await checkPermission(ctx.user.id, "dashboard", "ver");
      if (!perm.verTodos && perm.verProprios) {
        return { pontos: [], totalRecebido: 0, totalPendente: 0, totalVencido: 0 };
      }

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
        // Fuso BR: server roda UTC; após 21h BRT viraria amanhã e marcaria
        // PENDING do dia atual como vencidas indevidamente.
        const hoje = dataHojeBR();

        for (const c of cobrancas) {
          const valor = parseFloat(c.valor) || 0;
          const pago = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status);

          if (pago) {
            totalRecebido += valor;
            const dia = (c.dataPagamento || "").slice(0, 10) ||
              (c.createdAt as Date).toISOString().slice(0, 10);
            if (porDia.has(dia)) porDia.get(dia)!.recebido += valor;
          } else if (c.status === "PENDING") {
            // PENDING vencida vai pra totalVencido (mesma lógica do KPI
            // e cashFlowMensal do router-asaas). PENDING dentro do prazo
            // continua em totalPendente.
            if (c.vencimento && c.vencimento < hoje) {
              totalVencido += valor;
            } else {
              totalPendente += valor;
              const dia = (c.vencimento || "").slice(0, 10);
              if (porDia.has(dia)) porDia.get(dia)!.pendente += valor;
            }
          } else if (c.status === "OVERDUE") {
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

      // Atendente/estagiário com "verProprios" apenas — feed do escritório
      // inteiro não é pra eles. Retorna vazio.
      const perm = await checkPermission(ctx.user.id, "dashboard", "ver");
      if (!perm.verTodos && perm.verProprios) return [];

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

        // 3. Movimentações processuais (motor próprio — Sprint 2)
        // Antes vinha de juditMonitoramentos. Cron de monitoramento próprio
        // popular esse feed entra na Sprint 2 (cobre processos vinculados
        // em clienteProcessos via TJCE adapter).

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
