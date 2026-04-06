/**
 * Logger estruturado baseado em pino.
 * Use em vez de console.log/warn/error para logging consistente.
 *
 * Exemplo:
 *   import { logger } from "../_core/logger";
 *   logger.info({ userId: 123 }, "Usuário autenticado");
 *   logger.error({ err }, "Falha ao processar pagamento");
 */

import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.apiKey",
      "*.secret",
      "*.authorization",
      "req.headers.cookie",
      "req.headers.authorization",
    ],
    censor: "[REDACTED]",
  },
});

/** Cria um child logger com contexto adicional (ex: por módulo). */
export function createLogger(module: string) {
  return logger.child({ module });
}
