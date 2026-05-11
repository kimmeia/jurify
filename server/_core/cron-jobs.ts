/**
 * Jobs agendados — Executados periodicamente via setInterval
 *
 * - Expirar assinaturas digitais vencidas (a cada 1h)
 * - Limpar sessões WhatsApp desconectadas (a cada 6h)
 * - Cobrar monitoramentos Judit mensais (a cada 6h)
 *
 * Registrar no index.ts: import { iniciarJobs } from "./cron-jobs"; iniciarJobs();
 */

import { getDb } from "../db";
import { assinaturasDigitais, agendamentos, tarefas, colaboradores, notificacoes } from "../../drizzle/schema";
import { eq, and, lt, sql, or, gte, lte, isNull } from "drizzle-orm";
import { syncTodosEscritorios, validarConexoesAsaasPendentes } from "../integracoes/asaas-sync";
import { processarSyncHistorico } from "../integracoes/asaas-sync-historico";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { createLogger } from "./logger";
const log = createLogger("_core-cron-jobs");

/** Marca assinaturas expiradas */
async function expirarAssinaturas() {
  try {
    const db = await getDb();
    if (!db) return;

    const result = await db.update(assinaturasDigitais)
      .set({ status: "expirado" })
      .where(and(
        or(
          eq(assinaturasDigitais.status, "pendente"),
          eq(assinaturasDigitais.status, "enviado"),
          eq(assinaturasDigitais.status, "visualizado"),
        ),
        lt(assinaturasDigitais.expiracaoAt, new Date()),
      ));

    const count = (result as { affectedRows?: number }[] | undefined)?.[0]?.affectedRows || 0;
    if (count > 0) log.info(`[Cron] ${count} assinatura(s) expirada(s)`);
  } catch (err: any) {
    log.error("[Cron] Erro ao expirar assinaturas:", err.message);
  }
}

/** Sincroniza cobranças do Asaas para todos os escritórios conectados */
async function syncAsaas() {
  try {
    await syncTodosEscritorios();
  } catch (err: any) {
    log.error("[Cron] Erro ao sincronizar Asaas:", err.message);
  }
}

/**
 * Notifica sobre compromissos e tarefas próximos do vencimento.
 * Verifica:
 * - Compromissos que começam nas próximas 1h
 * - Tarefas que vencem hoje e ainda não foram concluídas
 * - Compromissos e tarefas atrasados (cria notificação 1x)
 *
 * Evita duplicatas verificando se já existe notificação recente
 * com o mesmo título para o mesmo usuário.
 */
