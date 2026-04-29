/**
 * Rate limiting simples em memória (sliding window).
 * Para múltiplas instâncias, usar Redis no futuro.
 */

import type { Request, Response, NextFunction } from "express";

const WINDOW_MS = 60_000; // 1 minuto
const CLEANUP_THRESHOLD = 10_000;

interface Entry {
  count: number;
  resetAt: number;
}

const stores: Map<string, Map<string, Entry>> = new Map();

function getStore(name: string): Map<string, Entry> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

function getClientKey(req: Request): string {
  // Respeita X-Forwarded-For se configurado via trust proxy
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Cria um middleware de rate limit.
 *
 * @param options.name - Nome do bucket (separa limites entre rotas)
 * @param options.max - Número máximo de requisições por janela
 * @param options.windowMs - Janela em ms (default 60s)
 */
export function rateLimit(options: {
  name: string;
  max: number;
  windowMs?: number;
}) {
  const windowMs = options.windowMs ?? WINDOW_MS;
  const store = getStore(options.name);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = getClientKey(req);
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count++;
      if (entry.count > options.max) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        res.setHeader("Retry-After", String(retryAfter));
        res
          .status(429)
          .json({ error: "Muitas requisições. Tente novamente mais tarde." });
        return;
      }
    }

    // Cleanup eventual
    if (store.size > CLEANUP_THRESHOLD) {
      Array.from(store.entries()).forEach(([k, v]) => {
        if (now > v.resetAt) store.delete(k);
      });
    }

    next();
  };
}

/** Middleware global com limite generoso para todas as rotas tRPC autenticadas. */
export const globalApiRateLimit = rateLimit({
  name: "global-api",
  max: 300, // 300 req/min por IP
});

/** Limite mais rígido para operações de escrita. */
export const writeRateLimit = rateLimit({
  name: "write",
  max: 60, // 60 mutations/min por IP
});

/**
 * Rate limit programático — pra uso DENTRO de procedures tRPC, onde a
 * gente quer chavear por algo além do IP (ex: IP+email pra brute force
 * de login). Retorna `{ allowed, retryAfter }`. Se `allowed=false`, o
 * caller deve lançar TRPCError com TOO_MANY_REQUESTS.
 *
 * Compartilha o mesmo `stores` do middleware Express.
 */
export function consume(opts: {
  name: string;
  key: string;
  max: number;
  windowMs: number;
}): { allowed: boolean; retryAfter: number } {
  const store = getStore(opts.name);
  const now = Date.now();
  const entry = store.get(opts.key);

  if (!entry || now > entry.resetAt) {
    store.set(opts.key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  entry.count++;
  if (entry.count > opts.max) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/**
 * Reseta o contador pra uma chave — útil em login bem-sucedido pra
 * não penalizar usuário legítimo que errou senha algumas vezes.
 */
export function reset(name: string, key: string): void {
  const store = stores.get(name);
  store?.delete(key);
}
