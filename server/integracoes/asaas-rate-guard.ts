/**
 * AsaasRateGuard — defesa em camadas pra nunca estourar os limites
 * de rate da API do Asaas.
 *
 * O Asaas tem 3 limites simultâneos (docs.asaas.com):
 *   1) `RateLimit-Limit` por endpoint (varia, vem no header da response)
 *   2) 25.000 requests por janela rolante de 12h
 *   3) 50 GETs simultâneos
 *
 * Estouro de qualquer um deles = 12h de bloqueio HTTP 429. Por isso usamos
 * margem agressiva (20% sobre cota, 30/50 sobre concorrência) e bloqueio
 * preemptivo baseado nos headers retornados pelo Asaas.
 *
 * 4 camadas:
 *   Camada 1 — Headers `RateLimit-Remaining` / `RateLimit-Reset` por endpoint
 *              (fonte da verdade — vem direto do Asaas a cada response).
 *   Camada 2 — Cota global 12h. Contador in-memory + persistido em DB
 *              (`asaas_rate_state`) pra sobreviver a restart.
 *   Camada 3 — Concorrência: max 30 GETs simultâneos.
 *   Camada 4 — Janela curta 60s (150 reqs) como último anteparo local.
 *
 * Uso:
 *   const guard = AsaasRateGuard.forApiKey(apiKey);
 *   await guard.acquire(method, urlPath);   // pode esperar ou lançar 429
 *   try { ...request... }
 *   finally { guard.release(method); }
 *   guard.recordResponse(urlPath, responseHeaders);
 *
 * Singleton por hash de API key — múltiplas instâncias de AsaasClient com a
 * mesma key compartilham o estado (importante: cada instância via tem 1 guard).
 */

import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { asaasRateState } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("asaas-rate-guard");

// ─── Constantes de limite ───────────────────────────────────────────────────

/** Cota local 12h. Asaas permite 25k — margem de 20% absorve race entre
 *  instâncias e overshoot entre flushes no DB. */
const QUOTA_LIMITE_LOCAL = 20_000;
const QUOTA_JANELA_MS = 12 * 60 * 60 * 1_000;

/** A partir deste threshold, valida no DB antes de prosseguir (defesa
 *  multi-instance). */
const QUOTA_THRESHOLD_VALIDAR_DB = 18_000;

/** Concorrência: Asaas limita 50 GETs simultâneos. Margem de 30 evita
 *  race em retries/timeouts. */
const CONCORRENCIA_MAX = 30;

/** Janela curta 60s (Camada 4) — limite local final. */
const JANELA_CURTA_MS = 60_000;
const JANELA_CURTA_MAX = 150;

/** Margem de segurança nos headers do Asaas (Camada 1). Quando o Asaas
 *  diz `remaining <= 10`, paramos preemptivamente até o reset. */
const REMAINING_THRESHOLD = 10;

/** Persiste no DB a cada N requests (reduz carga). */
const FLUSH_DB_INTERVAL = 50;

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface EndpointLimit {
  remaining: number;
  resetAt: number; // epoch ms
}

interface PersistedState {
  quotaWindowStart: number;
  quotaCount: number;
  lastEndpointLimits: Record<string, EndpointLimit>;
}

class RateLimitError extends Error {
  constructor(
    public readonly camada: 1 | 2 | 3 | 4,
    public readonly waitMs: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "RateLimitError";
  }
}

export { RateLimitError };

// ─── Helpers ────────────────────────────────────────────────────────────────

function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Normaliza a URL pra agrupar endpoints. `/payments/pay_123` → `/payments/:id`.
 * Mantém apenas o "tipo" do endpoint pra contar limite por categoria.
 */
function normalizeEndpoint(url: string): string {
  let path = url.split("?")[0];
  if (!path.startsWith("/")) path = "/" + path;
  return path
    .replace(/\/(cus|pay|sub|ins)_[A-Za-z0-9]+/g, "/:id")
    .replace(/\/\d+/g, "/:id");
}

