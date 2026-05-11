/**
 * Testes do circuit breaker do AsaasClient — proteção contra estouro
 * de rate limit (200 req/min do Asaas, bloqueia 12h).
 *
 * O breaker é local (in-memory por processo) e impede que qualquer bug
 * de código tente fazer bulk request acima de 150/min.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock do axios — captura requests sem hit de rede
const mockAxiosGet = vi.fn();
const mockInterceptorUse = vi.fn();
const interceptorHandlers: Array<(config: any) => any> = [];

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => ({
      get: mockAxiosGet,
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: {
          use: (fn: any) => {
            interceptorHandlers.push(fn);
            mockInterceptorUse(fn);
          },
        },
      },
    })),
  },
}));

import { AsaasClient } from "../integracoes/asaas-client";

beforeEach(() => {
  mockAxiosGet.mockReset();
  mockInterceptorUse.mockReset();
  interceptorHandlers.length = 0;
});

describe("AsaasClient — circuit breaker local", () => {
  it("registra o interceptor de request ao construir", () => {
    new AsaasClient("$aact_test_abc123");
    expect(mockInterceptorUse).toHaveBeenCalledTimes(1);
  });

  it("permite requests dentro do limite (150/min)", () => {
    new AsaasClient("$aact_test_key_a");
    const handler = interceptorHandlers[0];
    expect(handler).toBeDefined();

    // 100 requests devem passar
    for (let i = 0; i < 100; i++) {
      const result = handler({ url: "/test" });
      expect(result).toEqual({ url: "/test" });
    }
  });

  it("bloqueia request 151 com erro 429 sintético", async () => {
    new AsaasClient("$aact_test_key_b");
    const handler = interceptorHandlers[0];

    // 150 requests passam
    for (let i = 0; i < 150; i++) {
      handler({ url: "/test" });
    }

    // 151º deve falhar
    try {
      await handler({ url: "/test" });
      throw new Error("Deveria ter rejeitado");
    } catch (err: any) {
      expect(err.code).toBe("ASAAS_LOCAL_RATE_LIMIT");
      expect(err.response.status).toBe(429);
      expect(err.message).toContain("circuit breaker");
    }
  });

  it("janela rolante de 60s libera novos requests", async () => {
    const apiKey = "$aact_test_key_c";
    new AsaasClient(apiKey);
    const handler = interceptorHandlers[0];

    // Estoura o limite
    for (let i = 0; i < 150; i++) handler({ url: "/test" });
    await expect(handler({ url: "/test" })).rejects.toThrow();

    // Fast-forward de 61s (janela passa)
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);

    // Após a janela, novos requests passam
    const ok = handler({ url: "/test" });
    expect(ok).toEqual({ url: "/test" });

    vi.useRealTimers();
  });

  it("breaker é POR API key (escritórios isolados)", async () => {
    const clienteA = new AsaasClient("$aact_test_key_d_escritorio_1");
    const handlerA = interceptorHandlers[interceptorHandlers.length - 1];

    const clienteB = new AsaasClient("$aact_test_key_e_escritorio_2");
    const handlerB = interceptorHandlers[interceptorHandlers.length - 1];

    // Escritório A estoura
    for (let i = 0; i < 150; i++) handlerA({ url: "/test" });
    await expect(handlerA({ url: "/test" })).rejects.toThrow();

    // Escritório B AINDA pode requisitar (cota dele intocada)
    const ok = handlerB({ url: "/test" });
    expect(ok).toEqual({ url: "/test" });

    // Os clients são instanciados pra que TS não os marque como unused
    expect(clienteA).toBeDefined();
    expect(clienteB).toBeDefined();
  });
});
