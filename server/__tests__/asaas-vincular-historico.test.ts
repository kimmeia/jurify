/**
 * Testes do fluxo "vincular cliente → puxar histórico completo".
 *
 * Cobre dois fixes simultâneos:
 *
 *   A) `buscarTodosClientesPorCpfCnpj` paginação: avança pelo número real
 *      de itens recebidos, não pelo `limit` pedido — evita pular registros
 *      quando a API responde com menos do que o cap. Também tem cap defensivo
 *      contra `hasMore=true` infinito.
 *
 *   B) `syncTodasCobrancasDoContato({ historicoCompleto: true })` chama
 *      `listarCobrancas` (sem filtro de data) em vez de `listarCobrancasPorJanela`
 *      (90 dias). Sem isso, o primeiro sync após vincular traz só os últimos
 *      90 dias e o sintoma "vincula mas não puxa cobranças" se manifesta.
 *
 * Os testes de tRPC (`vincularContato` end-to-end) exigem DB + crypto e
 * vivem em testes de integração separados; aqui isolamos o que dá pra
 * cobrir com mock HTTP.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { AsaasClient, type AsaasCustomer } from "../integracoes/asaas-client";

// ─── Mock do getDb pra testar syncTodasCobrancasDoContato ───────────────────

type Captured = {
  op: "select" | "insert" | "update" | "delete";
  table: string;
  values?: unknown;
  set?: Record<string, unknown>;
};

let captured: Captured[] = [];
let selectQueue: unknown[][] = [];

function tableName(t: unknown): string {
  const anyT = t as any;
  return (
    anyT?._?.name ||
    anyT?.[Symbol.for("drizzle:Name")] ||
    "unknown"
  );
}

function nextSelectResult(): unknown[] {
  return selectQueue.shift() ?? [];
}

function makeSelectBuilder(table: unknown) {
  const builder: any = {
    from(_t: unknown) {
      return builder;
    },
    where(_w: unknown) {
      captured.push({ op: "select", table: tableName(table) });
      return builder;
    },
    orderBy: (..._a: unknown[]) => builder,
    limit: (_n: number) => Promise.resolve(nextSelectResult()),
    offset: (_n: number) => Promise.resolve(nextSelectResult()),
    then: (resolve: (v: unknown) => unknown) => resolve(nextSelectResult()),
  };
  return builder;
}

const mockDb = {
  select: (_cols?: unknown) => ({
    from(table: unknown) {
      return makeSelectBuilder(table);
    },
  }),
  insert: (table: unknown) => ({
    values(values: unknown) {
      captured.push({ op: "insert", table: tableName(table), values });
      return {
        then: (r: (v: unknown) => unknown) => r([{ insertId: 1, affectedRows: 1 }]),
        onDuplicateKeyUpdate: (_arg: unknown) => Promise.resolve([{ affectedRows: 1 }]),
      };
    },
  }),
  update: (table: unknown) => ({
    set(set: Record<string, unknown>) {
      return {
        where(_w: unknown) {
          captured.push({ op: "update", table: tableName(table), set });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      };
    },
  }),
  delete: (table: unknown) => ({
    where(_w: unknown) {
      captured.push({ op: "delete", table: tableName(table) });
      return Promise.resolve([{ affectedRows: 1 }]);
    },
  }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

function fakeClientWithSpy() {
  const listarCobrancas = vi.fn(async () => ({
    data: [], hasMore: false, limit: 100, offset: 0,
  }));
  const listarCobrancasPorJanela = vi.fn(async () => ({
    data: [], hasMore: false, limit: 100, offset: 0,
  }));
  return {
    client: { listarCobrancas, listarCobrancasPorJanela } as any,
    listarCobrancas,
    listarCobrancasPorJanela,
  };
}

// Importa APÓS o mock pra que `getDb` chame o mockDb.
const { syncTodasCobrancasDoContato } = await import("../integracoes/asaas-sync");

type MockGet = ReturnType<typeof vi.fn>;

function criarClienteMock(overrides: Partial<AsaasCustomer> = {}): AsaasCustomer {
  return {
    id: "cus_default",
    name: "Cliente Mock",
    cpfCnpj: "12345678901",
    email: undefined,
    phone: "",
    mobilePhone: "",
    deleted: false,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fix A: paginação por número real de itens
// ═══════════════════════════════════════════════════════════════════════════════

describe("AsaasClient.buscarTodosClientesPorCpfCnpj — paginação robusta", () => {
  let client: AsaasClient;
  let getMock: MockGet;

  beforeEach(() => {
    getMock = vi.fn();
    vi.spyOn(axios, "create").mockReturnValue({
      get: getMock,
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    } as any);
    client = new AsaasClient("$aact_sandbox_fakekey", "sandbox");
  });

  it("agrega resultados de múltiplas páginas sem pular registros", async () => {
    // Página 1: 100 itens; Página 2: 50 itens; fim.
    const pagina1 = Array.from({ length: 100 }, (_, i) =>
      criarClienteMock({ id: `cus_p1_${i}`, cpfCnpj: "12345678901" }),
    );
    const pagina2 = Array.from({ length: 50 }, (_, i) =>
      criarClienteMock({ id: `cus_p2_${i}`, cpfCnpj: "12345678901" }),
    );

    getMock
      .mockResolvedValueOnce({ data: { data: pagina1, hasMore: true, limit: 100, offset: 0 } })
      .mockResolvedValueOnce({ data: { data: pagina2, hasMore: false, limit: 100, offset: 100 } });

    const resultado = await client.buscarTodosClientesPorCpfCnpj("12345678901");

    expect(resultado).toHaveLength(150);
    expect(getMock).toHaveBeenCalledTimes(2);
    // Segunda chamada deve ter offset 100 (avançado pelo número de itens
    // recebidos na primeira). Antes do fix, usava `res.data.limit` que
    // poderia descasar se a API mentisse no campo.
    const segundaChamada = getMock.mock.calls[1][1];
    expect(segundaChamada.params).toMatchObject({ offset: 100 });
  });

  it("aborta a paginação quando a página vem vazia (defesa contra hasMore=true bug)", async () => {
    getMock.mockResolvedValueOnce({
      data: { data: [], hasMore: true, limit: 100, offset: 0 },
    });

    const resultado = await client.buscarTodosClientesPorCpfCnpj("12345678901");

    expect(resultado).toEqual([]);
    // Só 1 chamada — o break interno aborta antes de fazer chamadas
    // adicionais com hasMore=true espúrio.
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("aplica cap defensivo de 10 páginas contra loop infinito", async () => {
    // API "maluca" retorna sempre hasMore=true com 1 item por página.
    getMock.mockImplementation(async () => ({
      data: {
        data: [criarClienteMock({ id: `cus_${Math.random()}`, cpfCnpj: "12345678901" })],
        hasMore: true,
        limit: 100,
        offset: 0,
      },
    }));

    const resultado = await client.buscarTodosClientesPorCpfCnpj("12345678901");

    // Caps em 10 páginas → 10 chamadas, 10 resultados, não trava o teste.
    expect(getMock).toHaveBeenCalledTimes(10);
    expect(resultado).toHaveLength(10);
  });

  it("filtra customers com CPF que NÃO bate (Asaas às vezes faz prefix match)", async () => {
    const bate = criarClienteMock({ id: "cus_OK", cpfCnpj: "12345678901" });
    const naoBate = criarClienteMock({ id: "cus_NAO", cpfCnpj: "123456789010" });
    const deletado = criarClienteMock({ id: "cus_DEL", cpfCnpj: "12345678901", deleted: true });

    getMock.mockResolvedValueOnce({
      data: { data: [bate, naoBate, deletado], hasMore: false, limit: 100, offset: 0 },
    });

    const resultado = await client.buscarTodosClientesPorCpfCnpj("12345678901");

    expect(resultado).toHaveLength(1);
    expect(resultado[0].id).toBe("cus_OK");
  });

  it("usa o parâmetro cpfCnpj na query do Asaas (formato sem máscara)", async () => {
    getMock.mockResolvedValueOnce({ data: { data: [], hasMore: false, limit: 100, offset: 0 } });

    await client.buscarTodosClientesPorCpfCnpj("123.456.789-01");

    const [url, config] = getMock.mock.calls[0];
    expect(url).toBe("/customers");
    // Bate com a doc oficial do Asaas (GET /v3/customers?cpfCnpj=<digitos>).
    expect(config.params.cpfCnpj).toBe("12345678901");
  });

  it("retorna vazio sem chamar a API quando cpf está vazio", async () => {
    const resultado = await client.buscarTodosClientesPorCpfCnpj("");
    expect(resultado).toEqual([]);
    expect(getMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix B: historicoCompleto faz o sync usar listarCobrancas (sem janela)
// ═══════════════════════════════════════════════════════════════════════════════

describe("syncTodasCobrancasDoContato — historicoCompleto", () => {
  beforeEach(() => {
    captured = [];
    selectQueue = [];
  });

  it("com historicoCompleto=true, usa listarCobrancas (sem filtro de 90 dias)", async () => {
    // 1) SELECT dos vínculos → 1 customer Asaas
    selectQueue.push([{ asaasCustomerId: "cus_X" }]);
    // 2) SELECT de cobranças locais no fim (cleanup órfãs com diasHistorico=null) → vazio
    selectQueue.push([]);

    const { client, listarCobrancas, listarCobrancasPorJanela } = fakeClientWithSpy();

    await syncTodasCobrancasDoContato(client, 1, 42, { historicoCompleto: true });

    // Com historicoCompleto=true, propaga diasHistorico=null pro
    // syncCobrancasDeCliente, que escolhe `listarCobrancas` (sem filtro)
    // em vez de `listarCobrancasPorJanela` (com dateCreatedGe). Isso garante
    // que cobranças antigas (>90 dias) sejam importadas no primeiro sync
    // após vincular.
    expect(listarCobrancas).toHaveBeenCalled();
    expect(listarCobrancasPorJanela).not.toHaveBeenCalled();
  });

  it("sem historicoCompleto (default), usa listarCobrancasPorJanela com filtro de 90 dias", async () => {
    selectQueue.push([{ asaasCustomerId: "cus_X" }]);
    selectQueue.push([]);

    const { client, listarCobrancas, listarCobrancasPorJanela } = fakeClientWithSpy();

    await syncTodasCobrancasDoContato(client, 1, 42);

    // Default = 90 dias → usa o endpoint com janela.
    expect(listarCobrancasPorJanela).toHaveBeenCalled();
    expect(listarCobrancas).not.toHaveBeenCalled();
  });
});
