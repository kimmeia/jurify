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
import { syncTodosEscritorios } from "../integracoes/asaas-sync";
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

  // Executar imediatamente na inicialização (com delay)
  setTimeout(() => expirarAssinaturas(), 5000);
  setTimeout(() => syncAsaas(), 15000);
  setTimeout(() => notificarPrazos(), 20000);
  setTimeout(() => verificarPrazosKanban(), 35000);

  // A cada 1 hora: expirar assinaturas + verificar prazos kanban
  setInterval(() => expirarAssinaturas(), 60 * 60 * 1000);
  setInterval(() => verificarPrazosKanban(), 60 * 60 * 1000);

  // A cada 10 minutos: sincronizar cobranças do Asaas
  setInterval(() => syncAsaas(), 10 * 60 * 1000);

  // A cada 5 minutos: verificar prazos e notificar
  setInterval(() => notificarPrazos(), 5 * 60 * 1000);

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
