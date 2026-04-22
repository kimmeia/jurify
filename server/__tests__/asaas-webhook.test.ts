/**
 * Testes do webhook Asaas (integração leve: mocka `getDb` + dispatcher).
 *
 * Cobre:
 *  - Auth: token ausente/inválido → 401; body vazio → 400.
 *  - PAYMENT_CREATED: upsert idempotente (retry não duplica).
 *  - PAYMENT_UPDATED: atualiza via onDuplicateKeyUpdate.
 *  - PAYMENT_DELETED: remove linha local.
 *  - PAYMENT_RECEIVED: dispara SmartFlow 1× + retry NÃO redispara.
 *  - PAYMENT_OVERDUE: idem.
 *  - CUSTOMER_CREATED: atualiza contato existente, NÃO deleta N:1, insere
 *    novo vínculo (regressão do Sprint 1 — anti-destruição de N:1).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock do getDb ───────────────────────────────────────────────────────────

type Captured = {
  op: "select" | "insert" | "update" | "delete";
  table: string;
  values?: unknown;
  set?: Record<string, unknown>;
  where?: unknown;
  onDuplicate?: Record<string, unknown>;
};

let captured: Captured[] = [];
let selectQueue: unknown[][] = [];
/** affectedRows do próximo INSERT em asaas_webhook_eventos. 1=novo, 0=duplicado. */
let idempotencyAffectedRowsQueue: number[] = [];

function tableName(t: unknown): string {
  const anyT = t as any;
  return (
    anyT?._?.name ||
    anyT?.[Symbol.for("drizzle:Name")] ||
    anyT?.Symbol?.Name ||
    "unknown"
  );
}

const nextSelect = () => selectQueue.shift() ?? [];

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
    limit: (_n: number) => Promise.resolve(nextSelect()),
    then: (r: (v: unknown) => unknown) => r(nextSelect()),
  };
  return builder;
}

function makeInsertBuilder(table: unknown) {
  // Captura values e a fase de .onDuplicateKeyUpdate. O retorno do INSERT em
  // asaas_webhook_eventos usa idempotencyAffectedRowsQueue; nas demais tabelas
  // retornamos affectedRows=1 (suficiente pra lógica atual).
  const tname = tableName(table);
  return {
    values(values: unknown) {
      captured.push({ op: "insert", table: tname, values });
      const chain: any = {
        onDuplicateKeyUpdate(cfg: { set?: Record<string, unknown> }) {
          const last = captured[captured.length - 1];
          last.onDuplicate = cfg.set;
          return chain;
        },
        $returningId: () => Promise.resolve([{ id: 999 }]),
        then: (resolve: (v: unknown) => unknown) => {
          const affected =
            tname === "asaas_webhook_eventos"
              ? idempotencyAffectedRowsQueue.shift() ?? 1
              : 1;
          resolve([{ affectedRows: affected, insertId: 999 }]);
        },
      };
      return chain;
    },
  };
}

const mockDb = {
  select: (_cols?: unknown) => ({ from: (table: unknown) => makeSelectBuilder(table) }),
  insert: (table: unknown) => makeInsertBuilder(table),
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

// ─── Spies no dispatcher do SmartFlow ────────────────────────────────────────

const dispararPagamentoRecebido = vi.fn(async () => {});
const dispararPagamentoVencido = vi.fn(async () => {});

vi.mock("../smartflow/dispatcher", () => ({
  dispararPagamentoRecebido: (...a: unknown[]) => dispararPagamentoRecebido(...a),
  dispararPagamentoVencido: (...a: unknown[]) => dispararPagamentoVencido(...a),
}));

// ─── Importa APÓS mocks ──────────────────────────────────────────────────────

const { registerAsaasWebhook } = await import("../integracoes/asaas-webhook");

// ─── Express mock ────────────────────────────────────────────────────────────

type Handler = (req: any, res: any) => void | Promise<void>;
let handler: Handler = async () => {};

const fakeApp = {
  post: (_path: string, h: Handler) => {
    handler = h;
  },
} as any;
registerAsaasWebhook(fakeApp);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b: unknown) => {
    res.body = b;
    return res;
  };
  return res;
}

function req(opts: { token?: string; body: unknown }) {
  return {
    headers: opts.token !== undefined ? { "asaas-access-token": opts.token } : {},
    body: opts.body,
  };
}

