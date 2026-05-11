/**
 * Testes — AsaasRateGuard (defesa em 4 camadas contra rate limit do Asaas).
 *
 * Estratégia: mocka `getDb` pra null (sem persistência) e testa as
 * 4 camadas isoladas. Snapshot do guard checa estado interno após cada
 * ação.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));

const { AsaasRateGuard, RateLimitError } = await import(
  "../integracoes/asaas-rate-guard"
);

const API_KEY = "$aact_sandbox_test_key_unique";

describe("AsaasRateGuard — Camada 1 (headers do Asaas)", () => {
  beforeEach(() => {
    AsaasRateGuard.__resetParaTestes();
  });

  it("bloqueia próxima request quando RateLimit-Remaining <= 10", async () => {
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    await guard.acquire("GET", "/payments");
    guard.release("GET");

    // Asaas mandou: restam 5 e reseta em 60s
    guard.recordResponse("/payments", {
      "ratelimit-remaining": "5",
      "ratelimit-reset": "60",
    });

    await expect(guard.acquire("GET", "/payments")).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it("não bloqueia quando remaining > 10", async () => {
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    guard.recordResponse("/payments", {
      "ratelimit-remaining": "50",
      "ratelimit-reset": "60",
    });
    await expect(guard.acquire("GET", "/payments")).resolves.toBeUndefined();
  });

  it("libera após o reset", async () => {
    vi.useFakeTimers();
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    guard.recordResponse("/payments", {
      "ratelimit-remaining": "0",
      "ratelimit-reset": "10",
    });

    // Antes do reset: bloqueia
    await expect(guard.acquire("GET", "/payments")).rejects.toBeInstanceOf(
      RateLimitError,
    );

    // 11s depois: libera
    vi.advanceTimersByTime(11_000);
    await expect(guard.acquire("GET", "/payments")).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("normaliza endpoints com IDs (/payments/pay_123 → /payments/:id)", async () => {
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    guard.recordResponse("/payments/pay_abc123", {
      "ratelimit-remaining": "2",
      "ratelimit-reset": "60",
    });
    // Outro ID, mesmo "tipo" de endpoint → bloqueado também
    await expect(
      guard.acquire("GET", "/payments/pay_xyz999"),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("trata header em casing camelCase também (RateLimit-Remaining)", async () => {
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    guard.recordResponse("/customers", {
      "RateLimit-Remaining": "1",
      "RateLimit-Reset": "30",
    });
    await expect(
      guard.acquire("GET", "/customers"),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("AsaasRateGuard — Camada 3 (concorrência)", () => {
  beforeEach(() => {
    AsaasRateGuard.__resetParaTestes();
  });

  it("permite até 30 GETs simultâneos sem bloquear", async () => {
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    const promises = Array.from({ length: 30 }, () =>
      guard.acquire("GET", "/customers"),
    );
    await expect(Promise.all(promises)).resolves.toHaveLength(30);
    expect(guard.snapshot().inflight).toBe(30);
  });

  it("o 31º GET espera até o release de um anterior", async () => {
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    // Ocupa 30 slots
    for (let i = 0; i < 30; i++) {
      await guard.acquire("GET", "/customers");
    }
    expect(guard.snapshot().inflight).toBe(30);

    let resolved = false;
    const p31 = guard.acquire("GET", "/customers").then(() => {
      resolved = true;
    });

    // Aguarda 1 tick — não deve resolver ainda
    await new Promise((r) => setTimeout(r, 5));
    expect(resolved).toBe(false);

    // Libera 1 slot → o 31º acquire resolve
    guard.release("GET");
    await p31;
    expect(resolved).toBe(true);
  });

  it("POST/PUT/DELETE não contam pro limite de concorrência", async () => {
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    for (let i = 0; i < 100; i++) {
      await guard.acquire("POST", "/payments");
    }
    expect(guard.snapshot().inflight).toBe(0);
  });
});

describe("AsaasRateGuard — Camada 4 (janela 60s)", () => {
  beforeEach(() => {
    AsaasRateGuard.__resetParaTestes();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bloqueia após 150 requests em 60s", async () => {
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    for (let i = 0; i < 150; i++) {
      // Mistura GET (com release) e POST pra não esgotar concorrência
      await guard.acquire("POST", "/payments");
    }
    await expect(
      guard.acquire("POST", "/payments"),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("libera após 60s passarem", async () => {
    vi.useFakeTimers();
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    for (let i = 0; i < 150; i++) {
      await guard.acquire("POST", "/payments");
    }
    await expect(
      guard.acquire("POST", "/payments"),
    ).rejects.toBeInstanceOf(RateLimitError);

    vi.advanceTimersByTime(61_000);
    await expect(
      guard.acquire("POST", "/payments"),
    ).resolves.toBeUndefined();
  });
});

describe("AsaasRateGuard — 429 do Asaas", () => {
  beforeEach(() => {
    AsaasRateGuard.__resetParaTestes();
  });

  it("recordRateLimitError bloqueia o endpoint defensivamente", async () => {
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    guard.recordRateLimitError("/payments", 120);
    await expect(
      guard.acquire("GET", "/payments"),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("sem retry-after, assume 12h de bloqueio", async () => {
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    guard.recordRateLimitError("/payments");
    const snap = guard.snapshot();
    const lim = snap.lastEndpointLimits["/payments"];
    expect(lim.remaining).toBe(0);
    expect(lim.resetAt - Date.now()).toBeGreaterThan(11 * 60 * 60 * 1_000);
  });
});

describe("AsaasRateGuard — singleton por API key", () => {
  beforeEach(() => {
    AsaasRateGuard.__resetParaTestes();
  });

  it("mesma key retorna mesma instância", () => {
    const a = AsaasRateGuard.forApiKey("$aact_sandbox_x");
    const b = AsaasRateGuard.forApiKey("$aact_sandbox_x");
    expect(a).toBe(b);
  });

  it("keys diferentes têm guards isolados", async () => {
    const a = AsaasRateGuard.forApiKey("$aact_sandbox_a");
    const b = AsaasRateGuard.forApiKey("$aact_sandbox_b");
    expect(a).not.toBe(b);

    // Estourar a janela curta do A não afeta o B
    for (let i = 0; i < 150; i++) {
      await a.acquire("POST", "/payments");
    }
    await expect(a.acquire("POST", "/payments")).rejects.toBeInstanceOf(
      RateLimitError,
    );
    await expect(b.acquire("POST", "/payments")).resolves.toBeUndefined();
  });
});

describe("AsaasRateGuard — release com erro não vaza concorrência", () => {
  beforeEach(() => {
    AsaasRateGuard.__resetParaTestes();
  });

  it("release pode ser chamado várias vezes sem ir abaixo de 0", async () => {
    const guard = AsaasRateGuard.forApiKey(API_KEY);
    await guard.acquire("GET", "/customers");
    guard.release("GET");
    guard.release("GET"); // duplo release não deve corromper estado
    expect(guard.snapshot().inflight).toBe(0);
  });
});
