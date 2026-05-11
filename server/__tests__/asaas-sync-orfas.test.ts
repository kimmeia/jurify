/**
 * Testes — adoção de cobranças órfãs e reconciliação de vínculo N:1.
 *
 * Cenários reais reproduzidos:
 *
 *  1. Webhook PAYMENT_CREATED chega ANTES do usuário vincular o contato —
 *     a linha entra em asaas_cobrancas com contatoId=null (órfã). Ao vincular
 *     e sincronizar, o sync precisa "adotar" essa cobrança (setar contatoId).
 *
 *  2. Sincronização posterior deve, além de status/data, reconciliar o
 *     contatoId quando a cobrança local está órfã ou associada ao contato
 *     errado.
 *
 *  3. Quando nada mudou (status igual, data igual, contatoId correto),
 *     o UPDATE não é disparado — evita write amplification e muda o
 *     contador `stats.atualizadas`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock do getDb ───────────────────────────────────────────────────────────
// Captura cada chamada a insert/update/delete pra inspeção; select retorna
// valores pré-programados por chamada (FIFO).

type Captured = {
  op: "select" | "insert" | "update" | "delete";
  table: string;
  values?: unknown;
  set?: Record<string, unknown>;
  where?: unknown;
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

function makeSelectBuilder(table: unknown) {
  const builder: any = {
    from(_t: unknown) {
      return builder;
    },
    where(w: unknown) {
      captured.push({ op: "select", table: tableName(table), where: w });
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
        $returningId: () => Promise.resolve([{ id: 999 }]),
        then: (r: (v: unknown) => unknown) =>
          r([{ insertId: 999, affectedRows: 1 }]),
      };
    },
  }),
  update: (table: unknown) => ({
    set(set: Record<string, unknown>) {
      return {
        where(where: unknown) {
          captured.push({ op: "update", table: tableName(table), set, where });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      };
    },
  }),
  delete: (table: unknown) => ({
    where(where: unknown) {
      captured.push({ op: "delete", table: tableName(table), where });
      return Promise.resolve([{ affectedRows: 1 }]);
    },
  }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

// ─── Mock do AsaasClient.listarCobrancas ─────────────────────────────────────

type PageRet = {
  data: Array<{
    id: string;
    customer: string;
    dueDate: string;
    value: number;
    netValue: number;
    billingType: string;
    status: string;
    description?: string;
    externalReference?: string;
    invoiceUrl: string;
    bankSlipUrl?: string;
    paymentDate?: string;
    deleted: boolean;
    dateCreated: string;
  }>;
  hasMore: boolean;
  limit: number;
  offset: number;
};

function fakeClient(pages: PageRet[]): any {
  let i = 0;
  const next = async () => pages[i++] ?? { data: [], hasMore: false, limit: 100, offset: 0 };
  return {
    listarCobrancas: vi.fn(next),
    // syncCobrancasDeCliente agora usa `listarCobrancasPorJanela` por
    // default (filtro de 90 dias). Mock devolve as mesmas páginas.
    listarCobrancasPorJanela: vi.fn(next),
  };
}

function payment(overrides: Partial<PageRet["data"][number]> = {}): PageRet["data"][number] {
  return {
    id: "pay_1",
    customer: "cus_X",
    dueDate: "2026-04-21",
    value: 2000,
    netValue: 1950,
    billingType: "PIX",
    status: "PENDING",
    invoiceUrl: "",
    deleted: false,
    dateCreated: "2026-04-01",
    ...overrides,
  };
}

// Importa APÓS mocks
const { syncCobrancasDeCliente, syncTodasCobrancasDoContato } = await import(
  "../integracoes/asaas-sync"
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function resetAll() {
  captured = [];
  selectQueue = [];
}

beforeEach(resetAll);

describe("syncCobrancasDeCliente — adoção de cobrança órfã", () => {
  it("adota a órfã: UPDATE inclui contatoId quando local.contatoId=null e contatoId do vínculo é 42", async () => {
    // 1) SELECT por asaasPaymentId (no loop) → retorna a linha órfã existente
    selectQueue.push([
      {
        id: 99,
        contatoId: null,
        asaasCustomerId: "cus_X",
        status: "PENDING",
        dataPagamento: null,
        valorLiquido: null,
      },
    ]);
    // 2) SELECT de órfãs no final → a própria cobrança continua no set (não removida)
    selectQueue.push([{ id: 99, asaasPaymentId: "pay_1" }]);

    const client = fakeClient([
      { data: [payment({ id: "pay_1", status: "PENDING", customer: "cus_X" })], hasMore: false, limit: 100, offset: 0 },
    ]);

    const stats = await syncCobrancasDeCliente(client as any, /*escritorioId*/ 1, /*contatoId*/ 42, "cus_X");

    const updates = captured.filter((c) => c.op === "update" && c.table.startsWith("asaas_cob"));
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ contatoId: 42 });
    expect(stats.atualizadas).toBe(1);
  });

  it("reatribui asaasCustomerId quando local aponta pro customer errado (merge de duplicatas)", async () => {
    selectQueue.push([
      {
        id: 99,
        contatoId: 42,
        asaasCustomerId: "cus_OLD",
        status: "PENDING",
        dataPagamento: null,
        valorLiquido: null,
      },
    ]);
    selectQueue.push([{ id: 99, asaasPaymentId: "pay_1" }]);

    const client = fakeClient([
      { data: [payment({ id: "pay_1", status: "PENDING", customer: "cus_NEW" })], hasMore: false, limit: 100, offset: 0 },
    ]);

    await syncCobrancasDeCliente(client as any, 1, 42, "cus_NEW");

    const updates = captured.filter((c) => c.op === "update" && c.table.startsWith("asaas_cob"));
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ asaasCustomerId: "cus_NEW" });
  });

  it("NÃO dispara UPDATE quando status/data/valorLiquido/contatoId/asaasCustomerId coincidem", async () => {
    selectQueue.push([
      {
        id: 99,
        contatoId: 42,
        asaasCustomerId: "cus_X",
        status: "PENDING",
        dataPagamento: null,
        valorLiquido: "1950",
      },
    ]);
    selectQueue.push([{ id: 99, asaasPaymentId: "pay_1" }]);

    const client = fakeClient([
      { data: [payment({ id: "pay_1", status: "PENDING", netValue: 1950 })], hasMore: false, limit: 100, offset: 0 },
    ]);

    const stats = await syncCobrancasDeCliente(client as any, 1, 42, "cus_X");

    const updates = captured.filter((c) => c.op === "update" && c.table.startsWith("asaas_cob"));
    expect(updates).toHaveLength(0);
    expect(stats.atualizadas).toBe(0);
  });
});