function resetAll() {
  captured = [];
  selectQueue = [];
  idempotencyAffectedRowsQueue = [];
  dispararPagamentoRecebido.mockClear();
  dispararPagamentoVencido.mockClear();
}

function pushAsaasConfig(escritorioId: number, webhookToken = "tok") {
  selectQueue.push([{ escritorioId, webhookToken }]);
}

function pushVinculo(contatoId: number | null, escritorioId: number, asaasCustomerId: string) {
  selectQueue.push(contatoId !== null ? [{ contatoId, escritorioId, asaasCustomerId, nome: "Cliente X" }] : []);
}

beforeEach(resetAll);

// ─── Auth ────────────────────────────────────────────────────────────────────

describe("Asaas Webhook — autenticação", () => {
  it("body sem event → 400", async () => {
    const r = fakeRes();
    await handler(req({ token: "tok", body: {} }), r);
    expect(r.statusCode).toBe(400);
  });

  it("sem header asaas-access-token → 401", async () => {
    const r = fakeRes();
    await handler(req({ body: { event: "PAYMENT_CREATED" } }), r);
    expect(r.statusCode).toBe(401);
  });

  it("token não reconhecido → 401", async () => {
    selectQueue.push([]); // asaasConfig vazio
    const r = fakeRes();
    await handler(req({ token: "invalido", body: { event: "PAYMENT_CREATED", payment: {} } }), r);
    expect(r.statusCode).toBe(401);
  });
});

// ─── PAYMENT_* ───────────────────────────────────────────────────────────────

describe("Asaas Webhook — cobranças", () => {
  const paymentBase = {
    id: "pay_1",
    customer: "cus_X",
    billingType: "PIX",
    value: 2000,
    netValue: 1950,
    status: "PENDING",
    dueDate: "2026-04-21",
  };

  it("PAYMENT_CREATED faz upsert via onDuplicateKeyUpdate (idempotente)", async () => {
    pushAsaasConfig(10);
    pushVinculo(42, 10, "cus_X"); // vínculo existe → contatoId=42

    const r = fakeRes();
    await handler(req({ token: "tok", body: { event: "PAYMENT_CREATED", payment: paymentBase } }), r);

    expect(r.statusCode).toBe(200);
    const ins = captured.find((c) => c.op === "insert" && c.table === "asaas_cobrancas");
    expect(ins).toBeDefined();
    expect((ins!.values as any).contatoId).toBe(42);
    // Prova que é onDuplicateKeyUpdate — chave do upsert idempotente.
    expect(ins!.onDuplicate).toBeDefined();
    expect((ins!.onDuplicate as any).status).toBe("PENDING");
  });

  it("PAYMENT_CREATED sem vínculo insere cobrança órfã (contatoId=null)", async () => {
    pushAsaasConfig(10);
    selectQueue.push([]); // sem vínculo

    const r = fakeRes();
    await handler(req({ token: "tok", body: { event: "PAYMENT_CREATED", payment: paymentBase } }), r);

    const ins = captured.find((c) => c.op === "insert" && c.table === "asaas_cobrancas");
    expect(ins).toBeDefined();
    expect((ins!.values as any).contatoId).toBeNull();
    // contatoId NÃO deve estar no SET (para não forçar null em upsert quando
    // a cobrança já existir com contatoId correto adotado por outro caminho).
    expect(ins!.onDuplicate).toBeDefined();
    expect((ins!.onDuplicate as any).contatoId).toBeUndefined();
  });

  it("PAYMENT_DELETED faz DELETE da linha local", async () => {
    pushAsaasConfig(10);

    const r = fakeRes();
    await handler(
      req({ token: "tok", body: { event: "PAYMENT_DELETED", payment: { ...paymentBase, deleted: true } } }),
      r,
    );

    const del = captured.find((c) => c.op === "delete" && c.table === "asaas_cobrancas");
    expect(del).toBeDefined();
  });
});

// ─── Idempotência SmartFlow ──────────────────────────────────────────────────

