/**
 * Router — Dashboard do usuário
 *
 * Estatísticas de uso, créditos, histórico de cálculos e resumo
 * inteligente do escritório (compromissos, leads, financeiro, processos).
 */

import { eq, and, desc, asc, gte, lte, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { toIsoString } from "../_core/dates";
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
import {
  dataHojeBR,
  FUSO_HORARIO_PADRAO,
  inicioDoDiaNoFuso,
  resolverPeriodoNoFuso,
} from "../../shared/escritorio-types";
import { contarConversasPorStatus } from "../escritorio/db-crm";
import {
  STATUS_PAGO_ASAAS,
  STATUS_PENDENTE_ASAAS,
  STATUS_VENCIDO_ASAAS,
} from "../_core/asaas-status";
import { contatosVisiveisFinanceiro } from "../escritorio/contatos-visiveis-financeiro";
import { contarMovimentacoesNaoLidas } from "../processos/contador-movimentacoes";
import { corteAtraso } from "../escritorio/prazo-atrasado";
import { buildFiltroComissaoSQL } from "../escritorio/router-financeiro";
import { inArray } from "drizzle-orm";
import {
  proporcionalizarMeta,
  calcularProgressoMeta,
  percentInadimplenciaPorValor,
  percentInadimplenciaPorCliente,
  taxaConclusaoNoPrazo,
  resolverRangeCashFlow,
  fimDoMes,
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
    // "Hoje" no fuso do ESCRITÓRIO, não no relógio do servidor.
    //
    // O server roda em UTC: `new Date(now.getFullYear(), now.getMonth(),
    // now.getDate())` começa o dia às 21h BRT do dia anterior. O painel contava
    // uma janela deslocada em 3 horas enquanto a tela da Agenda — que já fazia
    // isso certo — contava outra, e os dois números do mesmo dia divergiam.
    const fusoEscritorio = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
    const hojeStr = dataHojeBR(fusoEscritorio);
    const hojeInicio = inicioDoDiaNoFuso(hojeStr, fusoEscritorio);
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

      // Counts reais de "hoje" — sem LIMIT 5, pra não capar o card
      // "Hoje precisa atenção". As queries acima trazem só 5 pra render
      // a lista; estas dão o número total que o card exibe.
      const [compHojeAgg] = await db
        .select({ total: sql<number>`COUNT(*)` })
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
        );
      const [tarefasHojeAgg] = await db
        .select({ total: sql<number>`COUNT(*)` })
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
        );
      const compromissosHojeCount = Number(compHojeAgg?.total ?? 0);
      const tarefasHojeCount = Number(tarefasHojeAgg?.total ?? 0);
      const totalHojeCount = compromissosHojeCount + tarefasHojeCount;

      // ─── Semana civil (domingo→sábado) pra faixa de calendário ──────
      // Só a contagem por dia: o painel marca quais dias têm algo, e o clique
      // abre o dia na própria lista. Trazer os itens dos sete dias seria
      // carregar sete listas pra desenhar sete bolinhas.
      //
      // Os dias saem de aritmética sobre o dia CIVIL do escritório ancorada ao
      // meio-dia UTC — longe da borda do dia em qualquer fuso ±11h, então o
      // offset do server não desloca a semana.
      const [anoH, mesH, diaH] = hojeStr.split("-").map(Number);
      const meioDiaHoje = new Date(Date.UTC(anoH!, mesH! - 1, diaH!, 12, 0, 0));
      const chaveComDeslocamento = (dias: number) =>
        new Date(meioDiaHoje.getTime() + dias * 86400000).toISOString().slice(0, 10);
      const diasAteDomingo = meioDiaHoje.getUTCDay();
      const chavesSemana = Array.from({ length: 7 }, (_, i) => chaveComDeslocamento(i - diasAteDomingo));
      const semanaInicio = inicioDoDiaNoFuso(chavesSemana[0]!, fusoEscritorio);
      const semanaFim = new Date(
        inicioDoDiaNoFuso(chavesSemana[6]!, fusoEscritorio).getTime() + 86400000,
      );

      // Agrupamento em JS, não no SQL: `DATE_FORMAT` recorta pelo dia do
      // TIMESTAMP armazenado, e um compromisso das 22h no fuso do escritório
      // cai no dia seguinte em UTC — a bolinha apareceria no dia errado.
      const [compSemana, tarefasSemana] = await Promise.all([
        db
          .select({ quando: agendamentos.dataInicio })
          .from(agendamentos)
          .where(
            and(
              eq(agendamentos.escritorioId, escritorioId),
              gte(agendamentos.dataInicio, semanaInicio),
              lt(agendamentos.dataInicio, semanaFim),
              or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento")),
              ...(soProprios
                ? [or(eq(agendamentos.responsavelId, colabId), eq(agendamentos.criadoPorId, colabId))!]
                : []),
            ),
          ),
        db
          .select({ quando: tarefas.dataVencimento })
          .from(tarefas)
          .where(
            and(
              eq(tarefas.escritorioId, escritorioId),
              gte(tarefas.dataVencimento, semanaInicio),
              lt(tarefas.dataVencimento, semanaFim),
              or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")),
              ...(soProprios
                ? [or(eq(tarefas.responsavelId, colabId), eq(tarefas.criadoPor, colabId))!]
                : []),
            ),
          ),
      ]);

      const totaisPorDia = new Map<string, number>();
      for (const linha of [...compSemana, ...tarefasSemana]) {
        if (!linha.quando) continue;
        const key = dataHojeBR(fusoEscritorio, linha.quando as Date);
        totaisPorDia.set(key, (totaisPorDia.get(key) ?? 0) + 1);
      }
      const semana = chavesSemana.map((key) => ({
        data: key,
        total: totaisPorDia.get(key) ?? 0,
        hoje: key === hojeStr,
      }));

      // ─── CRM / Conversas ────────────────────────────────────
      // Mesma função que alimenta o badge do menu e os pills do Inbox.
      //
      // Contar direto em `conversas` parece equivalente e não é: a listagem
      // exclui arquivadas e faz INNER JOIN com contato e canal, então conversa
      // órfã (canal removido) ou arquivada não aparece em lugar nenhum da tela
      // — mas entrava neste COUNT. O painel dizia 47 aguardando enquanto o menu
      // e o Atendimento diziam 8.
      const contagemConversas = await contarConversasPorStatus(escritorioId, {
        ...(soProprios ? { atendenteId: colabId } : {}),
      });

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

      // Mesma contagem do badge do menu (`movimentacoes.contador`). Antes
      // este card contava `notificacoes` do usuário logado: como a
      // notificação só nasce para quem cadastrou o monitoramento, quem não
      // cadastrou nada via badge 10 e card 0 na mesma tela — e "marcar como
      // lida", que só toca em `eventos_processo`, zerava um e não o outro.
      const permProcessos = await checkPermission(ctx.user.id, "processos", "ver");
      const movimentacoesNaoLidas = permProcessos.allowed
        ? await contarMovimentacoesNaoLidas(escritorioId)
        : 0;

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
          totalHojeCount,
          // As listas acima vêm com LIMIT 5. Sem estes dois, o rodapé do card
          // contava o tamanho da lista e contradizia o número do topo.
          compromissosHojeCount,
          tarefasHojeCount,
          semana,
        },
        crm: {
          conversasAguardando: contagemConversas.aguardando,
          conversasAbertas: contagemConversas.em_atendimento,
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
   * Compromissos e tarefas de UM dia.
   *
   * Existe pro calendário do painel abrir o dia clicado ali mesmo. Mandar pra
   * /agenda funcionava, mas custava uma troca de tela inteira pra responder
   * "o que tem na quarta?" — pergunta que o card já estava mostrando pra hoje.
   */
  agendaDoDia: protectedProcedure
    .input(z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      const vazio = { compromissos: [], tarefas: [], totalCompromissos: 0, totalTarefas: 0 };
      const db = await getDb();
      if (!db) return vazio;

      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return vazio;

      const perm = await checkPermission(ctx.user.id, "dashboard", "ver");
      if (!perm.allowed) return vazio;
      const soProprios = !perm.verTodos && perm.verProprios;
      const escritorioId = esc.escritorio.id;
      const colabId = esc.colaborador.id;

      const fuso = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
      const inicio = inicioDoDiaNoFuso(input.data, fuso);
      const fim = new Date(inicio.getTime() + 86400000);

      try {
        const [compromissos, listaTarefas] = await Promise.all([
          db
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
                gte(agendamentos.dataInicio, inicio),
                lt(agendamentos.dataInicio, fim),
                or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento")),
                ...(soProprios
                  ? [or(eq(agendamentos.responsavelId, colabId), eq(agendamentos.criadoPorId, colabId))!]
                  : []),
              ),
            )
            .orderBy(asc(agendamentos.dataInicio)),
          db
            .select({
              id: tarefas.id,
              titulo: tarefas.titulo,
              prioridade: tarefas.prioridade,
            })
            .from(tarefas)
            .where(
              and(
                eq(tarefas.escritorioId, escritorioId),
                gte(tarefas.dataVencimento, inicio),
                lt(tarefas.dataVencimento, fim),
                or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")),
                ...(soProprios
                  ? [or(eq(tarefas.responsavelId, colabId), eq(tarefas.criadoPor, colabId))!]
                  : []),
              ),
            ),
        ]);

        // Os totais saem do tamanho REAL da consulta, e só depois a lista é
        // cortada. Contar o que sobrou depois do corte foi exatamente o que
        // fazia o rodapé do card contradizer o número do topo.
        return {
          compromissos: compromissos.slice(0, 8).map((c) => ({
            id: c.id,
            titulo: c.titulo,
            hora: (c.dataInicio as Date).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            tipo: c.tipo,
            cor: c.corHex,
          })),
          tarefas: listaTarefas.slice(0, 8).map((t) => ({
            id: t.id,
            titulo: t.titulo,
            prioridade: t.prioridade,
          })),
          totalCompromissos: compromissos.length,
          totalTarefas: listaTarefas.length,
        };
      } catch (err) {
        log.warn({ err: String(err) }, "Falha ao carregar agenda do dia");
        return vazio;
      }
    }),

  /**
   * De onde vêm os fechamentos: ranking das origens de lead que mais fecham.
   *
   * Recorte pelo `fechadoEm` (o instante em que virou ganho), não pelo
   * `updatedAt` — este último muda em qualquer edição do lead e faria um
   * negócio fechado em janeiro reaparecer no mês em que alguém corrigiu um
   * telefone.
   */
  desempenhoComercial: protectedProcedure.query(async ({ ctx }) => {
    const vazio = {
      campanhas: [] as Array<{ origem: string; fechamentos: number; valor: number }>,
      ganhos: 0,
      perdidos: 0,
      taxaGanho: null as number | null,
      valorGanho: 0,
    };

    const db = await getDb();
    if (!db) return vazio;

    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return vazio;

    const perm = await checkPermission(ctx.user.id, "dashboard", "ver");
    if (!perm.allowed) return vazio;
    const soProprios = !perm.verTodos && perm.verProprios;

    const fuso = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
    const periodo = resolverPeriodoNoFuso(new Date(), fuso);

    try {
      const fechados = await db
        .select({
          etapa: leads.etapaFunil,
          origem: leads.origemLead,
          valor: leads.valorEstimado,
        })
        .from(leads)
        .where(
          and(
            eq(leads.escritorioId, esc.escritorio.id),
            gte(leads.fechadoEm, periodo.dataInicio),
            lte(leads.fechadoEm, periodo.dataFim),
            or(eq(leads.etapaFunil, "fechado_ganho"), eq(leads.etapaFunil, "fechado_perdido")),
            ...(soProprios ? [eq(leads.responsavelId, esc.colaborador.id)] : []),
          ),
        );

      const porOrigem = new Map<string, { fechamentos: number; valor: number }>();
      let ganhos = 0;
      let perdidos = 0;
      let valorGanho = 0;

      for (const l of fechados) {
        if (l.etapa === "fechado_perdido") {
          perdidos += 1;
          continue;
        }
        ganhos += 1;
        const valor = parseValorBR(l.valor as string | null);
        valorGanho += valor;
        // Lead sem origem preenchida vira um balde próprio em vez de sumir do
        // ranking: "não informado" grande é em si um achado — significa que o
        // time não está marcando de onde vem o cliente.
        const chave = (l.origem ?? "").trim() || "Não informado";
        const atual = porOrigem.get(chave) ?? { fechamentos: 0, valor: 0 };
        atual.fechamentos += 1;
        atual.valor += valor;
        porOrigem.set(chave, atual);
      }

      const campanhas = Array.from(porOrigem.entries())
        .map(([origem, v]) => ({ origem, ...v }))
        .sort((a, b) => b.fechamentos - a.fechamentos || b.valor - a.valor)
        .slice(0, 3);

      const decididos = ganhos + perdidos;
      return {
        campanhas,
        ganhos,
        perdidos,
        taxaGanho: decididos > 0 ? +((ganhos / decididos) * 100).toFixed(1) : null,
        valorGanho,
      };
    } catch (err) {
      log.warn({ err: String(err) }, "Falha ao montar desempenho comercial");
      return vazio;
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
          days: z.number().int().min(1).max(365).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      // Sentinela única: os contadores precisam existir em TODA saída, senão
      // o painel mostra "—" em um caminho e 0 em outro pro mesmo estado.
      const VAZIO = {
        pontos: [] as Array<{ data: string; recebido: number; pendente: number; vencido: number }>,
        totalRecebido: 0,
        totalPendente: 0,
        totalVencido: 0,
        cobrancasPendentes: 0,
        cobrancasVencidas: 0,
        clientesVencidos: 0,
        pagamentosRecebidos: 0,
      };

      const db = await getDb();
      if (!db) return VAZIO;

      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return VAZIO;

      // Se só tem verProprios no dashboard, dados financeiros do
      // escritório não aparecem pra ele — retorna série vazia.
      const perm = await checkPermission(ctx.user.id, "dashboard", "ver");
      if (!perm.verTodos && perm.verProprios) {
        return VAZIO;
      }

      // Range ancorado no fuso do escritório (não no relógio UTC do server),
      // pra não "pular o dia 1" entre 21h–24h BRT. Sem `days`, usa o mês civil
      // corrente (dia 1 → hoje); com `days`, usa "últimos N dias".
      const tz = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
      const { inicioStr, pontosKeys } = resolverRangeCashFlow(new Date(), tz, input?.days);
      const hoje = dataHojeBR(tz);
      // Teto do período. Sem ele o filtro só tinha piso e "a receber, em dia"
      // somava toda parcela futura do escritório — parcela que vence no ano que
      // vem não é receita deste mês, mas entrava no card mesmo assim.
      const fimStr = pontosKeys.length > 0 ? fimDoMes(pontosKeys[0]!) : fimDoMes(hoje);

      try {
        // Critério "recebido": filtra por `dataPagamento` (quando foi
        // efetivamente pago), igual ao `asaas.cashFlowMensal` da página
        // Financeiro. Antes usava `createdAt` (data da row no DB) e somava
        // todas as cobranças pagas no carregamento — incluía pagamentos
        // de meses anteriores cujas cobranças foram criadas dentro do
        // range, divergindo do Financeiro. Para PENDING/OVERDUE usa
        // `vencimento` no range — mesmo critério da página Financeiro.
        const cobrancas = await db
          .select({
            valor: asaasCobrancas.valor,
            status: asaasCobrancas.status,
            vencimento: asaasCobrancas.vencimento,
            dataPagamento: asaasCobrancas.dataPagamento,
            contatoId: asaasCobrancas.contatoId,
          })
          .from(asaasCobrancas)
          .where(
            and(
              eq(asaasCobrancas.escritorioId, esc.escritorio.id),
              or(
                sql`${asaasCobrancas.status} IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')
                    AND COALESCE(${asaasCobrancas.dataPagamento}, ${asaasCobrancas.vencimento}) BETWEEN ${inicioStr} AND ${fimStr}`,
                sql`${asaasCobrancas.status} IN ('PENDING','OVERDUE')
                    AND ${asaasCobrancas.vencimento} BETWEEN ${inicioStr} AND ${fimStr}`,
              ),
            ),
          );

        // Agrupar por dia
        const porDia = new Map<string, { recebido: number; pendente: number; vencido: number }>();
        for (const key of pontosKeys) {
          porDia.set(key, { recebido: 0, pendente: 0, vencido: 0 });
        }

        let totalRecebido = 0;
        let totalPendente = 0;
        let totalVencido = 0;
        let cobrancasPendentes = 0;
        let cobrancasVencidas = 0;
        let pagamentosRecebidos = 0;
        // Contado aqui, no MESMO recorte do valor. O número de inadimplentes
        // que o painel mostrava vinha de outra procedure, sem recorte de
        // período — ficava "R$ 15 mil vencidos" ao lado de "579 clientes",
        // dois recortes diferentes lado a lado lidos como um só.
        const clientesVencidos = new Set<string>();

        for (const c of cobrancas) {
          const valor = parseFloat(c.valor) || 0;
          const pago = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status);
          const venceu =
            c.status === "OVERDUE" ||
            (c.status === "PENDING" && !!c.vencimento && c.vencimento < hoje);

          if (pago) {
            // Bucket de "recebido" é a data do pagamento (cai no dia certo
            // do gráfico). Total já está coberto pelo filtro WHERE — só
            // entram cobranças com dataPagamento (ou venc) >= inicioStr.
            totalRecebido += valor;
            pagamentosRecebidos += 1;
            const dia = (c.dataPagamento || c.vencimento || "").slice(0, 10);
            if (porDia.has(dia)) porDia.get(dia)!.recebido += valor;
          } else if (venceu) {
            totalVencido += valor;
            cobrancasVencidas += 1;
            if (c.contatoId) clientesVencidos.add(String(c.contatoId));
            // Vencido entra no gráfico pelo DIA DO VENCIMENTO — é a data em
            // que o dinheiro deveria ter entrado, que é o que a linha do
            // recebido responde no mesmo eixo.
            const dia = (c.vencimento || "").slice(0, 10);
            if (porDia.has(dia)) porDia.get(dia)!.vencido += valor;
          } else if (c.status === "PENDING") {
            totalPendente += valor;
            cobrancasPendentes += 1;
            const dia = (c.vencimento || "").slice(0, 10);
            if (porDia.has(dia)) porDia.get(dia)!.pendente += valor;
          }
        }

        const pontos = Array.from(porDia.entries()).map(([data, v]) => ({
          data,
          recebido: Math.round(v.recebido * 100) / 100,
          pendente: Math.round(v.pendente * 100) / 100,
          vencido: Math.round(v.vencido * 100) / 100,
        }));

        return {
          pontos,
          totalRecebido,
          totalPendente,
          totalVencido,
          cobrancasPendentes,
          cobrancasVencidas,
          clientesVencidos: clientesVencidos.size,
          pagamentosRecebidos,
        };
      } catch (err) {
        log.warn({ err: String(err) }, "Falha ao calcular cash flow");
        return VAZIO;
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
              timestamp: toIsoString(p.updatedAt) ?? "",
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
            timestamp: toIsoString(m.createdAt) ?? "",
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
            timestamp: toIsoString(t.concluidaAt) ?? "",
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
            timestamp: toIsoString(l.createdAt) ?? "",
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

      // Range: default = mês vigente NO FUSO do escritório (não no relógio UTC
      // do server). Bate com `relatorios.comercialDashboard`.
      const tz = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
      const { dataInicio, dataFim, dataInicioStr, dataFimStr } =
        resolverPeriodoNoFuso(new Date(), tz, input);

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
          gte(leads.fechadoEm, dataInicio),
          lte(leads.fechadoEm, dataFim),
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
          gte(leads.fechadoEm, dataInicio),
          lte(leads.fechadoEm, dataFim),
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
          clientesPagantes: sql<number>`COUNT(DISTINCT COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}))`,
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
          // Cliente real = COALESCE(beneficiário, pagador). Cobrança paga
          // pela esposa (contatoId) com beneficiário marido (quem fechou o
          // lead) precisa contar pro atendente. Sem COALESCE, o dashboard
          // contava só pelo pagador e divergia do relatório comercial.
          sql`COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}) IN (${contatosFechadosAtual})`,
        ))
        .groupBy(asaasCobrancas.atendenteId);

      const mapaPagos = new Map<number, { faturado: number; contratosPagos: number; clientesPagantes: number }>();
      for (const r of pagosRows) {
        if (r.atendenteId == null) continue;
        mapaPagos.set(Number(r.atendenteId), {
          faturado: Number(r.faturado || 0),
          contratosPagos: Number(r.contratosPagos || 0),
          clientesPagantes: Number(r.clientesPagantes || 0),
        });
      }

      const cardOf = (c: typeof todosComerciais[number]) => {
        const fechados = mapaFechados.get(c.id) ?? 0;
        const pagos = mapaPagos.get(c.id) ?? { faturado: 0, contratosPagos: 0, clientesPagantes: 0 };
        const metaTotal = c.metaMensal != null ? Number(c.metaMensal) : null;
        const metaPeriodo = proporcionalizarMeta(metaTotal, dataInicio, dataFim);
        const progressoMeta = calcularProgressoMeta(pagos.faturado, metaPeriodo);
        return {
          atendenteId: c.id,
          nome: c.userName || `#${c.id}`,
          setorNome: c.setorNome,
          contratosFechados: fechados,
          contratosPagos: pagos.contratosPagos,
          clientesPagantes: pagos.clientesPagantes,
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

      /**
       * Total do time contado de uma vez, e não somando as linhas do ranking.
       *
       * Duas razões. A primeira é aritmética: o DISTINCT do ranking vale
       * DENTRO de cada atendente, então um parcelamento com parcelas atribuídas
       * a dois atendentes era contado duas vezes na soma. A segunda é que o
       * relatório comercial mede CLIENTES e o painel mede CONTRATOS — sem os
       * dois números na mesma resposta, não há como a tela mostrar que 10
       * contratos e 9 clientes são o mesmo período, e a diferença vira
       * suspeita de dado errado.
       */
      const [totaisAgg] = verTodos
        ? await db
            .select({
              faturado: sql<number>`COALESCE(SUM(CAST(${asaasCobrancas.valor} AS DECIMAL(14,2))), 0)`,
              contratosPagos: sql<number>`COUNT(DISTINCT COALESCE(${asaasCobrancas.parcelamentoLocalId}, CAST(${asaasCobrancas.id} AS CHAR)))`,
              clientesPagantes: sql<number>`COUNT(DISTINCT COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId}))`,
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
        : [null];

      const totais = verTodos
        ? {
            faturado: Number(totaisAgg?.faturado || 0),
            contratosPagos: Number(totaisAgg?.contratosPagos || 0),
            clientesPagantes: Number(totaisAgg?.clientesPagantes || 0),
            contratosFechados: (ranking ?? []).reduce((s, c) => s + c.contratosFechados, 0),
            metaPeriodo: (ranking ?? []).reduce((s, c) => s + (c.metaPeriodo ?? 0), 0),
          }
        : null;

      return {
        periodo: { dataInicio: dataInicioStr, dataFim: dataFimStr },
        modo: verTodos ? ("gestor" as const) : ("individual" as const),
        meu,
        ranking,
        totais,
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

      // Range default = mês vigente NO FUSO do escritório (não no relógio UTC
      // do server, que virava o mês cedo demais na virada à noite BRT).
      const tz = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
      const { dataInicio, dataFim, dataInicioStr, dataFimStr } =
        resolverPeriodoNoFuso(new Date(), tz, input);
      const hojeStr = dataHojeBR(tz);

      // Só clientes que ESTE usuário pode ver no financeiro. Sem isso o
      // painel somava o escritório inteiro para quem tem dashboard.verTodos
      // mas financeiro.verProprios — a mesma pessoa via um caixa em
      // /financeiro e outro, maior, aqui.
      const visiveis = await contatosVisiveisFinanceiro(ctx.user.id, eid);
      if (visiveis !== null && visiveis.length === 0) return ZERO;
      const escopo = visiveis === null
        ? [eq(asaasCobrancas.escritorioId, eid)]
        : [eq(asaasCobrancas.escritorioId, eid), inArray(asaasCobrancas.contatoId, visiveis)];

      // KPIs agregados em SQL — mesmo padrão do `asaas.kpis`. Filtros:
      //   - recebido: status pago + dataPagamento no range
      //   - pendente: pendente + venc >= hoje + venc no range
      //   - vencido: (vencido OR pendente+venc<hoje) + venc no range
      //   - recebidoComVencimentoNoPeriodo: pago + venc no range
      //     (usado pra calcular % inadimplência por valor)
      //
      // Status vêm das constantes compartilhadas, não de lista literal: a
      // lista escrita à mão aqui ignorava DUNNING_RECEIVED (cliente que paga
      // após negativação), então dinheiro que /financeiro e o DRE contavam
      // sumia deste painel — e nem aparecia em "vencido", sumia inteiro.
      const valorDec = sql`CAST(${asaasCobrancas.valor} AS DECIMAL(20,2))`;
      const ehPago = inArray(asaasCobrancas.status, STATUS_PAGO_ASAAS as unknown as string[]);
      const ehPending = inArray(asaasCobrancas.status, STATUS_PENDENTE_ASAAS as unknown as string[]);
      const ehOverdue = inArray(asaasCobrancas.status, STATUS_VENCIDO_ASAAS as unknown as string[]);
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
        .where(and(...escopo));

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
        .where(and(...escopo, inRangeVenc));

      const [aggInadimplentes] = await db
        .select({
          inadimplentes: sql<number>`COUNT(DISTINCT ${asaasCobrancas.contatoId})`,
        })
        .from(asaasCobrancas)
        .where(and(
          ...escopo,
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
          // Quanto tempo a dívida está de pé separa "esqueceu de pagar" de
          // "não vai pagar" — duas conversas de cobrança diferentes, e o valor
          // sozinho não distingue as duas.
          vencimentoMaisAntigo: sql<string | null>`MIN(${asaasCobrancas.vencimento})`,
        })
        .from(asaasCobrancas)
        .innerJoin(contatos, eq(asaasCobrancas.contatoId, contatos.id))
        .where(and(
          ...escopo,
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
          vencimentoMaisAntigo: r.vencimentoMaisAntigo
            ? String(r.vencimentoMaisAntigo).slice(0, 10)
            : null,
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

      // Range default = mês vigente NO FUSO do escritório (não no relógio UTC
      // do server, que virava o mês cedo demais na virada à noite BRT).
      const tz = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;
      const { dataInicio, dataFim, dataInicioStr, dataFimStr } =
        resolverPeriodoNoFuso(new Date(), tz, input);

      // Corte único de atraso: a meia-noite de hoje no fuso do escritório.
      // Antes era `new Date()` — a hora exata —, então uma tarefa marcada
      // para hoje às 9h virava "atrasada" às 9h01 aqui e continuava no prazo
      // no badge da Agenda e no Painel Geral. Ver prazo-atrasado.ts.
      const agora = corteAtraso(tz);
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
