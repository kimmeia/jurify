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
import { assinaturasDigitais, agendamentos, tarefas, colaboradores, notificacoes,
  juditMonitoramentos, juditCreditos, juditTransacoes } from "../../drizzle/schema";
import { eq, and, lt, sql, or, gte, lte, isNull } from "drizzle-orm";
import { syncTodosEscritorios } from "../integracoes/asaas-sync";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { CUSTOS_JUDIT } from "../routers/judit-credit-calc";
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
 * Cobrança mensal recorrente dos monitoramentos Judit.
 *
 * A Judit nos cobra mensalmente por cada monitoramento ativo. Então
 * precisamos repassar esse custo aos escritórios. O cron roda a cada
 * 6h e cobra monitoramentos cuja última cobrança foi >= 30 dias atrás
 * (ou que nunca foram cobrados, ultimaCobrancaMensal = null, E criados
 * há mais de 30 dias).
 *
 * Se o escritório não tem créditos suficientes, o monitoramento é
 * PAUSADO automaticamente e uma notificação é criada.
 */
async function cobrarMonitoramentosMensais() {
  try {
    const db = await getDb();
    if (!db) return;

    const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Busca monitoramentos ativos que precisam de cobrança mensal:
    // - status ativo (created/updating/updated)
    // - ultimaCobrancaMensal é null E createdAt < 30 dias atrás (primeira cobrança mensal)
    //   OU ultimaCobrancaMensal < 30 dias atrás (renovação)
    const pendentes = await db
      .select()
      .from(juditMonitoramentos)
      .where(
        and(
          or(
            eq(juditMonitoramentos.statusJudit, "created"),
            eq(juditMonitoramentos.statusJudit, "updating"),
            eq(juditMonitoramentos.statusJudit, "updated"),
          ),
          or(
            // Nunca cobrou mensal + criado há mais de 30 dias
            and(
              isNull(juditMonitoramentos.ultimaCobrancaMensal),
              lt(juditMonitoramentos.createdAt, trintaDiasAtras),
            ),
            // Última cobrança há mais de 30 dias
            lt(juditMonitoramentos.ultimaCobrancaMensal, trintaDiasAtras),
          ),
        ),
      );

    if (pendentes.length === 0) return;

    let cobrados = 0;
    let pausados = 0;

    for (const mon of pendentes) {
      if (!mon.clienteUserId) continue;

      // Resolve escritório
      const esc = await getEscritorioPorUsuario(mon.clienteUserId);
      if (!esc) {
        log.warn({ monId: mon.id, userId: mon.clienteUserId }, "Cron mensal: escritório não encontrado");
        continue;
      }

      const custo =
        mon.tipoMonitoramento === "novas_acoes"
          ? CUSTOS_JUDIT.monitorar_pessoa_mes
          : CUSTOS_JUDIT.monitorar_processo_mes;

      // Verifica saldo
      const [cr] = await db
        .select()
        .from(juditCreditos)
        .where(eq(juditCreditos.escritorioId, esc.escritorio.id))
        .limit(1);
      const saldo = cr?.saldo ?? 0;

      if (saldo < custo) {
        // Créditos insuficientes — pausar monitoramento
        await db
          .update(juditMonitoramentos)
          .set({ statusJudit: "paused" })
          .where(eq(juditMonitoramentos.id, mon.id));

        // Tenta pausar na Judit também (best-effort)
        try {
          const { getJuditClient } = await import("../integracoes/judit-webhook");
          const client = await getJuditClient();
          if (client) await client.pausarMonitoramento(mon.trackingId);
        } catch {
          /* best-effort */
        }

        // Notifica o usuário
        try {
          await db.insert(notificacoes).values({
            userId: mon.clienteUserId,
            titulo: "Monitoramento pausado por falta de créditos",
            mensagem: `O monitoramento "${mon.apelido || mon.searchKey}" foi pausado porque seu saldo de créditos é insuficiente (necessário: ${custo}, disponível: ${saldo}). Recarregue seus créditos para reativar.`,
            tipo: "sistema",
          });
        } catch {
          /* best-effort */
        }

        pausados++;
        continue;
      }

      // Cobra os créditos
      const novoSaldo = saldo - custo;
      await db
        .update(juditCreditos)
        .set({
          saldo: novoSaldo,
          totalConsumido: (cr?.totalConsumido || 0) + custo,
        })
        .where(eq(juditCreditos.escritorioId, esc.escritorio.id));

      await db.insert(juditTransacoes).values({
        escritorioId: esc.escritorio.id,
        tipo: "consumo",
        quantidade: custo,
        saldoAnterior: saldo,
        saldoDepois: novoSaldo,
        operacao: mon.tipoMonitoramento === "novas_acoes"
          ? "monitoramento_novas_acoes_mensal"
          : "monitoramento_processo_mensal",
        detalhes: `Cobrança mensal: ${mon.apelido || mon.searchKey} (${custo} créditos)`,
        userId: mon.clienteUserId,
      });

      // Marca como cobrado
      await db
        .update(juditMonitoramentos)
        .set({ ultimaCobrancaMensal: new Date() })
        .where(eq(juditMonitoramentos.id, mon.id));

      cobrados++;
    }

    if (cobrados > 0 || pausados > 0) {
      log.info(
        { cobrados, pausados, total: pendentes.length },
        "[Cron] Cobrança mensal de monitoramentos Judit concluída",
      );
    }
  } catch (err: any) {
    log.error("[Cron] Erro na cobrança mensal de monitoramentos:", err.message);
  }
}

/** Inicializa todos os jobs */
export function iniciarJobs() {
  log.info("[Cron] Jobs iniciados");

  // Executar imediatamente na inicialização (com delay)
  setTimeout(() => expirarAssinaturas(), 5000);
  setTimeout(() => syncAsaas(), 15000);
  setTimeout(() => notificarPrazos(), 20000);
  setTimeout(() => cobrarMonitoramentosMensais(), 30000);

  // A cada 1 hora: expirar assinaturas
  setInterval(() => expirarAssinaturas(), 60 * 60 * 1000);

  // A cada 10 minutos: sincronizar cobranças do Asaas
  setInterval(() => syncAsaas(), 10 * 60 * 1000);

  // A cada 5 minutos: verificar prazos e notificar
  setInterval(() => notificarPrazos(), 5 * 60 * 1000);

  // A cada 6 horas: cobrar monitoramentos mensais da Judit
  setInterval(() => cobrarMonitoramentosMensais(), 6 * 60 * 60 * 1000);
}
