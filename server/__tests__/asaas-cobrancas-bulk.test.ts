/**
 * Testes do helper `executarExclusaoCobrancasEmMassa`.
 *
 * Substituiu o loop frontend que disparava N mutations em paralelo:
 *   `for (const c of selecionadas) excluirCobMut.mutate({id: c.id})`
 *
 * Esse padrão estourava o rate limit do Asaas (12h de bloqueio da API
 * key) quando o usuário marcava 30-50 cobranças.
 *
 * Os testes travam:
 *   - Serialização das chamadas (uma de cada vez)
 *   - Filtro de status: ignora cobranças != PENDING sem erro
 *   - Cobranças manuais NÃO chamam o Asaas (lazy client)
 *   - Rate limit: aborta o lote e devolve parcial
 *   - Outros erros: registra e segue
 *   - Lazy load do AsaasClient — só carrega quando há cobrança Asaas
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { RateLimitError } from "../integracoes/asaas-rate-guard";

interface CobMock {
  id: number;
  asaasPaymentId: string | null;
  origem: "asaas" | "manual";
  status: string;
}

let cobsNoBanco: CobMock[] = [];
let deletados: number[] = [];
let asaasExcluidos: string[] = [];
let asaasExcluirThrow: Error | null = null;
let getClientCallCount = 0;

function makeSelectBuilder() {
  const builder: any = {
    from: () => builder,
    where: () => Promise.resolve(cobsNoBanco),
    then: (resolve: (v: unknown) => unknown) => resolve(cobsNoBanco),
  };
  return builder;
}

const mockDb = {
  select: () => makeSelectBuilder(),
  delete: () => ({
    where: (cond: any) => {
      // Drizzle SQL cond — extrai o ID que o helper passou no where.
      // Pra mock, sabemos que vem `eq(asaasCobrancas.id, cob.id)` e o
      // helper itera em sequência, então deletamos o último processado.
      // Simplificação: registra o id na ordem em que `delete` é chamado.
      const next = cobsNoBanco[deletados.length];
      if (next) deletados.push(next.id);
      return Promise.resolve();
    },
  }),
};

const mockAsaasClient = {
  excluirCobranca: vi.fn(async (id: string) => {
    if (asaasExcluirThrow) throw asaasExcluirThrow;
    asaasExcluidos.push(id);
  }),
};

const getAsaasClient = async () => {
  getClientCallCount++;
  return mockAsaasClient as any;
};

const { executarExclusaoCobrancasEmMassa } = await import(
  "../integracoes/asaas-cobrancas-bulk"
);

beforeEach(() => {
  cobsNoBanco = [];
  deletados = [];
  asaasExcluidos = [];
  asaasExcluirThrow = null;
  getClientCallCount = 0;
  vi.clearAllMocks();
});

describe("executarExclusaoCobrancasEmMassa", () => {
  it("happy path: 3 cobranças Asaas PENDING — todas excluídas serialmente", async () => {
    cobsNoBanco = [
      { id: 1, asaasPaymentId: "pay_1", origem: "asaas", status: "PENDING" },
      { id: 2, asaasPaymentId: "pay_2", origem: "asaas", status: "PENDING" },
      { id: 3, asaasPaymentId: "pay_3", origem: "asaas", status: "PENDING" },
    ];

    const r = await executarExclusaoCobrancasEmMassa({
      db: mockDb,
      escritorioId: 10,
      ids: [1, 2, 3],
      getAsaasClient,
    });

    expect(r.excluidasAsaas).toBe(3);
    expect(r.excluidasManual).toBe(0);
    expect(r.ignoradas).toBe(0);
    expect(r.erros).toEqual([]);
    expect(r.abortadoPorRateLimit).toBe(false);
    expect(asaasExcluidos).toEqual(["pay_1", "pay_2", "pay_3"]);
    // Client é instanciado UMA vez (lazy + cache local)
    expect(getClientCallCount).toBe(1);
  });

  it("cobranças manuais não chamam Asaas (lazy client nunca instancia)", async () => {
    cobsNoBanco = [
      { id: 1, asaasPaymentId: null, origem: "manual", status: "PENDING" },
      { id: 2, asaasPaymentId: null, origem: "manual", status: "PENDING" },
    ];

    const r = await executarExclusaoCobrancasEmMassa({
      db: mockDb,
      escritorioId: 10,
      ids: [1, 2],
      getAsaasClient,
    });

    expect(r.excluidasManual).toBe(2);
    expect(r.excluidasAsaas).toBe(0);
    // Crucial pra performance: lote 100% manual NÃO carrega client Asaas
    expect(getClientCallCount).toBe(0);
    expect(asaasExcluidos).toEqual([]);
  });

  it("mix de manuais e Asaas: client lazy só carrega na 1ª Asaas", async () => {
    cobsNoBanco = [
      { id: 1, asaasPaymentId: null, origem: "manual", status: "PENDING" },
      { id: 2, asaasPaymentId: "pay_2", origem: "asaas", status: "PENDING" },
      { id: 3, asaasPaymentId: null, origem: "manual", status: "PENDING" },
    ];

    const r = await executarExclusaoCobrancasEmMassa({
      db: mockDb,
      escritorioId: 10,
      ids: [1, 2, 3],
      getAsaasClient,
    });

    expect(r.excluidasManual).toBe(2);
    expect(r.excluidasAsaas).toBe(1);
    expect(getClientCallCount).toBe(1);
  });

  it("status != PENDING: ignorada (sem erro, sem chamada Asaas)", async () => {
    cobsNoBanco = [
      { id: 1, asaasPaymentId: "pay_1", origem: "asaas", status: "RECEIVED" },
      { id: 2, asaasPaymentId: "pay_2", origem: "asaas", status: "OVERDUE" },
      { id: 3, asaasPaymentId: "pay_3", origem: "asaas", status: "PENDING" },
    ];

    const r = await executarExclusaoCobrancasEmMassa({
      db: mockDb,
      escritorioId: 10,
      ids: [1, 2, 3],
      getAsaasClient,
    });

    expect(r.excluidasAsaas).toBe(1);
    expect(r.ignoradas).toBe(2);
    expect(r.erros).toEqual([]);
    expect(asaasExcluidos).toEqual(["pay_3"]);
  });

  it("RateLimitError (rate guard local): aborta lote + devolve parcial", async () => {
    cobsNoBanco = [
      { id: 1, asaasPaymentId: "pay_1", origem: "asaas", status: "PENDING" },
      { id: 2, asaasPaymentId: "pay_2", origem: "asaas", status: "PENDING" },
      { id: 3, asaasPaymentId: "pay_3", origem: "asaas", status: "PENDING" },
    ];
    // 1ª passa, 2ª dispara RateLimitError
    let calls = 0;
    mockAsaasClient.excluirCobranca = vi.fn(async (id: string) => {
      calls++;
      if (calls === 2) {
        throw new RateLimitError("guard local — cota próxima");
      }
      asaasExcluidos.push(id);
    });

    const r = await executarExclusaoCobrancasEmMassa({
      db: mockDb,
      escritorioId: 10,
      ids: [1, 2, 3],
      getAsaasClient,
    });

    expect(r.excluidasAsaas).toBe(1); // só a #1 vingou
    expect(r.abortadoPorRateLimit).toBe(true);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toEqual({
      id: 2,
      mensagem: "Rate limit Asaas atingido — pausando lote.",
    });
    // #3 nunca foi tentada — loop abortou antes
    expect(calls).toBe(2);
  });

  it("HTTP 429 (vem do Asaas direto, não-RateLimitError): aborta lote", async () => {
    cobsNoBanco = [
      { id: 1, asaasPaymentId: "pay_1", origem: "asaas", status: "PENDING" },
      { id: 2, asaasPaymentId: "pay_2", origem: "asaas", status: "PENDING" },
    ];
    mockAsaasClient.excluirCobranca = vi.fn(async () => {
      const err: any = new Error("Request failed");
      err.response = { status: 429 };
      throw err;
    });

    const r = await executarExclusaoCobrancasEmMassa({
      db: mockDb,
      escritorioId: 10,
      ids: [1, 2],
      getAsaasClient,
    });

    expect(r.abortadoPorRateLimit).toBe(true);
    expect(r.excluidasAsaas).toBe(0);
  });

  it("erro genérico (não rate limit): registra e CONTINUA loop", async () => {
    cobsNoBanco = [
      { id: 1, asaasPaymentId: "pay_1", origem: "asaas", status: "PENDING" },
      { id: 2, asaasPaymentId: "pay_2", origem: "asaas", status: "PENDING" },
      { id: 3, asaasPaymentId: "pay_3", origem: "asaas", status: "PENDING" },
    ];
    let calls = 0;
    mockAsaasClient.excluirCobranca = vi.fn(async (id: string) => {
      calls++;
      if (calls === 2) throw new Error("connection lost");
      asaasExcluidos.push(id);
    });

    const r = await executarExclusaoCobrancasEmMassa({
      db: mockDb,
      escritorioId: 10,
      ids: [1, 2, 3],
      getAsaasClient,
    });

    expect(r.excluidasAsaas).toBe(2); // #1 e #3 vingaram
    expect(r.abortadoPorRateLimit).toBe(false);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0].id).toBe(2);
    expect(r.erros[0].mensagem).toMatch(/connection lost/);
    expect(calls).toBe(3); // loop continuou após erro
  });

  it("regex de mensagem detecta rate limit mesmo sem instance/status code", async () => {
    cobsNoBanco = [
      { id: 1, asaasPaymentId: "pay_1", origem: "asaas", status: "PENDING" },
      { id: 2, asaasPaymentId: "pay_2", origem: "asaas", status: "PENDING" },
    ];
    mockAsaasClient.excluirCobranca = vi.fn(async () => {
      throw new Error("rate limit excedido pela API");
    });

    const r = await executarExclusaoCobrancasEmMassa({
      db: mockDb,
      escritorioId: 10,
      ids: [1, 2],
      getAsaasClient,
    });

    expect(r.abortadoPorRateLimit).toBe(true);
  });

  it("lote vazio (nenhum id encontrado no banco): retorna zeros sem erro", async () => {
    cobsNoBanco = [];

    const r = await executarExclusaoCobrancasEmMassa({
      db: mockDb,
      escritorioId: 10,
      ids: [1, 2, 3],
      getAsaasClient,
    });

    expect(r).toEqual({
      excluidasAsaas: 0,
      excluidasManual: 0,
      ignoradas: 0,
      erros: [],
      abortadoPorRateLimit: false,
      totalProcessadas: 0,
    });
    expect(getClientCallCount).toBe(0);
  });
});
