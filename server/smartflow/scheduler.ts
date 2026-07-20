/**
 * SmartFlow Scheduler — retoma execuções que pausaram no passo "esperar".
 *
 * Polling simples: a cada N segundos busca execuções com
 *   status = 'rodando' AND retomarEm IS NOT NULL AND retomarEm <= NOW()
 * e chama `retomarExecucao` pra continuar do próximo passo.
 *
 * É idempotente: se `retomarExecucao` falhar, marca a execução como erro
 * (evita reprocessar em loop).
 */

import { getDb } from "../db";
import { smartflowExecucoes } from "../../drizzle/schema";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { retomarExecucao } from "./dispatcher";
import { createLogger } from "../_core/logger";
import { captureError } from "../_core/sentry";

const log = createLogger("smartflow-scheduler");

/**
 * Reporta erros INESPERADOS escapados de `rodarCicloScheduler`. O try/catch
 * interno da função já trata erros previsíveis e retorna `{retomadas:0,
 * falhas:0}` — esse handler cobre rejeições que furam o try (ex: erro
 * async no `await getDb()` antes do try-block). Sem isso, o scheduler ia
 * parar silenciosamente em produção e o operador só descobriria horas/
 * dias depois (via reclamação "minha automação não roda").
 *
 * Exportada para teste em
 * `server/__tests__/smartflow-schedulers-error-handler.test.ts`.
 */
export function reportarErroInesperado(err: unknown): void {
  log.error(
    { err: err instanceof Error ? err.stack : String(err) },
    "[Scheduler] Erro inesperado escapou do ciclo — verifique se há rejeição async fora do try interno",
  );
  captureError(err, { kind: "smartflow-scheduler" });
}

const INTERVALO_MS = 60_000; // 60s

let intervalo: ReturnType<typeof setInterval> | null = null;

// Guard de reentrada: ciclo com passos lentos (LLM) pode passar de 60s e o
// setInterval sobrepor — mesma classe de bug do cron de monitoramento
// (cron-concurrency-guard). O claim atômico em retomarExecucao é a defesa
// principal; esta flag evita o desperdício de ciclos concorrentes.
let cicloRodando = false;

export async function rodarCicloScheduler(): Promise<{ retomadas: number; falhas: number }> {
  if (cicloRodando) return { retomadas: 0, falhas: 0 };
  cicloRodando = true;
  try {
    return await rodarCicloSchedulerInterno();
  } finally {
    cicloRodando = false;
  }
}

async function rodarCicloSchedulerInterno(): Promise<{ retomadas: number; falhas: number }> {
  const db = await getDb();
  if (!db) return { retomadas: 0, falhas: 0 };

  try {
    const agora = new Date();
    const pendentes = await db
      .select({ id: smartflowExecucoes.id })
      .from(smartflowExecucoes)
      .where(
        and(
          eq(smartflowExecucoes.status, "rodando"),
          isNotNull(smartflowExecucoes.retomarEm),
          lte(smartflowExecucoes.retomarEm, agora),
        ),
      )
      .limit(50);

    if (pendentes.length === 0) return { retomadas: 0, falhas: 0 };

    let retomadas = 0;
    let falhas = 0;
    for (const { id } of pendentes) {
      const r = await retomarExecucao(id);
      if (r.retomada) retomadas++;
      else falhas++;
    }

    if (retomadas > 0 || falhas > 0) {
      log.info({ retomadas, falhas }, "[Scheduler] Ciclo de retomada concluído");
    }

    return { retomadas, falhas };
  } catch (err: any) {
    log.error({ err: err.message }, "[Scheduler] Erro no ciclo");
    return { retomadas: 0, falhas: 0 };
  }
}

/**
 * Inicia o scheduler em background. Seguro chamar múltiplas vezes —
 * se já estiver ativo, não duplica.
 */
export function iniciarSchedulerSmartFlow() {
  if (intervalo) return;
  log.info({ intervaloMs: INTERVALO_MS }, "[Scheduler] SmartFlow scheduler iniciado");
  // Primeira execução após 30s pra dar tempo do servidor subir
  setTimeout(() => rodarCicloScheduler().catch(reportarErroInesperado), 30_000);
  intervalo = setInterval(
    () => rodarCicloScheduler().catch(reportarErroInesperado),
    INTERVALO_MS,
  );
}

export function pararSchedulerSmartFlow() {
  if (!intervalo) return;
  clearInterval(intervalo);
  intervalo = null;
}
