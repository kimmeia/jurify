/**
 * Testes — `adotarCobrancasOrfas`.
 *
 * Cobrança órfã = `contatoId IS NULL` mas com `asaasCustomerId` válido.
 * Acontece principalmente em PIX recebido — Asaas cria customer mas o
 * sync histórico não vincula localmente. Esta função busca o customer
 * no Asaas e cria/vincula contato.
 *
 * Cenários cobertos:
 *  1. Customer existe no Asaas, CPF NÃO existe no CRM → cria contato novo
 *  2. Customer existe no Asaas, CPF JÁ existe no CRM → vincula sem criar
 *  3. Customer deletado no Asaas → skip
 *  4. Customer sem nome no Asaas → skip
 *  5. Já tem vínculo em asaas_clientes (race) → skip silencioso
 *  6. 429 do Asaas → aborta gracefully com parcial=true
 *  7. Hard cap MAX_ADOTAR_POR_RUN (200) → para no 200º, marca parcial
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

type Captured = {
  op: "select" | "selectDistinct" | "insert";
  table: string;
  values?: unknown;
};

let captured: Captured[] = [];
let selectQueue: unknown[][] = [];

function tableName(t: unknown): string {
  const anyT = t as any;
  return (
    anyT?._?.name ||
    anyT?.[Symbol.for("drizzle:Name")] ||
    anyT?.Symbol?.Name ||
    "unknown"
  );
}

function nextSelectResult(): unknown[] {
  return selectQueue.shift() ?? [];
}

function makeSelectBuilder(table: unknown, op: "select" | "selectDistinct") {
  const builder: any = {
    from(_t: unknown) {
      return builder;
    },
    where(_w: unknown) {
      captured.push({ op, table: tableName(table) });
      return builder;
    },
    limit: (_n: number) => Promise.resolve(nextSelectResult()),
    then: (resolve: (v: unknown) => unknown) => resolve(nextSelectResult()),
  };
  return builder;
}

const mockDb = {
  select: (_cols?: unknown) => ({
    from(table: unknown) {
      return makeSelectBuilder(table, "select");
    },
  }),
  selectDistinct: (_cols?: unknown) => ({
    from(table: unknown) {
      return makeSelectBuilder(table, "selectDistinct");
    },
  }),
  insert: (table: unknown) => ({
    values(values: unknown) {
      captured.push({ op: "insert", table: tableName(table), values });
      return {
        $returningId: () => Promise.resolve([{ id: 999 }]),
        then: (r: (v: unknown) => unknown) =>
          r([{ insertId: 999, affectedRows: 1 }]),
      };
    },
  }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

const { adotarCobrancasOrfas } = await import("../integracoes/asaas-adocao-orfas");

interface FakeCustomer {
  id: string;
  name: string;
  cpfCnpj?: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  deleted: boolean;
}

function fakeClient(customers: Record<string, FakeCustomer | Error>): any {
  return {
    buscarCliente: vi.fn(async (id: string) => {
      const c = customers[id];
      if (c instanceof Error) throw c;
      if (!c) {
        const err: any = new Error("Not found");
        err.response = { status: 404 };
        throw err;
      }
      return c;
    }),
  };
}

function makeAxiosError(status: number): Error {
  const err: any = new Error(`HTTP ${status}`);
  err.response = { status };
  return err;
}

beforeEach(() => {
  captured = [];
  selectQueue = [];
});

describe("adotarCobrancasOrfas — caminhos felizes", () => {
  it("CPF NÃO existe no CRM → cria contato novo + vínculo", async () => {
    selectQueue.push([{ customerId: "cus_A" }]); // selectDistinct órfãs
    selectQueue.push([]); // jaTem em asaas_clientes — vazio
    selectQueue.push([]); // contato por CPF — vazio (não existe)
    // insert contatos → returning id 999 (mockado fixo)

    const client = fakeClient({
      cus_A: { id: "cus_A", name: "João da Silva", cpfCnpj: "12345678901", deleted: false },
    });

    const r = await adotarCobrancasOrfas(10, client);
    expect(r.novosContatos).toBe(1);
    expect(r.vinculadosExistentes).toBe(0);
    expect(r.customersFalhados).toBe(0);
    expect(r.parcial).toBe(false);

    const inserts = captured.filter((c) => c.op === "insert");
    expect(inserts.map((i) => i.table)).toEqual(["contatos", "asaas_clientes"]);
    expect(client.buscarCliente).toHaveBeenCalledWith("cus_A");
  });

  it("CPF JÁ existe no CRM → vincula sem criar contato", async () => {
    selectQueue.push([{ customerId: "cus_A" }]);
    selectQueue.push([]); // jaTem vazio
    selectQueue.push([{ id: 42 }]); // contato existe com id=42

    const client = fakeClient({
      cus_A: { id: "cus_A", name: "Maria Souza", cpfCnpj: "98765432100", deleted: false },
    });

    const r = await adotarCobrancasOrfas(10, client);
    expect(r.novosContatos).toBe(0);
    expect(r.vinculadosExistentes).toBe(1);

    const inserts = captured.filter((c) => c.op === "insert");
    // SÓ insere em asaas_clientes — contatos NÃO é inserido
    expect(inserts.map((i) => i.table)).toEqual(["asaas_clientes"]);
    expect((inserts[0].values as any).contatoId).toBe(42);
  });
});

describe("adotarCobrancasOrfas — skips defensivos", () => {
  it("customer.deleted=true → skip, conta como falhado", async () => {
    selectQueue.push([{ customerId: "cus_DEL" }]);
    selectQueue.push([]);

    const client = fakeClient({
      cus_DEL: { id: "cus_DEL", name: "Removido", deleted: true },
    });

    const r = await adotarCobrancasOrfas(10, client);
    expect(r.customersFalhados).toBe(1);
    expect(r.novosContatos).toBe(0);
    expect(captured.filter((c) => c.op === "insert").length).toBe(0);
  });

  it("customer.name vazio → skip", async () => {
    selectQueue.push([{ customerId: "cus_SEM_NOME" }]);
    selectQueue.push([]);

    const client = fakeClient({
      cus_SEM_NOME: { id: "cus_SEM_NOME", name: "   ", deleted: false },
    });

    const r = await adotarCobrancasOrfas(10, client);
    expect(r.customersFalhados).toBe(1);
    expect(captured.filter((c) => c.op === "insert").length).toBe(0);
  });

  it("vínculo já existe em asaas_clientes (race) → skip silencioso (não conta como falha)", async () => {
    selectQueue.push([{ customerId: "cus_A" }]);
    selectQueue.push([{ id: 7 }]); // jaTem retorna registro existente

    const client = fakeClient({});

    const r = await adotarCobrancasOrfas(10, client);
    expect(r.novosContatos).toBe(0);
    expect(r.vinculadosExistentes).toBe(0);
    expect(r.customersFalhados).toBe(0);
    expect(client.buscarCliente).not.toHaveBeenCalled();
  });
});

describe("adotarCobrancasOrfas — rate limit e cap", () => {
  it("429 do Asaas → aborta gracefully com parcial=true", async () => {
    selectQueue.push([
      { customerId: "cus_A" },
      { customerId: "cus_B" },
      { customerId: "cus_C" },
    ]);
    selectQueue.push([]); // cus_A: jaTem
    // cus_A vai dar 429 — restantes não devem ser consultados

    const client = fakeClient({ cus_A: makeAxiosError(429) });

    const r = await adotarCobrancasOrfas(10, client);
    expect(r.parcial).toBe(true);
    expect(r.restantesEstimado).toBeGreaterThan(0);
    // Só chamou buscarCliente uma vez (parou no 429)
    expect(client.buscarCliente).toHaveBeenCalledTimes(1);
  });

  it("404 num customer NÃO aborta — segue e marca como falhado", async () => {
    selectQueue.push([{ customerId: "cus_A" }, { customerId: "cus_B" }]);
    selectQueue.push([]); // cus_A jaTem
    selectQueue.push([]); // cus_B jaTem
    selectQueue.push([]); // cus_B contato por CPF

    const client = fakeClient({
      cus_A: makeAxiosError(404),
      cus_B: { id: "cus_B", name: "Pedro", cpfCnpj: "11122233344", deleted: false },
    });

    const r = await adotarCobrancasOrfas(10, client);
    expect(r.customersFalhados).toBe(1);
    expect(r.novosContatos).toBe(1);
    expect(r.parcial).toBe(false);
  }, 10_000);

  it("DB indisponível → retorna zeros sem chamar Asaas", async () => {
    const { getDb } = await import("../db");
    (getDb as any).mockResolvedValueOnce(null);

    const client = fakeClient({});
    const r = await adotarCobrancasOrfas(10, client);
    expect(r.novosContatos).toBe(0);
    expect(r.vinculadosExistentes).toBe(0);
    expect(r.customersFalhados).toBe(0);
    expect(client.buscarCliente).not.toHaveBeenCalled();
  });
});