async function notificarPrazos() {
  try {
    const dbConn = await getDb();
    if (!dbConn) return;
    const db = dbConn;

    const now = new Date();
    const em1h = new Date(now.getTime() + 60 * 60 * 1000);
    const hojeInicio = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const hojeFim = new Date(hojeInicio.getTime() + 86400000);

    let notificadas = 0;

    // Helper: criar notificação se não duplicada nas últimas 12h
    const notificarSeNovo = async (userId: number, titulo: string, mensagem: string) => {
      const limite12h = new Date(now.getTime() - 12 * 60 * 60 * 1000);
      const [existente] = await db.select({ id: notificacoes.id }).from(notificacoes)
        .where(and(
          eq(notificacoes.userId, userId),
          eq(notificacoes.titulo, titulo),
          gte(notificacoes.createdAt, limite12h)
        )).limit(1);

      if (existente) return;

      await db.insert(notificacoes).values({
        userId,
        titulo,
        mensagem,
        tipo: "sistema",
      });
      notificadas++;
    };

    // Helper: obter userId do colaborador
    const getUserId = async (colabId: number): Promise<number | null> => {
      const [c] = await db.select({ userId: colaboradores.userId }).from(colaboradores)
        .where(eq(colaboradores.id, colabId)).limit(1);
      return c?.userId || null;
    };

    // ─── Compromissos que começam na próxima 1h ─────────────────────────
    const proximos = await db.select().from(agendamentos)
      .where(and(
        gte(agendamentos.dataInicio, now),
        lte(agendamentos.dataInicio, em1h),
        or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento"))
      ));

    for (const ag of proximos) {
      const userId = await getUserId(ag.responsavelId);
      if (!userId) continue;
      const hora = (ag.dataInicio as Date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      await notificarSeNovo(userId, `${ag.titulo} em breve`, `Compromisso às ${hora}: ${ag.titulo}`);
    }

    // ─── Tarefas que vencem hoje ────────────────────────────────────────
    const tarefasHoje = await db.select().from(tarefas)
      .where(and(
        gte(tarefas.dataVencimento, hojeInicio),
        lte(tarefas.dataVencimento, hojeFim),
        or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento"))
      ));

    for (const t of tarefasHoje) {
      if (!t.responsavelId) continue;
      const userId = await getUserId(t.responsavelId);
      if (!userId) continue;
      await notificarSeNovo(userId, `Tarefa vence hoje`, `"${t.titulo}" vence hoje.`);
    }

    // ─── Atrasados ──────────────────────────────────────────────────────
    const compromissosAtrasados = await db.select().from(agendamentos)
      .where(and(
        lt(agendamentos.dataInicio, hojeInicio),
        or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento"))
      ));

    for (const ag of compromissosAtrasados) {
      const userId = await getUserId(ag.responsavelId);
      if (!userId) continue;
      await notificarSeNovo(userId, `Compromisso atrasado`, `"${ag.titulo}" está atrasado.`);
    }

    const tarefasAtrasadas = await db.select().from(tarefas)
      .where(and(
        lt(tarefas.dataVencimento, hojeInicio),
        or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento"))
      ));

    for (const t of tarefasAtrasadas) {
      if (!t.responsavelId) continue;
      const userId = await getUserId(t.responsavelId);
      if (!userId) continue;
      await notificarSeNovo(userId, `Tarefa atrasada`, `"${t.titulo}" está atrasada.`);
    }

    if (notificadas > 0) log.info(`[Cron] ${notificadas} notificação(ões) de prazo criada(s)`);
  } catch (err: any) {
    log.error("[Cron] Erro ao notificar prazos:", err.message);
  }
}

/**
 * Marca cards do Kanban como atrasados quando o prazo vence.
 * Roda a cada 1h.
 */
async function verificarPrazosKanban() {
  try {
    const db = await getDb();
    if (!db) return;

    const { kanbanCards } = await import("../../drizzle/schema");
    const now = new Date();

    const result = await db.update(kanbanCards)
      .set({ atrasado: true })
      .where(
        and(
          eq(kanbanCards.atrasado, false),
          lt(kanbanCards.prazo, now),
        ),
      );

    const count = (result as any)?.[0]?.affectedRows || 0;
    if (count > 0) log.info(`[Cron] ${count} card(s) Kanban marcado(s) como atrasado(s)`);
  } catch (err: any) {
    log.error("[Cron] Erro ao verificar prazos Kanban:", err.message);
  }
}

/** Inicializa todos os jobs */
export function iniciarJobs() {
  log.info("[Cron] Jobs iniciados");

  // Lazy import dos crons motor próprio (evita carregar Playwright em
  // testes ou ambientes sem deps)
  const lazyMotorCrons = async () => {
    const m = await import("../processos/cron-monitoramento");
    return m;
  };

  // Executar imediatamente na inicialização (com delay)
  setTimeout(() => expirarAssinaturas(), 5000);
  setTimeout(() => syncAsaas(), 15000);
  setTimeout(async () => {
    try {
      const { cobrarMonitoramentosMensais } = await lazyMotorCrons();
      await cobrarMonitoramentosMensais();
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : err }, "[Cron] cobrarMonitoramentosMensais falhou");
    }
  }, 25000);
  setTimeout(async () => {
    try {
      const { pollMonitoramentosMovs } = await lazyMotorCrons();
      await pollMonitoramentosMovs();
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : err }, "[Cron] pollMonitoramentosMovs falhou");
    }
  }, 40000);
  setTimeout(() => notificarPrazos(), 20000);
  setTimeout(() => verificarPrazosKanban(), 35000);

  // A cada 1 hora: expirar assinaturas + verificar prazos kanban
  setInterval(() => expirarAssinaturas(), 60 * 60 * 1000);
  setInterval(() => verificarPrazosKanban(), 60 * 60 * 1000);

  // A cada 10 minutos: sincronizar cobranças do Asaas
  setInterval(() => syncAsaas(), 10 * 60 * 1000);

  // A cada 30 minutos: re-tenta validar configs Asaas em rate limit (429)
  setInterval(async () => {
    try {
      await validarConexoesAsaasPendentes();
    } catch (err: any) {
      log.error("[Cron] validarConexoesAsaasPendentes falhou:", err.message);
    }
  }, 30 * 60 * 1000);

  // A cada 5 minutos: processa 1 janela de sincronização histórica por
  // escritório elegível. Cada escritório controla seu próprio cooldown
  // entre janelas via `historicoSyncIntervaloMinutos`. Webhook cobre
  // eventos futuros — esta job só preenche o passado de forma controlada.
  setInterval(async () => {
    try {
      await processarSyncHistorico();
    } catch (err: any) {
      log.error("[Cron] processarSyncHistorico falhou:", err.message);
    }
  }, 5 * 60 * 1000);

  // A cada 6h: reset mensal de cota dos planos. Idempotente (só roda
  // pra escritórios cujo ultimoReset > 30 dias atrás). Soma cotaMensal
  // ao saldo (preserva sobras + pacotes pré-pagos).
  setInterval(async () => {
    try {
      const { resetCotaMensalEscritorios } = await import("../billing/escritorio-creditos");
      const { resetados } = await resetCotaMensalEscritorios();
      if (resetados > 0) log.info(`[Cron] resetCotaMensal: ${resetados} escritórios renovados`);
    } catch (err: any) {
      log.error("[Cron] resetCotaMensal falhou:", err.message);
    }
  }, 6 * 60 * 60 * 1000);

  // A cada 5 minutos: verificar prazos e notificar
  setInterval(() => notificarPrazos(), 5 * 60 * 1000);

  // ─── Motor próprio (Sprint 2 — 08/05/2026) ─────────────────────────────
  // A cada 1h: poll de monitoramentos de movimentações (recurrence default 6h)
  setInterval(async () => {
    try {
      const { pollMonitoramentosMovs } = await lazyMotorCrons();
      await pollMonitoramentosMovs();
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : err }, "[Cron] pollMonitoramentosMovs interval falhou");
    }
  }, 60 * 60 * 1000);

  // A cada 1h (offset de 30min): poll de novas ações (CPF/CNPJ)
  setInterval(async () => {
    try {
      const { pollMonitoramentosNovasAcoes } = await lazyMotorCrons();
      await pollMonitoramentosNovasAcoes();
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : err }, "[Cron] pollMonitoramentosNovasAcoes interval falhou");
    }
  }, 60 * 60 * 1000);

  // A cada 60 minutos: revalida credenciais ativas do cofre.
  // Sessões TJCE expiram em 90min — revalidamos a cada 75min pra
  // garantir sessão fresca antes do cron de monitoramento usar.
  // Inicia 90 segundos após boot pra não competir com outros jobs.
  setTimeout(async () => {
    try {
      const { revalidarCofreCredenciais } = await import("../escritorio/cron-revalidar-cofre");
      await revalidarCofreCredenciais();
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : err }, "[Cron] revalidarCofreCredenciais primeira falhou");
    }
  }, 90 * 1000);
  setInterval(async () => {
    try {
      const { revalidarCofreCredenciais } = await import("../escritorio/cron-revalidar-cofre");
      await revalidarCofreCredenciais();
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : err }, "[Cron] revalidarCofreCredenciais interval falhou");
    }
  }, 60 * 60 * 1000);

  // A cada 6h: cobrança mensal de monitoramentos
  setInterval(async () => {
    try {
      const { cobrarMonitoramentosMensais } = await lazyMotorCrons();
      await cobrarMonitoramentosMensais();
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : err }, "[Cron] cobrarMonitoramentosMensais interval falhou");
    }
  }, 6 * 60 * 60 * 1000);

  // Cron de monitoramento próprio entra em Sprint 2 (substitui antigo
  // cron Judit que cobrava monitoramentos mensais)

  // A cada 15 minutos: processar agendas de lançamento automático de
  // comissões. Worker decide internamente se cada agenda deve disparar
  // (compara dia+hora local com agora) e usa log com chave única pra
  // garantir idempotência.
  import("./cron-comissoes")
    .then(({ processarAgendasComissao }) => {
      setInterval(() => {
        processarAgendasComissao().catch((err) =>
          log.error({ err: String(err) }, "[Cron] Erro no worker de comissões"),
        );
      }, 15 * 60 * 1000);
      // Roda 1x na partida (com pequeno delay pra DB estar pronto)
      setTimeout(() => {
        processarAgendasComissao().catch((err) =>
          log.error({ err: String(err) }, "[Cron] Erro inicial no worker de comissões"),
        );
      }, 30_000);
    })
    .catch((err) => log.warn({ err: String(err) }, "[Cron] Falha ao iniciar worker de comissões"));

  // SmartFlow scheduler — retoma execuções pausadas no passo "esperar"
  import("../smartflow/scheduler")
    .then(({ iniciarSchedulerSmartFlow }) => iniciarSchedulerSmartFlow())
    .catch((err) => log.warn({ err: String(err) }, "[Cron] Falha ao iniciar SmartFlow scheduler"));

  // SmartFlow cobranças scheduler — cron diário p/ pagamento_vencido e
  // pagamento_proximo_vencimento
  import("../smartflow/cobrancas-scheduler")
    .then(({ iniciarCobrancasSchedulerSmartFlow }) => iniciarCobrancasSchedulerSmartFlow())
    .catch((err) => log.warn({ err: String(err) }, "[Cron] Falha ao iniciar SmartFlow cobranças scheduler"));

  // SmartFlow lembretes Cal.com — cron de 15min p/ agendamento_lembrete
  import("../smartflow/calcom-lembretes-scheduler")
    .then(({ iniciarCalcomLembretesScheduler }) => iniciarCalcomLembretesScheduler())
    .catch((err) => log.warn({ err: String(err) }, "[Cron] Falha ao iniciar SmartFlow lembretes Cal.com"));
}