function agora(): number {
  return Date.now();
}

// ─── Guard ──────────────────────────────────────────────────────────────────

class AsaasRateGuardImpl {
  private apiKeyHash: string;

  // Camada 1: estado por endpoint (vindo dos headers do Asaas)
  private endpointLimits: Map<string, EndpointLimit> = new Map();

  // Camada 2: cota 12h
  private quotaWindowStart: number = agora();
  private quotaCount: number = 0;
  private flushPendingCount: number = 0;
  private loadPromise: Promise<void> | null = null;

  // Camada 3: concorrência
  private inflight: number = 0;
  private waitQueue: Array<() => void> = [];

  // Camada 4: janela 60s
  private janelaCurtaInicio: number = agora();
  private janelaCurtaCount: number = 0;

  constructor(apiKey: string) {
    this.apiKeyHash = hashApiKey(apiKey);
    this.loadPromise = this.loadFromDb();
  }

  // ─── Load/persist DB ──────────────────────────────────────────────────────

  private async loadFromDb(): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;
      const [row] = await db
        .select()
        .from(asaasRateState)
        .where(eq(asaasRateState.apiKeyHash, this.apiKeyHash))
        .limit(1);
      if (!row) return;

      const now = agora();
      const windowStart = Number(row.quotaWindowStart);
      // Se a janela passou de 12h, recomeça
      if (now - windowStart >= QUOTA_JANELA_MS) {
        this.quotaWindowStart = now;
        this.quotaCount = 0;
      } else {
        this.quotaWindowStart = windowStart;
        this.quotaCount = row.quotaCount;
      }

