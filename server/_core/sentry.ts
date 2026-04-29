/**
 * Integração com Sentry — captura erros do servidor.
 *
 * Modos:
 *   - SENTRY_DSN definida: SDK ativo, envia eventos pro Sentry.
 *   - SENTRY_DSN vazia/ausente: SDK desligado (no-op). Útil em dev/teste sem
 *     ruído na conta do Sentry.
 *
 * Resolução de config: env var > banco (tabela `integracoesAdmin`, lida
 * lazy depois que o servidor sobe). Por enquanto ENV é a única fonte —
 * banco entra em iteração futura.
 *
 * Uso:
 *   - `initSentry()` no topo de `server/_core/index.ts` (antes de qualquer
 *     handler/migration), só uma vez.
 *   - `captureError(err, ctx?)` em pontos específicos (errorFormatter do
 *     tRPC, handlers globais de processo).
 */

import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { createLogger } from "./logger";

const log = createLogger("sentry");

let initialized = false;

export function initSentry(): void {
  if (initialized) return;

  const dsn = process.env.SENTRY_DSN_BACKEND || process.env.SENTRY_DSN;
  if (!dsn) {
    log.info("Sentry DSN não configurada — captura de erros desligada.");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || "dev",
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    integrations: [nodeProfilingIntegration()],
  });

  initialized = true;
  log.info({ env: process.env.NODE_ENV, release: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) }, "Sentry ativo");
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  if (context) {
    Sentry.withScope((scope) => {
      for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
      Sentry.captureException(err);
    });
  } else {
    Sentry.captureException(err);
  }
}

export function isSentryEnabled(): boolean {
  return initialized;
}