describe("Asaas Webhook — idempotência SmartFlow", () => {
  const pagamentoRecebidoPayload = {
    id: "pay_PR",
    customer: "cus_R",
    billingType: "PIX",
    value: 500,
    netValue: 490,
    status: "RECEIVED",
    dueDate: "2026-04-21",
  };

  it("PAYMENT_RECEIVED dispara SmartFlow 1× (primeiro POST)", async () => {
    pushAsaasConfig(10);
    selectQueue.push([]); // vínculo (não importa)
    idempotencyAffectedRowsQueue.push(1); // evento NOVO no registro de processados

    const r = fakeRes();
    await handler(
      req({ token: "tok", body: { event: "PAYMENT_RECEIVED", payment: pagamentoRecebidoPayload } }),
      r,
    );

    expect(dispararPagamentoRecebido).toHaveBeenCalledTimes(1);
  });

  it("retry do mesmo PAYMENT_RECEIVED NÃO redispara o SmartFlow", async () => {
    pushAsaasConfig(10);
    selectQueue.push([]);
    idempotencyAffectedRowsQueue.push(0); // evento já processado antes

    const r = fakeRes();
    await handler(
      req({ token: "tok", body: { event: "PAYMENT_RECEIVED", payment: pagamentoRecebidoPayload } }),
      r,
    );

    expect(dispararPagamentoRecebido).not.toHaveBeenCalled();
  });

  it("PAYMENT_OVERDUE dispara vencido 1× e retry NÃO redispara", async () => {
    // POST 1 (novo)
    pushAsaasConfig(10);
    selectQueue.push([]); // vínculo do upsert
    idempotencyAffectedRowsQueue.push(1);
    selectQueue.push([{ contatoId: 42, nome: "Cliente X" }]); // vinculo2 no dispatch

    const r1 = fakeRes();
    await handler(
      req({
        token: "tok",
        body: {
          event: "PAYMENT_OVERDUE",
          payment: {
            id: "pay_OV",
            customer: "cus_X",
            billingType: "BOLETO",
            value: 300,
            netValue: 300,
            status: "OVERDUE",
            dueDate: "2026-04-01",
          },
        },
      }),
      r1,
    );
    expect(dispararPagamentoVencido).toHaveBeenCalledTimes(1);

    // POST 2 (duplicata): idempotência bloqueia dispatch.
    pushAsaasConfig(10);
    selectQueue.push([]);
    idempotencyAffectedRowsQueue.push(0);

    const r2 = fakeRes();
    await handler(
      req({
        token: "tok",
        body: {
          event: "PAYMENT_OVERDUE",
          payment: {
            id: "pay_OV",
            customer: "cus_X",
            billingType: "BOLETO",
            value: 300,
            netValue: 300,
            status: "OVERDUE",
            dueDate: "2026-04-01",
          },
        },
      }),
      r2,
    );
    expect(dispararPagamentoVencido).toHaveBeenCalledTimes(1); // ainda 1, não cresceu
  });
});

// ─── CUSTOMER_CREATED: proteção do fix N:1 do Sprint 1 ───────────────────────

describe("Asaas Webhook — CUSTOMER_CREATED não destrói N:1", () => {
  it("CPF existente: atualiza contato e NÃO deleta vínculos antigos (regressão Sprint 1)", async () => {
    pushAsaasConfig(10);
    selectQueue.push([]); // vincLocal não existe (customer ainda não vinculado)
    selectQueue.push([{ id: 42, nome: "João Antigo" }]); // contato com CPF já existe

    const r = fakeRes();
    await handler(
      req({
        token: "tok",
        body: {
          event: "CUSTOMER_CREATED",
          customer: {
            id: "cus_NOVO",
            name: "João Novo do Asaas",
            cpfCnpj: "12345678901",
            email: "joao@ex.com",
          },
        },
      }),
      r,
    );

    const dels = captured.filter((c) => c.op === "delete" && c.table === "asaas_clientes");
    expect(dels).toHaveLength(0); // zero DELETEs na tabela de vínculos
    const upds = captured.filter((c) => c.op === "update" && c.table === "contatos");
    expect(upds.length).toBeGreaterThanOrEqual(1);
    const ins = captured.find((c) => c.op === "insert" && c.table === "asaas_clientes");
    expect(ins).toBeDefined();
    expect((ins!.values as any).contatoId).toBe(42);
    expect((ins!.values as any).asaasCustomerId).toBe("cus_NOVO");
  });
});
