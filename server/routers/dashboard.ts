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
  setores,
  colaboradores,
  users,
  categoriasCobranca,
} from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { checkPermission } from "../escritorio/check-permission";
import { createLogger } from "../_core/logger";
import { parseValorBR } from "../../shared/valor-br";
import { dataHojeBR } from "../../shared/escritorio-types";
import { STATUS_PAGO_ASAAS } from "../_core/asaas-status";
import { buildFiltroComissaoSQL } from "../escritorio/router-financeiro";
import { inArray } from "drizzle-orm";
import {
  proporcionalizarMeta,
  calcularProgressoMeta,
  percentInadimplenciaPorValor,
  percentInadimplenciaPorCliente,
  taxaConclusaoNoPrazo,
} from "./dashboard-setor-helpers";

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
          // Agregação em SQL: antes carregava TODAS as cobranças do
          // escritório em memória só pra somar. Em escritórios com
          // 10k+ cobranças isso era ~5MB de payload por load do home.
          // Agora 1 linha agregada.
          //
          // Classificação alinhada com kpis/cashFlowMensal:
          //   - pago: RECEIVED/CONFIRMED/RECEIVED_IN_CASH
          //   - pendente: PENDING + vencimento >= hoje
          //   - vencido: OVERDUE OR (PENDING + vencimento < hoje)
          const hojeStr = dataHojeBR();
          const valorDec = sql<number>`CAST(${asaasCobrancas.valor} AS DECIMAL(20,2))`;
          const [agg] = await db
            .select({
              recebido: sql<string>`COALESCE(SUM(CASE WHEN ${asaasCobrancas.status} IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH') THEN ${valorDec} ELSE 0 END), 0)`,
              pendente: sql<string>`COALESCE(SUM(CASE WHEN ${asaasCobrancas.status} = 'PENDING' AND ${asaasCobrancas.vencimento} >= ${hojeStr} THEN ${valorDec} ELSE 0 END), 0)`,
              vencido: sql<string>`COALESCE(SUM(CASE WHEN ${asaasCobrancas.status} = 'OVERDUE' OR (${asaasCobrancas.status} = 'PENDING' AND ${asaasCobrancas.vencimento} < ${hojeStr}) THEN ${valorDec} ELSE 0 END), 0)`,
              total: sql<number>`COUNT(*)`,
            })
            .from(asaasCobrancas)
            .where(eq(asaasCobrancas.escritorioId, escritorioId));
          finRecebido = Number(agg?.recebido ?? 0);
          finPendente = Number(agg?.pendente ?? 0);
          finVencido = Number(agg?.vencido ?? 0);
          finTotal = Number(agg?.total ?? 0);
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Dashboards por setor — visão simplificada (não confundir com relatórios
  // detalhados de gestão alta em router-relatorios.ts).
  //
  // Detecção do "modo gestor vs operacional" usa a permissão `dashboard`:
  //   - verTodos = ranking de toda a equipe (gestor / dono)
  //   - verProprios = apenas dados do próprio colaborador
  //
  // O `setorTipo` da view é informado pelo frontend (na maioria dos casos é
  // o setor do colaborador; pra dono/gestor que pula entre painéis, é a aba
  // ativa). Procedures abaixo são stateless — recebem o tipo via input.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Painel COMERCIAL — pra setor tipo='comercial' (SDR, atendente, gestor).
   *
   * Lógica de fechamento e pagamento espelha `relatorios.comercialDashboard`
   * (mesma definição de "contrato pago": cobrança paga + comissionável +
   * cujo contato fechou lead no MESMO período). Mantemos sincronia pra que
   * SDR vendo o próprio número aqui e gestor olhando o relatório vejam o
   * mesmo total — diferença é só o nível de detalhe na UI.
   *
   * Comportamento:
   *  - verProprios: retorna só o card do próprio (com % da meta)
   *  - verTodos: retorna ranking de TODOS os atendentes do setor + meu_card
   */
  comercial: protectedProcedure
    .input(
      z
        .object({
          dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;

      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;
      const eid = esc.escritorio.id;
      const colabId = esc.colaborador.id;

      const perm = await checkPermission(ctx.user.id, "dashboard", "ver");
      if (!perm.allowed) {
        return null;
      }
      const verTodos = perm.verTodos;

      // Range: default = mês vigente. Bate com `relatorios.comercialDashboard`.
      let dataInicio: Date;
      let dataFim: Date;
      if (input?.dataInicio && input?.dataFim) {
        dataInicio = new Date(`${input.dataInicio}T00:00:00`);
        dataFim = new Date(`${input.dataFim}T23:59:59`);
      } else {
        const agora = new Date();
        dataInicio = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0);
        dataFim = agora;
      }
      const dataInicioStr = dataInicio.toISOString().slice(0, 10);
      const dataFimStr = dataFim.toISOString().slice(0, 10);

      // Atendentes elegíveis: todo colaborador ativo em setor tipo='comercial'.
      // Quem não tem verTodos só vê a si mesmo.
      const todosComerciais = await db
        .select({
          id: colaboradores.id,
          userName: users.name,
          metaMensal: colaboradores.metaMensal,
          setorId: colaboradores.setorId,
          setorNome: setores.nome,
        })
        .from(colaboradores)
        .innerJoin(users, eq(colaboradores.userId, users.id))
        .leftJoin(setores, eq(colaboradores.setorId, setores.id))
        .where(and(
          eq(colaboradores.escritorioId, eid),
          eq(colaboradores.ativo, true),
          eq(setores.tipo, "comercial"),
        ));

      const idsAtendentes = verTodos
        ? todosComerciais.map((c) => c.id)
        : (todosComerciais.find((c) => c.id === colabId) ? [colabId] : []);

      if (idsAtendentes.length === 0) {
        return {
          periodo: { dataInicio: dataInicioStr, dataFim: dataFimStr },
          modo: verTodos ? ("gestor" as const) : ("individual" as const),
          meu: null,
          ranking: verTodos ? [] : null,
          temSetor: todosComerciais.some((c) => c.id === colabId),
        };
      }

      // Subquery: contatos com lead fechado_ganho no período. Bate com lógica
      // de relatorios.comercialDashboard pra contar SÓ quem fechou agora.
      const contatosFechadosAtual = db
        .select({ id: leads.contatoId })
        .from(leads)
        .where(and(
          eq(leads.escritorioId, eid),
          eq(leads.etapaFunil, "fechado_ganho"),
          gte(leads.createdAt, dataInicio),
          lte(leads.createdAt, dataFim),
        ));

      // 1) Leads fechados por atendente (etapaFunil=fechado_ganho)
      const leadsGanhosRows = await db
        .select({
          responsavelId: leads.responsavelId,
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

      const mapaFechados = new Map<number, number>();
      for (const r of leadsGanhosRows) {
        if (r.responsavelId == null) continue;
        mapaFechados.set(Number(r.responsavelId), Number(r.contratosFechados || 0));
      }

      // 2) Cobranças pagas comissionáveis (faturado + contratos pagos)
      const pagosRows = await db
        .select({
          atendenteId: asaasCobrancas.atendenteId,
          faturado: sql<number>`COALESCE(SUM(CAST(${asaasCobrancas.valor} AS DECIMAL(14,2))), 0)`,
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
          inArray(asaasCobrancas.contatoId, contatosFechadosAtual),
        ))
        .groupBy(asaasCobrancas.atendenteId);

      const mapaPagos = new Map<number, { faturado: number; contratosPagos: number }>();
      for (const r of pagosRows) {
        if (r.atendenteId == null) continue;
        mapaPagos.set(Number(r.atendenteId), {
          faturado: Number(r.faturado || 0),
          contratosPagos: Number(r.contratosPagos || 0),
        });
      }

      const cardOf = (c: typeof todosComerciais[number]) => {
        const fechados = mapaFechados.get(c.id) ?? 0;
        const pagos = mapaPagos.get(c.id) ?? { faturado: 0, contratosPagos: 0 };
        const metaTotal = c.metaMensal != null ? Number(c.metaMensal) : null;
        const metaPeriodo = proporcionalizarMeta(metaTotal, dataInicio, dataFim);
        const progressoMeta = calcularProgressoMeta(pagos.faturado, metaPeriodo);
        return {
          atendenteId: c.id,
          nome: c.userName || `#${c.id}`,
          setorNome: c.setorNome,
          contratosFechados: fechados,
          contratosPagos: pagos.contratosPagos,
          faturado: pagos.faturado,
          meta: metaTotal,
          metaPeriodo,
          progressoMeta,
        };
      };

      const meuComercial = todosComerciais.find((c) => c.id === colabId);
      const meu = meuComercial ? cardOf(meuComercial) : null;

      const ranking = verTodos
        ? todosComerciais
            .map((c) => cardOf(c))
            .sort((a, b) => b.faturado - a.faturado)
        : null;

      return {
        periodo: { dataInicio: dataInicioStr, dataFim: dataFimStr },
        modo: verTodos ? ("gestor" as const) : ("individual" as const),
        meu,
        ranking,
        temSetor: meuComercial != null,
      };
    }),

  /**
   * Painel FINANCEIRO — pra setor tipo='financeiro'.
   *
   * "Inadimplência" segue a mesma definição do card da página Financeiro:
   *   - Cliente inadimplente = contato com pelo menos 1 cobrança vencida
   *     (status OVERDUE OU PENDING com vencimento < hoje).
   *
   * % por valor = vencido / (vencido + recebidoComVencimentoNoPeríodo).
   * % por cliente = inadimplentes / clientesComCobranca.
   *
   * Pra verProprios (não financeiro pleno): retorna ZERO em todos os campos.
   * Dados financeiros são transversais e não pertencem a 1 colaborador.
   */
  financeiro: protectedProcedure
    .input(
      z
        .object({
          dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;

      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;
      const eid = esc.escritorio.id;

      const perm = await checkPermission(ctx.user.id, "dashboard", "ver");
      const ZERO = {
        periodo: { dataInicio: "", dataFim: "" },
        recebido: 0,
        pendente: 0,
        vencido: 0,
        totalEsperadoNoPeriodo: 0,
        clientesInadimplentes: 0,
        clientesComCobranca: 0,
        percentInadimplenciaValor: 0,
        percentInadimplenciaClientes: 0,
        topDevedores: [] as Array<{ contatoId: number; nome: string; valor: number; cobrancasVencidas: number }>,
      };
      // Sem verTodos: dado financeiro é do escritório e não tem "minha visão".
      // Frontend mostra mensagem "Sem permissão" se vier dado vazio.
      if (!perm.verTodos) return ZERO;

      // Range default = mês vigente
      let dataInicio: Date;
      let dataFim: Date;
      if (input?.dataInicio && input?.dataFim) {
        dataInicio = new Date(`${input.dataInicio}T00:00:00`);
        dataFim = new Date(`${input.dataFim}T23:59:59`);
      } else {
        const agora = new Date();
        dataInicio = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0);
        dataFim = agora;
      }
      const dataInicioStr = dataInicio.toISOString().slice(0, 10);
      const dataFimStr = dataFim.toISOString().slice(0, 10);
      const hojeStr = dataHojeBR();

      // KPIs agregados em SQL — mesmo padrão do `asaas.kpis`. Filtros:
      //   - recebido: status pago + dataPagamento no range
      //   - pendente: PENDING + venc >= hoje + venc no range
      //   - vencido: (OVERDUE OR PENDING+venc<hoje) + venc no range
      //   - recebidoComVencimentoNoPeriodo: pago + venc no range
      //     (usado pra calcular % inadimplência por valor)
      const valorDec = sql`CAST(${asaasCobrancas.valor} AS DECIMAL(20,2))`;
      const ehPago = sql`${asaasCobrancas.status} IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')`;
      const ehPending = sql`${asaasCobrancas.status} = 'PENDING'`;
      const ehOverdue = sql`${asaasCobrancas.status} = 'OVERDUE'`;
      const inRangePag = sql`${asaasCobrancas.dataPagamento} >= ${dataInicioStr}
        AND ${asaasCobrancas.dataPagamento} <= ${dataFimStr}`;
      const inRangeVenc = sql`${asaasCobrancas.vencimento} >= ${dataInicioStr}
        AND ${asaasCobrancas.vencimento} <= ${dataFimStr}`;
      const pendingNoFuturo = sql`${asaasCobrancas.vencimento} >= ${hojeStr}`;
      const pendingNoPassado = sql`${asaasCobrancas.vencimento} < ${hojeStr}`;

      const [agg] = await db
        .select({
          recebido: sql<string>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${inRangePag} THEN ${valorDec} ELSE 0 END), 0)`,
          pendente: sql<string>`COALESCE(SUM(CASE WHEN ${ehPending} AND ${pendingNoFuturo} AND ${inRangeVenc} THEN ${valorDec} ELSE 0 END), 0)`,
          vencido: sql<string>`COALESCE(SUM(CASE WHEN ((${ehPending} AND ${pendingNoPassado}) OR ${ehOverdue}) AND ${inRangeVenc} THEN ${valorDec} ELSE 0 END), 0)`,
          recebidoComVenc: sql<string>`COALESCE(SUM(CASE WHEN ${ehPago} AND ${inRangeVenc} THEN ${valorDec} ELSE 0 END), 0)`,
        })
        .from(asaasCobrancas)
        .where(eq(asaasCobrancas.escritorioId, eid));

      const recebido = Number(agg?.recebido ?? 0);
      const pendente = Number(agg?.pendente ?? 0);
      const vencido = Number(agg?.vencido ?? 0);
      const recebidoComVenc = Number(agg?.recebidoComVenc ?? 0);
      const totalEsperadoNoPeriodo = recebidoComVenc + vencido;
      const percentInadimplenciaValor = percentInadimplenciaPorValor(
        vencido,
        totalEsperadoNoPeriodo,
      );

      // Contagem de clientes únicos: com cobrança no período (venc no range)
      // e dentre eles quantos têm pelo menos 1 vencida.
      const [aggClientes] = await db
        .select({
          totalClientes: sql<number>`COUNT(DISTINCT ${asaasCobrancas.contatoId})`,
        })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, eid),
          inRangeVenc,
        ));

      const [aggInadimplentes] = await db
        .select({
          inadimplentes: sql<number>`COUNT(DISTINCT ${asaasCobrancas.contatoId})`,
        })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, eid),
          inRangeVenc,
          or(ehOverdue, and(ehPending, pendingNoPassado))!,
        ));

      const clientesComCobranca = Number(aggClientes?.totalClientes ?? 0);
      const clientesInadimplentes = Number(aggInadimplentes?.inadimplentes ?? 0);
      const percentInadimplenciaClientes = percentInadimplenciaPorCliente(
        clientesInadimplentes,
        clientesComCobranca,
      );

      // Top 5 devedores por valor vencido
      const topDevedoresRows = await db
        .select({
          contatoId: asaasCobrancas.contatoId,
          nome: contatos.nome,
          valor: sql<string>`COALESCE(SUM(${valorDec}), 0)`,
          cobrancasVencidas: sql<number>`COUNT(*)`,
        })
        .from(asaasCobrancas)
        .innerJoin(contatos, eq(asaasCobrancas.contatoId, contatos.id))
        .where(and(
          eq(asaasCobrancas.escritorioId, eid),
          or(ehOverdue, and(ehPending, pendingNoPassado))!,
        ))
        .groupBy(asaasCobrancas.contatoId, contatos.nome)
        .orderBy(sql`COALESCE(SUM(${valorDec}), 0) DESC`)
        .limit(5);

      return {
        periodo: { dataInicio: dataInicioStr, dataFim: dataFimStr },
        recebido,
        pendente,
        vencido,
        totalEsperadoNoPeriodo,
        clientesInadimplentes,
        clientesComCobranca,
        percentInadimplenciaValor,
        percentInadimplenciaClientes,
        topDevedores: topDevedoresRows.map((r) => ({
          contatoId: Number(r.contatoId),
          nome: r.nome,
          valor: Number(r.valor ?? 0),
          cobrancasVencidas: Number(r.cobrancasVencidas ?? 0),
        })),
      };
    }),

  /**
   * Painel OPERACIONAL — pra setor tipo='operacional'.
   *
   * Conceitos:
   *   - "No prazo": tarefa/agenda pendente com dataVencimento >= hoje
   *   - "Atrasada": tarefa/agenda pendente com dataVencimento < hoje
   *   - "Concluída no prazo": status=concluida + concluidaAt <= dataVencimento
   *   - "Concluída fora": status=concluida + concluidaAt > dataVencimento
   *
   * Comportamento:
   *   - verProprios: KPIs filtrados pelo colaborador (responsavelId ou criador)
   *   - verTodos: KPIs do escritório + ranking por colaborador
   */
  operacional: protectedProcedure
    .input(
      z
        .object({
          dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;

      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;
      const eid = esc.escritorio.id;
      const colabId = esc.colaborador.id;

      const perm = await checkPermission(ctx.user.id, "dashboard", "ver");
      if (!perm.allowed) return null;
      const verTodos = perm.verTodos;

      // Range default = mês vigente
      let dataInicio: Date;
      let dataFim: Date;
      if (input?.dataInicio && input?.dataFim) {
        dataInicio = new Date(`${input.dataInicio}T00:00:00`);
        dataFim = new Date(`${input.dataFim}T23:59:59`);
      } else {
        const agora = new Date();
        dataInicio = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0);
        dataFim = agora;
      }
      const dataInicioStr = dataInicio.toISOString().slice(0, 10);
      const dataFimStr = dataFim.toISOString().slice(0, 10);

      const agora = new Date();
      // Estratégia de período pra evitar "estagiário olhando dia 2 do mês
      // não vê tarefa antiga ainda pendente":
      //
      //   - "No prazo / Atrasadas" = pendentes/em_andamento HOJE
      //     (sem filtro de range — o que está em aberto agora é o que importa)
      //   - "Concluídas no prazo/fora" = entregues DENTRO do range
      //     (filtra por concluidaAt no range; reflete a produção do mês)
      //
      // Pra agenda usamos dataInicio como "venc" e updatedAt como proxy de
      // entrega (não há campo concluidaAt na tabela agendamentos).
      const buildTarefasAgg = async (filtroResp: any[]) => {
        const [r] = await db
          .select({
            noPrazo: sql<number>`SUM(CASE WHEN ${tarefas.status} IN ('pendente','em_andamento') AND (${tarefas.dataVencimento} IS NULL OR ${tarefas.dataVencimento} >= ${agora}) THEN 1 ELSE 0 END)`,
            atrasadas: sql<number>`SUM(CASE WHEN ${tarefas.status} IN ('pendente','em_andamento') AND ${tarefas.dataVencimento} < ${agora} THEN 1 ELSE 0 END)`,
            concluidasNoPrazo: sql<number>`SUM(CASE
              WHEN ${tarefas.status} = 'concluida'
                AND ${tarefas.concluidaAt} IS NOT NULL
                AND ${tarefas.concluidaAt} >= ${dataInicio}
                AND ${tarefas.concluidaAt} <= ${dataFim}
                AND (${tarefas.dataVencimento} IS NULL OR ${tarefas.concluidaAt} <= ${tarefas.dataVencimento})
              THEN 1 ELSE 0 END)`,
            concluidasFora: sql<number>`SUM(CASE
              WHEN ${tarefas.status} = 'concluida'
                AND ${tarefas.concluidaAt} IS NOT NULL
                AND ${tarefas.concluidaAt} >= ${dataInicio}
                AND ${tarefas.concluidaAt} <= ${dataFim}
                AND ${tarefas.dataVencimento} IS NOT NULL
                AND ${tarefas.concluidaAt} > ${tarefas.dataVencimento}
              THEN 1 ELSE 0 END)`,
          })
          .from(tarefas)
          .where(and(
            eq(tarefas.escritorioId, eid),
            ...filtroResp,
          ));
        return {
          noPrazo: Number(r?.noPrazo || 0),
          atrasadas: Number(r?.atrasadas || 0),
          concluidasNoPrazo: Number(r?.concluidasNoPrazo || 0),
          concluidasFora: Number(r?.concluidasFora || 0),
        };
      };

      const buildAgendaAgg = async (filtroResp: any[]) => {
        const [r] = await db
          .select({
            noPrazo: sql<number>`SUM(CASE WHEN ${agendamentos.status} IN ('pendente','em_andamento') AND ${agendamentos.dataInicio} >= ${agora} THEN 1 ELSE 0 END)`,
            atrasadas: sql<number>`SUM(CASE WHEN ${agendamentos.status} IN ('pendente','em_andamento','atrasado') AND ${agendamentos.dataInicio} < ${agora} THEN 1 ELSE 0 END)`,
            concluidas: sql<number>`SUM(CASE
              WHEN ${agendamentos.status} = 'concluido'
                AND ${agendamentos.dataInicio} >= ${dataInicio}
                AND ${agendamentos.dataInicio} <= ${dataFim}
              THEN 1 ELSE 0 END)`,
          })
          .from(agendamentos)
          .where(and(
            eq(agendamentos.escritorioId, eid),
            ...filtroResp,
          ));
        return {
          noPrazo: Number(r?.noPrazo || 0),
          atrasadas: Number(r?.atrasadas || 0),
          concluidas: Number(r?.concluidas || 0),
        };
      };

      // Sempre calcula "meu" — gestor também tem KPIs próprios (a Dashboard
      // dele mostra ambos: visão dele e visão da equipe).
      const filtroMeuTarefas = [or(
        eq(tarefas.responsavelId, colabId),
        eq(tarefas.criadoPor, colabId),
      )!];
      const filtroMeuAgenda = [or(
        eq(agendamentos.responsavelId, colabId),
        eq(agendamentos.criadoPorId, colabId),
      )!];

      const [meuTarefas, meuAgenda] = await Promise.all([
        buildTarefasAgg(filtroMeuTarefas),
        buildAgendaAgg(filtroMeuAgenda),
      ]);

      const taxaNoPrazoTarefas = taxaConclusaoNoPrazo(
        meuTarefas.concluidasNoPrazo,
        meuTarefas.concluidasFora,
      );

      const meu = {
        tarefas: meuTarefas,
        agenda: meuAgenda,
        taxaNoPrazo: taxaNoPrazoTarefas,
      };

      if (!verTodos) {
        return {
          periodo: { dataInicio: dataInicioStr, dataFim: dataFimStr },
          modo: "individual" as const,
          meu,
          ranking: null,
          equipe: null,
        };
      }

      // Modo gestor: agrega APENAS dos colaboradores do setor operacional
      // do escritório. Antes pegava do escritório inteiro — gestor operacional
      // via tarefas/agenda de comerciais, financeiros, etc. Agora o ranking
      // e os totais da "equipe" refletem só quem é do setor operacional.

      // 1) IDs dos colaboradores ativos com setor tipo='operacional'.
      const operacionaisRows = await db
        .select({
          id: colaboradores.id,
          userName: users.name,
          setorNome: setores.nome,
          setorTipo: setores.tipo,
        })
        .from(colaboradores)
        .innerJoin(users, eq(colaboradores.userId, users.id))
        .leftJoin(setores, eq(colaboradores.setorId, setores.id))
        .where(and(
          eq(colaboradores.escritorioId, eid),
          eq(colaboradores.ativo, true),
          eq(setores.tipo, "operacional"),
        ));
      const idsOperacionais = operacionaisRows.map((c) => c.id);

      // 2) Totais da equipe — filtrando responsavelId IN (idsOperacionais).
      // Quando idsOperacionais vazio, retorna 0 (inArray com [] = false).
      const filtroEquipeTar = idsOperacionais.length > 0
        ? [inArray(tarefas.responsavelId, idsOperacionais)]
        : [sql`1=0`];
      const filtroEquipeAg = idsOperacionais.length > 0
        ? [inArray(agendamentos.responsavelId, idsOperacionais)]
        : [sql`1=0`];

      const [equipeTarefas, equipeAgenda] = await Promise.all([
        buildTarefasAgg(filtroEquipeTar),
        buildAgendaAgg(filtroEquipeAg),
      ]);
      const equipeTaxa = taxaConclusaoNoPrazo(
        equipeTarefas.concluidasNoPrazo,
        equipeTarefas.concluidasFora,
      );
      const equipe = {
        tarefas: equipeTarefas,
        agenda: equipeAgenda,
        taxaNoPrazo: equipeTaxa,
      };

      // 3) Group-by por colaborador — também restrito ao setor operacional.
      // Quando vazio, drizzle/sql aceita inArray com array vazio (gera
      // sempre false), retornando 0 rows.
      const filtroSetorTar = idsOperacionais.length > 0
        ? inArray(tarefas.responsavelId, idsOperacionais)
        : sql`1=0`;
      const filtroSetorAg = idsOperacionais.length > 0
        ? inArray(agendamentos.responsavelId, idsOperacionais)
        : sql`1=0`;

      const tarefasPorColab = await db
        .select({
          responsavelId: tarefas.responsavelId,
          noPrazo: sql<number>`SUM(CASE WHEN ${tarefas.status} IN ('pendente','em_andamento') AND (${tarefas.dataVencimento} IS NULL OR ${tarefas.dataVencimento} >= ${agora}) THEN 1 ELSE 0 END)`,
          atrasadas: sql<number>`SUM(CASE WHEN ${tarefas.status} IN ('pendente','em_andamento') AND ${tarefas.dataVencimento} < ${agora} THEN 1 ELSE 0 END)`,
          concluidasNoPrazo: sql<number>`SUM(CASE
            WHEN ${tarefas.status} = 'concluida'
              AND ${tarefas.concluidaAt} IS NOT NULL
              AND ${tarefas.concluidaAt} >= ${dataInicio}
              AND ${tarefas.concluidaAt} <= ${dataFim}
              AND (${tarefas.dataVencimento} IS NULL OR ${tarefas.concluidaAt} <= ${tarefas.dataVencimento})
            THEN 1 ELSE 0 END)`,
          concluidasFora: sql<number>`SUM(CASE
            WHEN ${tarefas.status} = 'concluida'
              AND ${tarefas.concluidaAt} IS NOT NULL
              AND ${tarefas.concluidaAt} >= ${dataInicio}
              AND ${tarefas.concluidaAt} <= ${dataFim}
              AND ${tarefas.dataVencimento} IS NOT NULL
              AND ${tarefas.concluidaAt} > ${tarefas.dataVencimento}
            THEN 1 ELSE 0 END)`,
        })
        .from(tarefas)
        .where(and(eq(tarefas.escritorioId, eid), filtroSetorTar))
        .groupBy(tarefas.responsavelId);

      const agendaPorColab = await db
        .select({
          responsavelId: agendamentos.responsavelId,
          noPrazo: sql<number>`SUM(CASE WHEN ${agendamentos.status} IN ('pendente','em_andamento') AND ${agendamentos.dataInicio} >= ${agora} THEN 1 ELSE 0 END)`,
          atrasadas: sql<number>`SUM(CASE WHEN ${agendamentos.status} IN ('pendente','em_andamento','atrasado') AND ${agendamentos.dataInicio} < ${agora} THEN 1 ELSE 0 END)`,
          concluidas: sql<number>`SUM(CASE
            WHEN ${agendamentos.status} = 'concluido'
              AND ${agendamentos.dataInicio} >= ${dataInicio}
              AND ${agendamentos.dataInicio} <= ${dataFim}
            THEN 1 ELSE 0 END)`,
        })
        .from(agendamentos)
        .where(and(eq(agendamentos.escritorioId, eid), filtroSetorAg))
        .groupBy(agendamentos.responsavelId);

      // 4) Lista de colaboradores DO SETOR pra montar ranking — quem não
      // teve atividade aparece com zeros (não some).
      const colabs = operacionaisRows;

      const mapaTar = new Map<number, { noPrazo: number; atrasadas: number; concluidasNoPrazo: number; concluidasFora: number }>();
      for (const r of tarefasPorColab) {
        if (r.responsavelId == null) continue;
        mapaTar.set(Number(r.responsavelId), {
          noPrazo: Number(r.noPrazo || 0),
          atrasadas: Number(r.atrasadas || 0),
          concluidasNoPrazo: Number(r.concluidasNoPrazo || 0),
          concluidasFora: Number(r.concluidasFora || 0),
        });
      }
      const mapaAg = new Map<number, { noPrazo: number; atrasadas: number; concluidas: number }>();
      for (const r of agendaPorColab) {
        if (r.responsavelId == null) continue;
        mapaAg.set(Number(r.responsavelId), {
          noPrazo: Number(r.noPrazo || 0),
          atrasadas: Number(r.atrasadas || 0),
          concluidas: Number(r.concluidas || 0),
        });
      }

      const ranking = colabs
        .map((c) => {
          const t = mapaTar.get(c.id) ?? { noPrazo: 0, atrasadas: 0, concluidasNoPrazo: 0, concluidasFora: 0 };
          const a = mapaAg.get(c.id) ?? { noPrazo: 0, atrasadas: 0, concluidas: 0 };
          return {
            colaboradorId: c.id,
            nome: c.userName || `#${c.id}`,
            setorNome: c.setorNome,
            setorTipo: c.setorTipo,
            tarefas: t,
            agenda: a,
            taxaNoPrazo: taxaConclusaoNoPrazo(t.concluidasNoPrazo, t.concluidasFora),
          };
        })
        // Quem tem atividade primeiro; dentro disso, quem tem mais concluído no prazo
        .sort((b, a) => {
          const totA = a.tarefas.concluidasNoPrazo + a.tarefas.concluidasFora + a.tarefas.noPrazo + a.tarefas.atrasadas;
          const totB = b.tarefas.concluidasNoPrazo + b.tarefas.concluidasFora + b.tarefas.noPrazo + b.tarefas.atrasadas;
          if (totA !== totB) return totA - totB;
          return (a.tarefas.concluidasNoPrazo - a.tarefas.concluidasFora) - (b.tarefas.concluidasNoPrazo - b.tarefas.concluidasFora);
        });

      return {
        periodo: { dataInicio: dataInicioStr, dataFim: dataFimStr },
        modo: "gestor" as const,
        meu,
        equipe,
        ranking,
      };
    }),
});
