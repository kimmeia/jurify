/**
 * Assinatura do próprio JuridFlow — regra única: o que o cliente tem hoje
 * continua até o pagamento novo ser confirmado.
 *
 *  - trocar de plano NÃO cancela a assinatura paga na hora;
 *  - "Continuar para pagamento" no trial NÃO derruba o trial;
 *  - evento SUBSCRIPTION_* do Asaas NUNCA ativa (o Asaas cria a assinatura
 *    já ACTIVE antes de qualquer pagamento) — só PAYMENT_RECEIVED/CONFIRMED;
 *  - quando a nova é paga, as anteriores são encerradas (menos cortesia).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const captured = {
  inserts: [] as { table: string; values: any }[],
  updates: [] as { table: string; set: any }[],
};
const filas: Record<string, any[][]> = {};

function tableName(t: any): string {
  return (t?.[Symbol.for("drizzle:Name")] as string) || "";
}

function proximaFila(table: string): any[] {
  const fila = filas[table];
  return fila && fila.length > 0 ? fila.shift()! : [];
}

function makeDb() {
  function builder(): any {
    let table = "";
    const b: any = {
      from: (t: any) => { table = tableName(t); return b; },
      innerJoin: () => b,
      leftJoin: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => Promise.resolve(proximaFila(table)),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(proximaFila(table)).then(resolve, reject),
    };
    return b;
  }
  return {
    select: () => builder(),
    insert: (t: any) => ({
      values: (v: any) => {
        captured.inserts.push({ table: tableName(t), values: v });
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (t: any) => ({
      set: (s: any) => ({
        where: () => {
          captured.updates.push({ table: tableName(t), set: s });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    }),
  };
}

const dbInstance = makeDb();
const getActiveSubscriptionMock = vi.fn(async (): Promise<any> => null);
const getUserSubscriptionsMock = vi.fn(async (): Promise<any[]> => []);
const getActiveSubscriptionComHerancaMock = vi.fn(async (): Promise<any> => null);

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbInstance),
  getActiveSubscription: (...a: unknown[]) => getActiveSubscriptionMock(...(a as [])),
  getUserSubscriptions: (...a: unknown[]) => getUserSubscriptionsMock(...(a as [])),
  getActiveSubscriptionComHeranca: (...a: unknown[]) => getActiveSubscriptionComHerancaMock(...(a as [])),
}));

const cancelarAssinatura = vi.fn(async () => undefined);
const criarAssinatura = vi.fn(async () => ({ id: "sub_new" }));
const listarCobrancas = vi.fn(async () => ({
  data: [{ externalReference: "100:pro", invoiceUrl: "https://asaas/i/1", deleted: false }],
}));
vi.mock("../billing/asaas-billing-client", () => ({
  getAdminAsaasClient: vi.fn(async () => ({ cancelarAssinatura, criarAssinatura, listarCobrancas })),
  isAsaasBillingConfigured: () => true,
  getAsaasBillingWebhookSecret: vi.fn(async () => "segredo"),
}));

vi.mock("../billing/products-resolver", () => ({
  getPlanByIdResolved: vi.fn(async (id: string) =>
    id === "pro" || id === "ess"
      ? { id, name: id === "pro" ? "Profissional" : "Essencial", priceMonthly: 19900, priceYearly: 199000, currency: "brl" }
      : null,
  ),
  getPlansResolved: vi.fn(async () => []),
}));

vi.mock("../billing/planos-repo", () => ({
  getPlanoBySlug: vi.fn(async (slug: string) => ({ slug, nome: slug, precoSobConsulta: false, trialDias: 14, limites: { creditosCalculosMes: 10 } })),
  getPlanosVisiveis: vi.fn(async () => []),
}));

const escritorioMock = vi.fn(async (): Promise<any> => ({
  escritorio: { id: 1, ownerId: 100, jaUsouTrial: false },
  colaborador: { id: 10, cargo: "dono" },
}));
vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: (...a: unknown[]) => escritorioMock(...(a as [])),
  criarEscritorio: vi.fn(),
}));

const { appRouter } = await import("../routers");
const { statusAposEventoDeAssinatura } = await import("../billing/asaas-billing-mappers");
const { encerrarOutrasAssinaturas } = await import("../billing/assinatura-substituicao");
const { registerAsaasBillingWebhook } = await import("../billing/asaas-billing-webhook");

function fakeCtx(): TrpcContext {
  return {
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X", loginMethod: "google",
      role: "user", asaasCustomerId: "cus_1",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: { host: "app.juridflow.com.br" } } as any,
    res: { clearCookie: () => {} } as any,
  };
}
const caller = () => appRouter.createCaller(fakeCtx());

const DIA = 24 * 60 * 60 * 1000;

beforeEach(() => {
  captured.inserts = [];
  captured.updates = [];
  cancelarAssinatura.mockClear();
  criarAssinatura.mockClear();
  getActiveSubscriptionMock.mockReset();
  getActiveSubscriptionMock.mockResolvedValue(null);
  getUserSubscriptionsMock.mockReset();
  getUserSubscriptionsMock.mockResolvedValue([]);
  getActiveSubscriptionComHerancaMock.mockReset();
  getActiveSubscriptionComHerancaMock.mockResolvedValue(null);
  escritorioMock.mockReset();
  escritorioMock.mockResolvedValue({ escritorio: { id: 1, ownerId: 100, jaUsouTrial: false }, colaborador: { id: 10, cargo: "dono" } });
  for (const k of Object.keys(filas)) delete filas[k];
});

describe("statusAposEventoDeAssinatura (auth-3)", () => {
  it("ACTIVE nunca promove: sem row vira incomplete, com row mantém o que estava", () => {
    expect(statusAposEventoDeAssinatura(null, "ACTIVE")).toBe("incomplete");
    expect(statusAposEventoDeAssinatura("incomplete", "ACTIVE")).toBe("incomplete");
    expect(statusAposEventoDeAssinatura("trialing", "ACTIVE")).toBe("trialing");
    expect(statusAposEventoDeAssinatura("active", "ACTIVE")).toBe("active");
    expect(statusAposEventoDeAssinatura("past_due", "ACTIVE")).toBe("past_due");
  });
  it("INACTIVE/EXPIRED rebaixam pra canceled", () => {
    expect(statusAposEventoDeAssinatura("active", "INACTIVE")).toBe("canceled");
    expect(statusAposEventoDeAssinatura(null, "EXPIRED")).toBe("canceled");
  });
});

describe("encerrarOutrasAssinaturas", () => {
  it("cancela as outras (Asaas + local) e poupa a cortesia", async () => {
    filas["subscriptions"] = [[
      { id: 1, asaasSubscriptionId: "sub_old", cortesia: false },
      { id: 3, asaasSubscriptionId: null, cortesia: true },
      { id: 4, asaasSubscriptionId: null, cortesia: false },
    ]];
    const cancelar = vi.fn(async () => undefined);
    const r = await encerrarOutrasAssinaturas(dbInstance as any, 100, 2, cancelar);
    expect(r.encerradas).toEqual([1, 4]);
    expect(cancelar).toHaveBeenCalledWith("sub_old");
    expect(cancelar).toHaveBeenCalledTimes(1);
    expect(captured.updates.map((u) => u.set)).toEqual([{ status: "canceled" }, { status: "canceled" }]);
  });

  it("falha no Asaas não impede o status local", async () => {
    filas["subscriptions"] = [[{ id: 1, asaasSubscriptionId: "sub_old", cortesia: false }]];
    const cancelar = vi.fn(async () => { throw new Error("Asaas fora"); });
    const r = await encerrarOutrasAssinaturas(dbInstance as any, 100, 2, cancelar);
    expect(r.encerradas).toEqual([1]);
    expect(captured.updates).toHaveLength(1);
  });
});

describe("subscription.changePlan (auth-1)", () => {
  it("cria a nova como incomplete e NÃO cancela a atual", async () => {
    getActiveSubscriptionMock.mockResolvedValue({ id: 1, asaasSubscriptionId: "sub_old", asaasCustomerId: "cus_1", planId: "ess", status: "active" });
    filas["users"] = [[{ id: 100, asaasCustomerId: "cus_1" }]];
    filas["subscriptions"] = [[]];

    const r = await caller().subscription.changePlan({ newPlanId: "pro", interval: "monthly" });

    expect(r.asaasSubscriptionId).toBe("sub_new");
    expect(r.url).toBe("https://asaas/i/1");
    expect(cancelarAssinatura).not.toHaveBeenCalled();
    expect(captured.updates.filter((u) => u.table === "subscriptions")).toHaveLength(0);
    const ins = captured.inserts.find((i) => i.table === "subscriptions");
    expect(ins?.values).toEqual(expect.objectContaining({ userId: 100, planId: "pro", status: "incomplete", asaasSubscriptionId: "sub_new" }));
  });
});

describe("subscription.createCheckout no trial (auth-2)", () => {
  it("mantém trialing, estende o prazo de pagamento e amarra a assinatura Asaas", async () => {
    const agora = Date.now();
    filas["users"] = [[{ id: 100, asaasCustomerId: "cus_1" }]];
    filas["subscriptions"] = [[], [{ id: 2, status: "trialing", trialExpiraEm: agora + 2 * DIA }]];

    const r = await caller().subscription.createCheckout({ planId: "pro", interval: "monthly" });

    expect(r.asaasSubscriptionId).toBe("sub_new");
    const upd = captured.updates.find((u) => u.table === "subscriptions");
    expect(upd?.set.status).toBe("trialing");
    expect(upd?.set.asaasSubscriptionId).toBe("sub_new");
    expect(upd?.set.trialConvertido).toBe(true);
    expect(upd?.set.trialExpiraEm).toBeGreaterThanOrEqual(agora + 7 * DIA - 5000);
    expect(captured.inserts.filter((i) => i.table === "subscriptions")).toHaveLength(0);
  });

  it("trial com mais de 7 dias não é encurtado", async () => {
    const agora = Date.now();
    filas["users"] = [[{ id: 100, asaasCustomerId: "cus_1" }]];
    filas["subscriptions"] = [[], [{ id: 2, status: "trialing", trialExpiraEm: agora + 12 * DIA }]];
    await caller().subscription.createCheckout({ planId: "pro", interval: "monthly" });
    const upd = captured.updates.find((u) => u.table === "subscriptions");
    expect(upd?.set.trialExpiraEm).toBe(agora + 12 * DIA);
  });
});

describe("subscription.trocaPendente / desistirTroca", () => {
  const atual = { id: 1, asaasSubscriptionId: "sub_old", asaasCustomerId: "cus_1", planId: "ess", status: "active", cortesia: false };
  const nova = { id: 2, asaasSubscriptionId: "sub_new", asaasCustomerId: "cus_1", planId: "pro", status: "incomplete", cortesia: false };

  it("mostra a troca ainda não paga com nome do plano e link da cobrança", async () => {
    getActiveSubscriptionMock.mockResolvedValue(atual);
    getUserSubscriptionsMock.mockResolvedValue([atual, nova]);
    const r = await caller().subscription.trocaPendente();
    expect(r).toEqual({ subLocalId: 2, planId: "pro", planName: "Profissional", invoiceUrl: "https://asaas/i/1" });
  });

  it("sem pendente devolve null", async () => {
    getActiveSubscriptionMock.mockResolvedValue(atual);
    getUserSubscriptionsMock.mockResolvedValue([atual]);
    expect(await caller().subscription.trocaPendente()).toBeNull();
  });

  it("desistir cancela SÓ a nova", async () => {
    getActiveSubscriptionMock.mockResolvedValue(atual);
    getUserSubscriptionsMock.mockResolvedValue([atual, nova]);
    const r = await caller().subscription.desistirTroca();
    expect(r).toEqual({ success: true, canceladas: 1 });
    expect(cancelarAssinatura).toHaveBeenCalledWith("sub_new");
    expect(cancelarAssinatura).not.toHaveBeenCalledWith("sub_old");
    expect(captured.updates).toEqual([{ table: "subscriptions", set: { status: "canceled" } }]);
  });
});

describe("subscription.trialDisponivel", () => {
  it("dono sem trial usado e sem assinatura: disponível", async () => {
    expect(await caller().subscription.trialDisponivel()).toEqual({ disponivel: true, motivo: null });
  });
  it("já usou o trial: indisponível", async () => {
    escritorioMock.mockResolvedValue({ escritorio: { id: 1, ownerId: 100, jaUsouTrial: true }, colaborador: { id: 10 } });
    expect((await caller().subscription.trialDisponivel()).motivo).toBe("ja_usou");
  });
  it("colaborador (não dono): indisponível", async () => {
    escritorioMock.mockResolvedValue({ escritorio: { id: 1, ownerId: 7, jaUsouTrial: false }, colaborador: { id: 10 } });
    expect((await caller().subscription.trialDisponivel()).motivo).toBe("colaborador");
  });
  it("com assinatura ativa: indisponível", async () => {
    getActiveSubscriptionComHerancaMock.mockResolvedValue({ id: 1, status: "active" });
    expect((await caller().subscription.trialDisponivel()).motivo).toBe("assinatura_ativa");
  });
});

describe("webhook de billing", () => {
  type Handler = (req: any, res: any) => Promise<any>;
  let handler: Handler;
  const app = { post: (_path: string, h: Handler) => { handler = h; } } as any;
  registerAsaasBillingWebhook(app);

  function chamar(body: any) {
    const res: any = {
      statusCode: 200,
      body: null,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.body = b; return this; },
    };
    return handler({ headers: { "asaas-access-token": "segredo" }, body }, res).then(() => res);
  }

  it("SUBSCRIPTION_CREATED com ACTIVE cria a row como incomplete (auth-3)", async () => {
    filas["subscriptions"] = [[]];
    const res = await chamar({
      event: "SUBSCRIPTION_CREATED",
      subscription: { id: "sub_new", customer: "cus_1", status: "ACTIVE", externalReference: "100:pro" },
    });
    expect(res.statusCode).toBe(200);
    const ins = captured.inserts.find((i) => i.table === "subscriptions");
    expect(ins?.values.status).toBe("incomplete");
  });

  it("SUBSCRIPTION_UPDATED com ACTIVE não promove trial nem incomplete", async () => {
    filas["subscriptions"] = [[{ id: 2, status: "trialing", currentPeriodEnd: null, planId: "pro" }]];
    await chamar({
      event: "SUBSCRIPTION_UPDATED",
      subscription: { id: "sub_new", customer: "cus_1", status: "ACTIVE", externalReference: "100:pro" },
    });
    const upd = captured.updates.find((u) => u.table === "subscriptions");
    expect(upd?.set.status).toBe("trialing");
  });

  it("PAYMENT_RECEIVED ativa a nova e encerra a anterior (auth-1, fecha o ciclo)", async () => {
    filas["subscriptions"] = [
      [{ id: 2, userId: 100, status: "incomplete", currentPeriodEnd: null }],
      [{ id: 1, asaasSubscriptionId: "sub_old", cortesia: false }],
    ];
    await chamar({
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_1", customer: "cus_1", subscription: "sub_new", status: "RECEIVED", value: 199, dueDate: "2026-09-03", externalReference: "100:pro" },
    });
    const sets = captured.updates.filter((u) => u.table === "subscriptions").map((u) => u.set.status);
    expect(sets).toEqual(["active", "canceled"]);
    expect(cancelarAssinatura).toHaveBeenCalledWith("sub_old");
  });
});
