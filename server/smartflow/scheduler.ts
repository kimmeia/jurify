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

const log = createLogger("smartflow-scheduler");

const INTERVALO_MS = 60_000; // 60s

let intervalo: ReturnType<typeof setInterval> | null = null;

export async function rodarCicloScheduler(): Promise<{ retomadas: number; falhas: number }> {
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
  setTimeout(() => rodarCicloScheduler().catch(() => {}), 30_000);
  intervalo = setInterval(() => rodarCicloScheduler().catch(() => {}), INTERVALO_MS);
}

export function pararSchedulerSmartFlow() {
  if (!intervalo) return;
  clearInterval(intervalo);
  intervalo = null;
}