      const limits = (row.lastEndpointLimits as Record<string, EndpointLimit>) || {};
      for (const [endpoint, lim] of Object.entries(limits)) {
        // Descarta limites já expirados
        if (lim.resetAt > now) {
          this.endpointLimits.set(endpoint, lim);
        }
      }
    } catch (err) {
      log.warn({ err: String(err) }, "Falha ao carregar estado do rate guard");
    }
  }

  private async flushToDb(): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;
      const limitsObj: Record<string, EndpointLimit> = {};
      for (const [k, v] of this.endpointLimits.entries()) {
        limitsObj[k] = v;
      }
      await db
        .insert(asaasRateState)
        .values({
          apiKeyHash: this.apiKeyHash,
          quotaWindowStart: this.quotaWindowStart,
          quotaCount: this.quotaCount,
          lastEndpointLimits: limitsObj,
        })
        .onDuplicateKeyUpdate({
          set: {
            quotaWindowStart: this.quotaWindowStart,
            quotaCount: this.quotaCount,
            lastEndpointLimits: limitsObj,
          },
        });
    } catch (err) {
      log.warn({ err: String(err) }, "Falha ao persistir estado do rate guard");
    }
  }

  /** Lê APENAS o quotaCount/windowStart do DB. Usado quando local >= threshold
   *  pra confirmar com o estado persistido (defesa multi-instance). */
  private async refreshQuotaFromDb(): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;
      const [row] = await db
        .select({
          quotaWindowStart: asaasRateState.quotaWindowStart,
          quotaCount: asaasRateState.quotaCount,
        })
        .from(asaasRateState)
        .where(eq(asaasRateState.apiKeyHash, this.apiKeyHash))
        .limit(1);
      if (!row) return;
      const now = agora();
      const dbWindowStart = Number(row.quotaWindowStart);
      if (now - dbWindowStart >= QUOTA_JANELA_MS) {
        // DB também está expirado — reset local
        this.quotaWindowStart = now;
        this.quotaCount = 0;
        return;
      }
      // Pega o MAIOR dos dois (mais conservador)
      if (row.quotaCount > this.quotaCount) {
        this.quotaCount = row.quotaCount;
      }
      if (dbWindowStart < this.quotaWindowStart) {
        this.quotaWindowStart = dbWindowStart;
      }
    } catch (err) {
      log.warn({ err: String(err) }, "Falha ao revalidar cota no DB");
    }
  }

  // ─── Rotinas de manutenção ────────────────────────────────────────────────

  /** Reseta janelas que já passaram. */
  private rolarJanelas(): void {
    const now = agora();
    if (now - this.quotaWindowStart >= QUOTA_JANELA_MS) {
      this.quotaWindowStart = now;
      this.quotaCount = 0;
    }
    if (now - this.janelaCurtaInicio >= JANELA_CURTA_MS) {
      this.janelaCurtaInicio = now;
      this.janelaCurtaCount = 0;
    }
    // Limpa endpoint limits expirados
    for (const [k, v] of this.endpointLimits.entries()) {
      if (v.resetAt <= now) {
        this.endpointLimits.delete(k);
      }
    }
  }

  // ─── API pública ──────────────────────────────────────────────────────────

  /**
   * Adquire um slot pra fazer 1 request. Pode esperar (concorrência) ou
   * lançar `RateLimitError` (Camadas 1, 2, 4 — não retentamos).
   */
  async acquire(method: string, url: string): Promise<void> {
    // Espera o load inicial do DB se ainda não terminou
    if (this.loadPromise) {
      try { await this.loadPromise; } catch { /* ignora */ }
      this.loadPromise = null;
    }

    this.rolarJanelas();
    const endpoint = normalizeEndpoint(url);
    const now = agora();
    const isGet = method.toUpperCase() === "GET";

    // Camada 1: headers por endpoint (preemptivo)
    const lim = this.endpointLimits.get(endpoint);
    if (lim && lim.remaining <= REMAINING_THRESHOLD && lim.resetAt > now) {
      const wait = lim.resetAt - now + 1_000;
      log.warn(
        { endpoint, remaining: lim.remaining, waitMs: wait },
        "Rate guard: Camada 1 — endpoint próximo do limite, bloqueando",
      );
      throw new RateLimitError(
        1,
        wait,
        `Rate limit do endpoint ${endpoint} próximo do limite. Aguarde ${Math.ceil(wait / 1000)}s.`,
      );
    }

    // Camada 2: cota 12h global
    if (this.quotaCount >= QUOTA_THRESHOLD_VALIDAR_DB) {
      await this.refreshQuotaFromDb();
    }
    if (this.quotaCount >= QUOTA_LIMITE_LOCAL) {
      const wait = this.quotaWindowStart + QUOTA_JANELA_MS - now;
      log.warn(
        { count: this.quotaCount, waitMs: wait },
        "Rate guard: Camada 2 — cota 12h estourada, bloqueando",
      );
      throw new RateLimitError(
        2,
        wait,
        `Cota 12h do Asaas próxima do limite (${this.quotaCount}/${QUOTA_LIMITE_LOCAL}). Aguarde ${Math.ceil(wait / 60_000)}min.`,
      );
    }

    // Camada 4: janela curta 60s
    if (this.janelaCurtaCount >= JANELA_CURTA_MAX) {
      const wait = this.janelaCurtaInicio + JANELA_CURTA_MS - now;
      log.warn(
        { count: this.janelaCurtaCount, waitMs: wait },
        "Rate guard: Camada 4 — janela 60s estourada, bloqueando",
      );
      throw new RateLimitError(
        4,
        wait,
        `Rate limit local (60s) atingido. Aguarde ${Math.ceil(wait / 1000)}s.`,
      );
    }

    // Camada 3: concorrência (apenas GETs)
    if (isGet) {
      if (this.inflight >= CONCORRENCIA_MAX) {
        await new Promise<void>((resolve) => this.waitQueue.push(resolve));
      }
      this.inflight++;
    }

    // Conta o request agora (após passar todas as camadas)
    this.quotaCount++;
    this.janelaCurtaCount++;
    this.flushPendingCount++;

    // Flush periódico no DB (a cada FLUSH_DB_INTERVAL)
    if (this.flushPendingCount >= FLUSH_DB_INTERVAL) {
      this.flushPendingCount = 0;
      void this.flushToDb();
    }
  }

  /** Libera o slot de concorrência. Chame no finally (sucesso ou erro). */
  release(method: string): void {
    const isGet = method.toUpperCase() === "GET";
    if (!isGet) return;
    this.inflight = Math.max(0, this.inflight - 1);
    const next = this.waitQueue.shift();
    if (next) next();
  }

  /**
   * Captura `RateLimit-Remaining` e `RateLimit-Reset` da response.
   * `RateLimit-Reset` vem em segundos relativos ao now (ex: 60 = reset em 60s).
   */
  recordResponse(url: string, headers: Record<string, unknown>): void {
    const endpoint = normalizeEndpoint(url);
    const remainingRaw =
      headers["ratelimit-remaining"] ?? headers["RateLimit-Remaining"];
    const resetRaw = headers["ratelimit-reset"] ?? headers["RateLimit-Reset"];
    if (remainingRaw == null || resetRaw == null) return;

    const remaining = Number(remainingRaw);
    const resetSec = Number(resetRaw);
    if (!Number.isFinite(remaining) || !Number.isFinite(resetSec)) return;

    const resetAt = agora() + Math.max(0, resetSec) * 1_000;
    this.endpointLimits.set(endpoint, { remaining, resetAt });

    if (remaining <= 5) {
      log.warn(
        { endpoint, remaining, resetSec },
        "Rate guard: endpoint quase esgotado",
      );
    }
  }

  /**
   * Quando o Asaas devolve 429, força bloqueio defensivo. Asaas pode mandar
   * `RateLimit-Reset` ou simplesmente 429 sem mais detalhes — assumimos
   * janela 12h no pior caso.
   */
  recordRateLimitError(url: string, retryAfterSec?: number): void {
    const endpoint = normalizeEndpoint(url);
    const wait = retryAfterSec
      ? Math.max(retryAfterSec, 60)
      : 12 * 60 * 60;
    const resetAt = agora() + wait * 1_000;
    this.endpointLimits.set(endpoint, { remaining: 0, resetAt });
    // Também marca cota próxima do limite pra outras chamadas serem cautelosas
    if (this.quotaCount < QUOTA_LIMITE_LOCAL) {
      this.quotaCount = QUOTA_LIMITE_LOCAL;
    }
    log.error({ endpoint, waitSec: wait }, "Rate guard: Asaas retornou 429");
    void this.flushToDb();
  }

  // ─── Snapshot pra testes/telemetria ──────────────────────────────────────

  snapshot(): PersistedState & {
    inflight: number;
    janelaCurtaCount: number;
  } {
    return {
      quotaWindowStart: this.quotaWindowStart,
      quotaCount: this.quotaCount,
      lastEndpointLimits: Object.fromEntries(this.endpointLimits.entries()),
      inflight: this.inflight,
      janelaCurtaCount: this.janelaCurtaCount,
    };
  }
}

// ─── Singleton por API key ─────────────────────────────────────────────────

const instancias = new Map<string, AsaasRateGuardImpl>();

export const AsaasRateGuard = {
  forApiKey(apiKey: string): AsaasRateGuardImpl {
    const hash = hashApiKey(apiKey);
    let inst = instancias.get(hash);
    if (!inst) {
      inst = new AsaasRateGuardImpl(apiKey);
      instancias.set(hash, inst);
    }
    return inst;
  },
  /** Apenas pra testes — reseta o singleton inteiro. */
  __resetParaTestes(): void {
    instancias.clear();
  },
};

export type AsaasRateGuardInstance = AsaasRateGuardImpl;