describe("syncTodasCobrancasDoContato — adoção bulk de órfãs pré-iteração", () => {
  it("executa UPDATE bulk para adotar órfãs de todos os asaasCustomerIds vinculados ao contato ANTES de iterar", async () => {
    // 1) SELECT dos vínculos → dois customers Asaas do mesmo contato
    selectQueue.push([
      { asaasCustomerId: "cus_A" },
      { asaasCustomerId: "cus_B" },
    ]);
    // 2..n) Sync de cus_A: listarCobrancas retorna [] (sem pagamentos). SELECT órfãs → []
    selectQueue.push([]); // loop orfãs cus_A
    // 3..n) Sync de cus_B: idem
    selectQueue.push([]); // loop orfãs cus_B

    const client = fakeClient([
      { data: [], hasMore: false, limit: 100, offset: 0 }, // cus_A
      { data: [], hasMore: false, limit: 100, offset: 0 }, // cus_B
    ]);

    await syncTodasCobrancasDoContato(client as any, /*escritorioId*/ 1, /*contatoId*/ 42);

    const bulkAdota = captured.find(
      (c) =>
        c.op === "update" &&
        c.table.startsWith("asaas_cob") &&
        (c.set as any)?.contatoId === 42,
    );
    expect(bulkAdota).toBeDefined();
  });

  it("não dispara adoção bulk quando o contato tem zero vínculos", async () => {
    selectQueue.push([]); // sem vínculos

    const client = fakeClient([]);

    await syncTodasCobrancasDoContato(client as any, 1, 42);

    const anyUpdate = captured.find((c) => c.op === "update");
    expect(anyUpdate).toBeUndefined();
  });
});
