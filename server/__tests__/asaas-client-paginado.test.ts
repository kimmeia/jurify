/**
 * Testes dos helpers paginados `listarTodasCobrancasPaginado` e
 * `listarTodasAssinaturasPaginado` do AsaasClient.
 *
 * Bug original: admin-financeiro pegava `limit: 100` na 1ª página
 * apenas. MRR/receita zeravam quando o Jurify cresceu além de 100
 * assinaturas/cobranças no período.
 *
 * Helpers paginados percorrem hasMore=true até esgotar (ou até o cap
 * defensivo de 100 páginas × 100 = 10k registros).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const apiMock = {
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

vi.mock("axios", () => ({
  default: { create: vi.fn(() => apiMock) },
}));

// Mock rate guard pra não tocar DB
vi.mock("../integracoes/asaas-rate-guard", () => ({
  AsaasRateGuard: { forApiKey: () => ({ acquire: vi.fn(), release: vi.fn(), recordResponse: vi.fn() }) },
  RateLimitError: class extends Error {},
}));

const { AsaasClient } = await import("../integracoes/asaas-client");

function makePage(items: any[], hasMore: boolean): any {
  return {
    data: {
      data: items,
      hasMore,
      limit: 100,
      offset: 0,
      object: "list",
      totalCount: items.length,
    },
    headers: {},
  };
}

beforeEach(() => {
  apiMock.get.mockReset();
});

describe("listarTodasCobrancasPaginado", () => {
  it("uma única página: retorna o conteúdo direto", async () => {
    apiMock.get.mockResolvedValueOnce(makePage([{ id: "p1" }, { id: "p2" }], false));

    const client = new AsaasClient("fake-key");
    const r = await client.listarTodasCobrancasPaginado();

    expect(r).toHaveLength(2);
    expect(r.map((c: any) => c.id)).toEqual(["p1", "p2"]);
    expect(apiMock.get).toHaveBeenCalledTimes(1);
  });

  it("itera por múltiplas páginas até hasMore=false", async () => {
    apiMock.get
      .mockResolvedValueOnce(makePage([{ id: "p1" }, { id: "p2" }], true))
      .mockResolvedValueOnce(makePage([{ id: "p3" }, { id: "p4" }], true))
      .mockResolvedValueOnce(makePage([{ id: "p5" }], false));

    const client = new AsaasClient("fake-key");
    const r = await client.listarTodasCobrancasPaginado();

    expect(r).toHaveLength(5);
    expect(r.map((c: any) => c.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(apiMock.get).toHaveBeenCalledTimes(3);
  });

  it("para no cap de páginas (defensivo contra runaway loop)", async () => {
    // Sempre devolve hasMore=true (simula API bugada que nunca diz "fim")
    apiMock.get.mockResolvedValue(makePage([{ id: "x" }], true));

    const client = new AsaasClient("fake-key");
    // Cap pequeno pro teste rodar rápido
    const r = await client.listarTodasCobrancasPaginado(undefined, 5);

    expect(r).toHaveLength(5);
    expect(apiMock.get).toHaveBeenCalledTimes(5);
  });

  it("para quando página vem vazia (defensivo contra hasMore mentiroso)", async () => {
    apiMock.get
      .mockResolvedValueOnce(makePage([{ id: "p1" }], true))
      .mockResolvedValueOnce(makePage([], true)) // vazia mas hasMore — para mesmo assim
      .mockResolvedValueOnce(makePage([{ id: "p2" }], false)); // não deve ser chamada

    const client = new AsaasClient("fake-key");
    const r = await client.listarTodasCobrancasPaginado();

    expect(r).toHaveLength(1);
    expect(apiMock.get).toHaveBeenCalledTimes(2);
  });

  it("repassa params (status, customer) para cada página", async () => {
    apiMock.get.mockResolvedValueOnce(makePage([], false));

    const client = new AsaasClient("fake-key");
    await client.listarTodasCobrancasPaginado({ status: "PENDING" as any, customer: "cus_x" });

    expect(apiMock.get).toHaveBeenCalledWith("/payments", {
      params: expect.objectContaining({
        status: "PENDING",
        customer: "cus_x",
        offset: 0,
        limit: 100,
      }),
    });
  });

  it("incrementa offset entre páginas", async () => {
    apiMock.get
      .mockResolvedValueOnce(makePage(Array.from({ length: 100 }, (_, i) => ({ id: `p${i}` })), true))
      .mockResolvedValueOnce(makePage([{ id: "p100" }], false));

    const client = new AsaasClient("fake-key");
    await client.listarTodasCobrancasPaginado();

    expect(apiMock.get).toHaveBeenNthCalledWith(1, "/payments", {
      params: expect.objectContaining({ offset: 0, limit: 100 }),
    });
    expect(apiMock.get).toHaveBeenNthCalledWith(2, "/payments", {
      params: expect.objectContaining({ offset: 100, limit: 100 }),
    });
  });
});

describe("listarTodasAssinaturasPaginado", () => {
  it("itera por múltiplas páginas (mesmo padrão de cobranças)", async () => {
    apiMock.get
      .mockResolvedValueOnce(makePage([{ id: "s1" }, { id: "s2" }], true))
      .mockResolvedValueOnce(makePage([{ id: "s3" }], false));

    const client = new AsaasClient("fake-key");
    const r = await client.listarTodasAssinaturasPaginado();

    expect(r).toHaveLength(3);
    expect(r.map((s: any) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(apiMock.get).toHaveBeenCalledWith(
      "/subscriptions",
      expect.objectContaining({ params: expect.any(Object) }),
    );
  });
});
