/**
 * Wrapper de Sentry para os PoCs do Spike.
 *
 * Reusa a infraestrutura de `server/_core/sentry.ts` mas adiciona tags
 * específicas do Spike (worker name, PoC number, tribunal) para que
 * eventos não se misturem com erros normais do servidor no Sentry.
 *
 * Modo opt-in: se SENTRY_DSN não estiver definida, vira no-op silencioso.
 * Útil pra rodar PoC localmente sem poluir conta de Sentry.
 *
 * Uso:
 *   import { initSpikeSentry, captureSpikeError, withSpan } from "../lib/sentry-spike";
 *   initSpikeSentry({ pocId: 1, workerName: "spike-pje-scraper" });
 *
 *   try {
 *     await withSpan("scrape_processo", { tribunal: "trt2", cnj }, async () => {
 *       // ... operação
 *     });
 *   } catch (err) {
 *     captureSpikeError(err, { tribunal: "trt2", cnj, etapa: "buscar" });
 *   }
 */

import * as Sentry from "@sentry/node";

interface SpikeContext {
  pocId: 1 | 2 | 3 | 4;
  workerName: string;
}

let spikeContext: SpikeContext | null = null;
let initialized = false;

export function initSpikeSentry(ctx: SpikeContext): void {
  if (initialized) {
    spikeContext = ctx;
    return;
  }

  const dsn = process.env.SENTRY_DSN_BACKEND || process.env.SENTRY_DSN;
  if (!dsn) {
    spikeContext = ctx;
    return;
  }

  Sentry.init({
    dsn,
    // Marca eventos do Spike como "staging" mesmo se NODE_ENV=development —
    // assim queries do Sentry filtram facilmente erros do Spike sem
    // confundir com erros de produção.
    environment: process.env.JURIFY_AMBIENTE || process.env.NODE_ENV || "spike",
    release: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || "spike-local",
    tracesSampleRate: 1.0,
    profilesSampleRate: 0.0,
    initialScope: {
      tags: {
        spike: "motor-proprio",
        spike_poc: String(ctx.pocId),
        spike_worker: ctx.workerName,
      },
    },
  });

  initialized = true;
  spikeContext = ctx;
}

export function captureSpikeError(err: unknown, extra?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (spikeContext) {
      scope.setTag("spike_poc", String(spikeContext.pocId));
      scope.setTag("spike_worker", spikeContext.workerName);
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) scope.setExtra(k, v);
    }
    Sentry.captureException(err);
  });
}

/**
 * Envolve operação numa span do Sentry. Mede latência e captura erro.
 * Sem Sentry inicializado, executa a função normalmente.
 *
 * Uso pra medir partes específicas (login, busca, parse) e ver no
 * Performance do Sentry quais etapas são gargalo.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!initialized) return fn();

  return Sentry.startSpan({ name, op: "spike.task", attributes }, async () => {
    return fn();
  });
}

export function isSpikeSentryEnabled(): boolean {
  return initialized;
}

export async function flushSpikeSentry(timeoutMs = 5000): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(timeoutMs);
}
