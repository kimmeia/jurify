/**
 * Cancelar a assinatura honrando a cláusula 5 dos Termos: "ao cancelar, o
 * acesso permanece até o fim do período já pago".
 *
 *  - `canceled` + `cancelAtPeriodEnd` + `fimPeriodoPagoEm` no futuro LIBERA
 *    (e só assim — sem a flag ou sem a data continua bloqueando na hora);
 *  - `getActiveSubscription` escolhe cortesia > active > trialing > cancelada
 *    em carência, nessa ordem;
 *  - `subscription.cancel` recusa cancelar duas vezes, decide a data ANTES
 *    de apagar no Asaas, grava a carência e devolve `acessoAte`;
 *  - os outros três lugares que gravam `canceled` (painel, financeiro,
 *    webhook SUBSCRIPTION_DELETED) gravam a carência também;
 *  - o webhook de pagamento calcula o período pago pelo ciclo real
 *    (1 mês / 1 ano, fim do dia civil do escritório; 30 dias sem ciclo);
 *  - `reativar` cria assinatura NOVA no Asaas e só então mexe na linha —
 *    falha do Asaas não muda nada;
 *  - a assinatura nova paga encerra também a cancelada em carência;
 *  - o e-mail "acesso termina em 3 dias" sai uma vez só.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { TrpcContext } from "../_core/context";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const captured = {
  inserts: [] as { table: string; values: any }[],
  updates: [] as { table: string; set: any }[],
};
const filas: Record<string, any[][]> = {};
/** Linhas "vivas": quando não há fila enfileirada, o select devolve estas e o update as altera. */
const store: Record<string, any[]> = {};

function tableName(t: any): string {
  return (t?.[Symbol.for("drizzle:Name")] as string) || "";
}

function proximaFila(table: string): any[] {
  const fila = filas[table];
  if (fila && fila.length > 0) return fila.shift()!;
  return store[table] ? store[table].map((r) => ({ ...r })) : [];
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
          const table = tableName(t);
          captured.updates.push({ table, set: s });
          for (const r of store[table] ?? []) Object.assign(r, s);
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

vi.mock("../db", async () => {
  const actual = await vi.importActual<any>("../db");
  return {
    ...actual,
    getDb: vi.fn(async () => dbInstance),
    getActiveSubscription: (...a: unknown[]) => getActiveSubscriptionMock(...(a as [])),
    getUserSubscriptions: (...a: unknown[]) => getUserSubscriptionsMock(...(a as [])),
    getActiveSubscriptionComHeranca: (...a: unknown[]) => getActiveSubscriptionComHerancaMock(...(a as [])),
  };
});

const cancelarAssinatura = vi.fn(async () => undefined);
const criarAssinatura = vi.fn(async (_input: any) => ({ id: "sub_reativada" }));
const listarCobrancas = vi.fn(async () => ({ data: [] as any[] }));
vi.mock("../billing/asaas-billing-client", () => ({
  getAdminAsaasClient: vi.fn(async () => ({ cancelarAssinatura, criarAssinatura, listarCobrancas })),
  isAsaasBillingConfigured: async () => true,
  getAsaasBillingWebhookSecret: vi.fn(async () => "segredo"),
}));

vi.mock("../billing/products-resolver", () => ({
  getPlanByIdResolved: vi.fn(async (id: string) =>
    id === "pro" ? { id, name: "Profissional", priceMonthly: 19900, priceYearly: 199000, currency: "brl" } : null,
  ),
  getPlansResolved: vi.fn(async () => []),
}));

vi.mock("../billing/planos-repo", () => ({
  getPlanoBySlug: vi.fn(async (slug: string) => ({ slug, nome: "Profissional", precoSobConsulta: false, trialDias: 14, limites: { creditosCalculosMes: 10 } })),
  getPlanosVisiveis: vi.fn(async () => []),
}));

const emailCancelada = vi.fn(async () => ({ success: true }));
const emailTermina3Dias = vi.fn(async () => ({ success: true }));
vi.mock("../_core/email", async () => {
  const actual = await vi.importActual<any>("../_core/email");
  return {
    ...actual,
    enviarEmailAssinaturaCancelada: (...a: unknown[]) => emailCancelada(...(a as [])),
    enviarEmailAcessoTermina3Dias: (...a: unknown[]) => emailTermina3Dias(...(a as [])),
  };
});

const { temAcessoAtivo, escolherAssinaturaAtiva, emCarenciaDeCancelamento } = await import("../db");
const { appRouter } = await import("../routers");
const { encerrarOutrasAssinaturas } = await import("../billing/assinatura-substituicao");
const { registerAsaasBillingWebhook } = await import("../billing/asaas-billing-webhook");
const { processarAvisosFimDeAcesso } = await import("../billing/trial-cron");
const { fimDoPeriodoPago, vencimentoAposFimDoAcesso, camposDeCancelamento, cicloDoAsaas } = await import("../billing/periodo-pago");
const { fimDoDiaNoFuso } = await import("../../shared/escritorio-types");

const DIA = 24 * 60 * 60 * 1000;

function fakeCtx(role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X", loginMethod: "google",
      role, asaasCustomerId: "cus_1",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: { host: "app.juridflow.com.br" } } as any,
    res: { clearCookie: () => {} } as any,
  };
}
const caller = () => appRouter.createCaller(fakeCtx());
const admin = () => appRouter.createCaller(fakeCtx("admin"));

const base = { cortesia: false, cortesiaExpiraEm: null, trialExpiraEm: null, cancelAtPeriodEnd: false, fimPeriodoPagoEm: null };

beforeEach(() => {
  captured.inserts = [];
  captured.updates = [];
  cancelarAssinatura.mockClear();
  criarAssinatura.mockReset();
  criarAssinatura.mockResolvedValue({ id: "sub_reativada" });
  emailCancelada.mockClear();
  emailTermina3Dias.mockClear();
  getActiveSubscriptionMock.mockReset();
  getActiveSubscriptionMock.mockResolvedValue(null);
  for (const k of Object.keys(filas)) delete filas[k];
  for (const k of Object.keys(store)) delete store[k];
});

describe("temAcessoAtivo — carência de cancelamento", () => {
  it("canceled sem flag bloqueia; com flag e data futura libera; com data passada bloqueia", () => {
    const futuro = Date.now() + DIA;
    expect(temAcessoAtivo({ ...base, status: "canceled" })).toBe(false);
    expect(temAcessoAtivo({ ...base, status: "canceled", fimPeriodoPagoEm: futuro })).toBe(false);
    expect(temAcessoAtivo({ ...base, status: "canceled", cancelAtPeriodEnd: true })).toBe(false);
    expect(temAcessoAtivo({ ...base, status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: futuro })).toBe(true);
    expect(temAcessoAtivo({ ...base, status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: Date.now() - 1 })).toBe(false);
  });

  it("a carência não vaza pra outros status nem passa por cima da cortesia vencida", () => {
    const futuro = Date.now() + DIA;
    expect(temAcessoAtivo({ ...base, status: "past_due", cancelAtPeriodEnd: true, fimPeriodoPagoEm: futuro })).toBe(false);
    expect(temAcessoAtivo({ ...base, status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: futuro, cortesia: true, cortesiaExpiraEm: Date.now() - 1 })).toBe(false);
  });

  it("emCarenciaDeCancelamento é a mesma régua, exportada pra tela", () => {
    expect(emCarenciaDeCancelamento({ status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: Date.now() + DIA })).toBe(true);
    expect(emCarenciaDeCancelamento({ status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: Date.now() + DIA, cortesia: true })).toBe(false);
    expect(emCarenciaDeCancelamento({ status: "active", cancelAtPeriodEnd: true, fimPeriodoPagoEm: Date.now() + DIA })).toBe(false);
    expect(emCarenciaDeCancelamento(null)).toBe(false);
  });
});

describe("escolherAssinaturaAtiva — ordem explícita", () => {
  const futuro = Date.now() + 10 * DIA;
  const carencia = { id: 1, ...base, status: "canceled" as const, cancelAtPeriodEnd: true, fimPeriodoPagoEm: futuro };
  const active = { id: 2, ...base, status: "active" as const };
  const trial = { id: 3, ...base, status: "trialing" as const, trialExpiraEm: futuro };
  const cortesia = { id: 4, ...base, status: "canceled" as const, cortesia: true };

  it("cortesia > active > trialing > cancelada em carência, independente da ordem do banco", () => {
    expect(escolherAssinaturaAtiva([carencia, trial, active, cortesia])?.id).toBe(4);
    expect(escolherAssinaturaAtiva([carencia, trial, active])?.id).toBe(2);
    expect(escolherAssinaturaAtiva([carencia, trial])?.id).toBe(3);
    expect(escolherAssinaturaAtiva([carencia])?.id).toBe(1);
  });

  it("cancelada fora da carência não é escolhida", () => {
    expect(escolherAssinaturaAtiva([{ ...carencia, fimPeriodoPagoEm: Date.now() - 1 }])).toBeNull();
    expect(escolherAssinaturaAtiva([{ ...carencia, cancelAtPeriodEnd: false }])).toBeNull();
  });
});

describe("periodo-pago (puro)", () => {
  it("fim do período pago segue o ciclo, até o fim do dia civil do escritório; sem ciclo = 30 dias", () => {
    const tz = "America/Sao_Paulo";
    expect(fimDoPeriodoPago("2026-09-03", "monthly", tz)).toBe(fimDoDiaNoFuso("2026-10-03", tz).getTime());
    expect(fimDoPeriodoPago("2026-09-03", "yearly", tz)).toBe(fimDoDiaNoFuso("2027-09-03", tz).getTime());
    expect(fimDoPeriodoPago("2026-01-31", "monthly", tz)).toBe(fimDoDiaNoFuso("2026-02-28", tz).getTime());
    expect(fimDoPeriodoPago("2026-09-03", null, tz)).toBe(Date.UTC(2026, 8, 3) + 30 * DIA);
    expect(fimDoPeriodoPago("lixo", "monthly", tz)).toBeNull();
    expect(fimDoPeriodoPago("2026-09-03", "monthly", "America/Manaus")).toBe(fimDoDiaNoFuso("2026-10-03", "America/Manaus").getTime());
  });

  it("o vencimento da reativação é o dia seguinte ao fim do acesso, no fuso", () => {
    const tz = "America/Sao_Paulo";
    expect(vencimentoAposFimDoAcesso(fimDoDiaNoFuso("2026-10-03", tz).getTime(), tz)).toBe("2026-10-04");
    expect(vencimentoAposFimDoAcesso(fimDoDiaNoFuso("2026-12-31", tz).getTime(), tz)).toBe("2027-01-01");
  });

  it("camposDeCancelamento: flag sempre; data = período pago, senão vencimento futuro, senão nada", () => {
    const agora = 1_000_000;
    expect(camposDeCancelamento({ fimPeriodoPagoEm: 2_000_000, currentPeriodEnd: 3_000_000 }, agora)).toEqual({ status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: 2_000_000 });
    expect(camposDeCancelamento({ fimPeriodoPagoEm: null, currentPeriodEnd: 3_000_000 }, agora)).toEqual({ status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: 3_000_000 });
    expect(camposDeCancelamento({ fimPeriodoPagoEm: 500, currentPeriodEnd: 600 }, agora)).toEqual({ status: "canceled", cancelAtPeriodEnd: true });
    expect(camposDeCancelamento(null, agora)).toEqual({ status: "canceled", cancelAtPeriodEnd: true });
  });

  it("cycle do Asaas → ciclo local", () => {
    expect(cicloDoAsaas("MONTHLY")).toBe("monthly");
    expect(cicloDoAsaas("YEARLY")).toBe("yearly");
    expect(cicloDoAsaas("WEEKLY")).toBeNull();
    expect(cicloDoAsaas(undefined)).toBeNull();
  });
});

describe("subscription.cancel", () => {
  const ativa = { id: 7, userId: 100, asaasSubscriptionId: "sub_1", asaasCustomerId: "cus_1", planId: "pro", status: "active", cortesia: false, fimPeriodoPagoEm: Date.now() + 20 * DIA, currentPeriodEnd: Date.now() + 25 * DIA };

  it("recusa cancelar duas vezes, sem tocar no Asaas", async () => {
    getActiveSubscriptionMock.mockResolvedValue({ ...ativa, status: "canceled", cancelAtPeriodEnd: true });
    await expect(caller().subscription.cancel()).rejects.toThrow("Esta assinatura já foi cancelada.");
    expect(cancelarAssinatura).not.toHaveBeenCalled();
    expect(captured.updates).toHaveLength(0);
  });

  it("apaga no Asaas, grava canceled + carência e devolve até quando o acesso fica", async () => {
    getActiveSubscriptionMock.mockResolvedValue(ativa);
    const r = await caller().subscription.cancel();
    expect(cancelarAssinatura).toHaveBeenCalledWith("sub_1");
    expect(r).toEqual({ success: true, acessoAte: ativa.fimPeriodoPagoEm, acessoEncerraAgora: false });
    const upd = captured.updates.find((u) => u.table === "subscriptions");
    expect(upd?.set).toEqual({ status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: ativa.fimPeriodoPagoEm });
    expect(emailCancelada).toHaveBeenCalledTimes(1);
    expect((emailCancelada.mock.calls[0] as any)[0]).toEqual(expect.objectContaining({ email: "x@y.z", planoNome: "Profissional", acessoAte: ativa.fimPeriodoPagoEm }));
  });

  it("assinatura antiga (sem período pago gravado) cai no vencimento futuro", async () => {
    getActiveSubscriptionMock.mockResolvedValue({ ...ativa, fimPeriodoPagoEm: null });
    const r = await caller().subscription.cancel();
    expect(r.acessoAte).toBe(ativa.currentPeriodEnd);
    expect(captured.updates[0].set.fimPeriodoPagoEm).toBe(ativa.currentPeriodEnd);
  });

  it("sem período pago nem vencimento futuro: o acesso encerra na hora, e o retorno diz isso", async () => {
    getActiveSubscriptionMock.mockResolvedValue({ ...ativa, fimPeriodoPagoEm: null, currentPeriodEnd: Date.now() - DIA });
    const r = await caller().subscription.cancel();
    expect(r).toEqual({ success: true, acessoAte: null, acessoEncerraAgora: true });
    expect(captured.updates[0].set).toEqual({ status: "canceled", cancelAtPeriodEnd: true });
  });

  it("previaCancelamento mostra a data que o diálogo escreve", async () => {
    getActiveSubscriptionMock.mockResolvedValue(ativa);
    expect(await caller().subscription.previaCancelamento()).toEqual({ planName: "Profissional", jaCancelada: false, acessoAte: ativa.fimPeriodoPagoEm });
    getActiveSubscriptionMock.mockResolvedValue(null);
    expect(await caller().subscription.previaCancelamento()).toBeNull();
  });
});

describe("os outros três lugares que gravam canceled gravam a carência (decisão 4c)", () => {
  it("admin.cancelarAssinaturaAdmin", async () => {
    const fim = Date.now() + 15 * DIA;
    filas["subscriptions"] = [[{ id: 9, userId: 100, status: "active", asaasSubscriptionId: "sub_9", planId: "pro", fimPeriodoPagoEm: null, currentPeriodEnd: fim }]];
    filas["users"] = [[{ id: 100, name: "X", email: "x@y.z" }]];
    await admin().admin.cancelarAssinaturaAdmin({ subscriptionId: 9, motivo: "pediu por e-mail" });
    const upd = captured.updates.find((u) => u.table === "subscriptions");
    expect(upd?.set).toEqual({ status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: fim });
  });

  it("adminFinanceiro.cancelarAssinaturaPorAsaasId", async () => {
    const fim = Date.now() + 15 * DIA;
    filas["subscriptions"] = [[{ fimPeriodoPagoEm: fim, currentPeriodEnd: fim + DIA }]];
    await admin().adminFinanceiro.cancelarAssinaturaPorAsaasId({ asaasSubscriptionId: "sub_9", motivo: "inadimplente" });
    expect(cancelarAssinatura).toHaveBeenCalledWith("sub_9");
    const upd = captured.updates.find((u) => u.table === "subscriptions");
    expect(upd?.set).toEqual({ status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: fim });
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

  it("SUBSCRIPTION_DELETED grava canceled com a carência", async () => {
    const fim = Date.now() + 9 * DIA;
    filas["subscriptions"] = [[{ id: 2, userId: 100, status: "active", fimPeriodoPagoEm: fim, currentPeriodEnd: fim }]];
    await chamar({ event: "SUBSCRIPTION_DELETED", subscription: { id: "sub_2", customer: "cus_1", status: "INACTIVE", externalReference: "100:pro" } });
    const upd = captured.updates.find((u) => u.table === "subscriptions");
    expect(upd?.set).toEqual({ status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: fim });
  });

  it("SUBSCRIPTION_CREATED/UPDATED gravam o ciclo do payload (e preservam o existente quando o payload não traz)", async () => {
    filas["subscriptions"] = [[]];
    await chamar({ event: "SUBSCRIPTION_CREATED", subscription: { id: "sub_n", customer: "cus_1", status: "ACTIVE", cycle: "YEARLY", externalReference: "100:pro" } });
    expect(captured.inserts.find((i) => i.table === "subscriptions")?.values.ciclo).toBe("yearly");

    filas["subscriptions"] = [[{ id: 3, status: "incomplete", currentPeriodEnd: null, planId: "pro", ciclo: "monthly" }]];
    await chamar({ event: "SUBSCRIPTION_UPDATED", subscription: { id: "sub_n", customer: "cus_1", status: "ACTIVE", externalReference: "100:pro" } });
    expect(captured.updates.filter((u) => u.table === "subscriptions").at(-1)?.set.ciclo).toBe("monthly");
  });

  it.each([
    ["monthly", "2026-10-03"],
    ["yearly", "2027-09-03"],
  ] as const)("pagamento confirmado com ciclo %s: período pago = fim do dia civil de vencimento + ciclo, no fuso do escritório", async (ciclo, diaFim) => {
    filas["subscriptions"] = [[{ id: 2, userId: 100, status: "incomplete", currentPeriodEnd: null, ciclo }], []];
    filas["escritorios"] = [[{ fusoHorario: "America/Manaus" }]];
    const antes = Date.now();
    await chamar({
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_1", customer: "cus_1", subscription: "sub_2", status: "RECEIVED", value: 199, dueDate: "2026-09-03", externalReference: "100:pro" },
    });
    const upd = captured.updates.find((u) => u.table === "subscriptions");
    expect(upd?.set.status).toBe("active");
    expect(upd?.set.fimPeriodoPagoEm).toBe(fimDoDiaNoFuso(diaFim, "America/Manaus").getTime());
    expect(upd?.set.ultimoPagamentoEm).toBeGreaterThanOrEqual(antes);
    // currentPeriodEnd continua sendo os 30 dias de sempre — não foi tocado.
    expect(upd?.set.currentPeriodEnd).toBe(Date.UTC(2026, 8, 3) + 30 * DIA);
  });

  it("ciclo desconhecido cai nos 30 dias fixos", async () => {
    filas["subscriptions"] = [[{ id: 2, userId: 100, status: "incomplete", currentPeriodEnd: null, ciclo: null }], []];
    await chamar({
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_1", customer: "cus_1", subscription: "sub_2", status: "CONFIRMED", value: 199, dueDate: "2026-09-03", externalReference: "100:pro" },
    });
    const upd = captured.updates.find((u) => u.table === "subscriptions");
    expect(upd?.set.fimPeriodoPagoEm).toBe(Date.UTC(2026, 8, 3) + 30 * DIA);
  });
});

describe("subscription.reativar (decisão 4b)", () => {
  const fim = fimDoDiaNoFuso("2026-10-03", "America/Sao_Paulo").getTime();
  const cancelada = { id: 7, userId: 100, asaasSubscriptionId: "sub_apagada", asaasCustomerId: "cus_1", planId: "pro", status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: fim, currentPeriodEnd: fim - DIA, ciclo: "monthly", cortesia: false, valorNegociadoCentavos: null };

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-09-20T12:00:00Z"), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cria assinatura nova no Asaas (mesmo cliente, plano, ciclo; vencimento no dia seguinte ao fim do acesso) e volta a MESMA linha pra active", async () => {
    getActiveSubscriptionMock.mockResolvedValue(cancelada);
    filas["users"] = [[{ asaasCustomerId: "cus_1" }]];
    const r = await caller().subscription.reativar();
    expect(r).toEqual({ success: true, asaasSubscriptionId: "sub_reativada", proximaCobranca: "2026-10-04" });
    expect(criarAssinatura).toHaveBeenCalledTimes(1);
    expect((criarAssinatura.mock.calls[0] as any)[0]).toEqual(expect.objectContaining({
      customer: "cus_1", billingType: "UNDEFINED", value: 199, nextDueDate: "2026-10-04", cycle: "MONTHLY", externalReference: "100:pro",
    }));
    const upd = captured.updates.find((u) => u.table === "subscriptions");
    expect(upd?.set).toEqual({ status: "active", cancelAtPeriodEnd: false, asaasSubscriptionId: "sub_reativada", asaasCustomerId: "cus_1", currentPeriodEnd: fim, ciclo: "monthly" });
    expect(captured.inserts.find((i) => i.table === "audit_log")?.values.acao).toBe("subscription.reativar");
  });

  it("valor negociado (base mensal) e ciclo anual: cobra 12× o negociado, YEARLY", async () => {
    getActiveSubscriptionMock.mockResolvedValue({ ...cancelada, ciclo: "yearly", valorNegociadoCentavos: 10000 });
    filas["users"] = [[{ asaasCustomerId: "cus_1" }]];
    await caller().subscription.reativar();
    expect((criarAssinatura.mock.calls[0] as any)[0]).toEqual(expect.objectContaining({ value: 1200, cycle: "YEARLY" }));
  });

  it("se o Asaas falhar, nada muda e o erro volta legível", async () => {
    getActiveSubscriptionMock.mockResolvedValue(cancelada);
    filas["users"] = [[{ asaasCustomerId: "cus_1" }]];
    criarAssinatura.mockRejectedValue(new Error("Asaas rejeitou criarAssinatura (500)"));
    await expect(caller().subscription.reativar()).rejects.toThrow(/Não foi possível reativar agora/);
    expect(captured.updates.filter((u) => u.table === "subscriptions")).toHaveLength(0);
  });

  it("só reativa cancelada em carência: ativa, cancelada sem carência ou sem plano são recusadas antes do Asaas", async () => {
    getActiveSubscriptionMock.mockResolvedValue({ ...cancelada, status: "active" });
    await expect(caller().subscription.reativar()).rejects.toThrow(/ainda dentro do período pago/);
    getActiveSubscriptionMock.mockResolvedValue({ ...cancelada, cancelAtPeriodEnd: false });
    await expect(caller().subscription.reativar()).rejects.toThrow(/ainda dentro do período pago/);
    getActiveSubscriptionMock.mockResolvedValue({ ...cancelada, planId: null });
    await expect(caller().subscription.reativar()).rejects.toThrow(/sem plano/);
    expect(criarAssinatura).not.toHaveBeenCalled();
    expect(captured.updates).toHaveLength(0);
  });
});

describe("encerrarOutrasAssinaturas — a nova paga encerra também a cancelada em carência", () => {
  it("retira a carência (sem chamar o Asaas de novo) e ignora cancelada já vencida", async () => {
    filas["subscriptions"] = [[
      { id: 1, asaasSubscriptionId: "sub_old", cortesia: false, status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: Date.now() + 10 * DIA },
      { id: 5, asaasSubscriptionId: "sub_older", cortesia: false, status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: Date.now() - DIA },
      { id: 6, asaasSubscriptionId: "sub_active", cortesia: false, status: "active" },
    ]];
    const cancelar = vi.fn(async () => undefined);
    const r = await encerrarOutrasAssinaturas(dbInstance as any, 100, 2, cancelar);
    expect(r.encerradas).toEqual([1, 6]);
    expect(cancelar).toHaveBeenCalledTimes(1);
    expect(cancelar).toHaveBeenCalledWith("sub_active");
    expect(captured.updates.map((u) => u.set)).toEqual([
      { status: "canceled", cancelAtPeriodEnd: false },
      { status: "canceled" },
    ]);
  });
});

describe("cron — e-mail 'seu acesso termina em 3 dias'", () => {
  it("avisa uma vez só (janela de 2 a 4 dias), grava a trava e ignora quem está fora da janela", async () => {
    const agora = Date.now();
    store["subscriptions"] = [
      { subId: 1, userId: 100, planId: "pro", status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: agora + 3 * DIA, avisoFimAcessoEnviadoEm: null, userEmail: "x@y.z", userNome: "X" },
    ];
    const r1 = await processarAvisosFimDeAcesso(agora);
    expect(r1.avisos).toBe(1);
    expect(emailTermina3Dias).toHaveBeenCalledTimes(1);
    expect((emailTermina3Dias.mock.calls[0] as any)[0]).toEqual(expect.objectContaining({ email: "x@y.z", planoNome: "Profissional", acessoAte: agora + 3 * DIA }));
    expect(captured.updates.at(-1)?.set).toEqual({ avisoFimAcessoEnviadoEm: agora });

    const r2 = await processarAvisosFimDeAcesso(agora + 60_000);
    expect(r2.avisos).toBe(0);
    expect(emailTermina3Dias).toHaveBeenCalledTimes(1);
  });

  it("fora da janela, sem carência ou sem e-mail: nada sai", async () => {
    const agora = Date.now();
    store["subscriptions"] = [
      { subId: 1, userId: 100, planId: "pro", status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: agora + 10 * DIA, avisoFimAcessoEnviadoEm: null, userEmail: "x@y.z", userNome: "X" },
      { subId: 2, userId: 101, planId: "pro", status: "canceled", cancelAtPeriodEnd: false, fimPeriodoPagoEm: agora + 3 * DIA, avisoFimAcessoEnviadoEm: null, userEmail: "y@y.z", userNome: "Y" },
      { subId: 3, userId: 102, planId: "pro", status: "canceled", cancelAtPeriodEnd: true, fimPeriodoPagoEm: agora + 3 * DIA, avisoFimAcessoEnviadoEm: null, userEmail: null, userNome: "Z" },
    ];
    const r = await processarAvisosFimDeAcesso(agora);
    expect(r.avisos).toBe(0);
    expect(emailTermina3Dias).not.toHaveBeenCalled();
  });
});

describe("amarras de fonte", () => {
  it("migration 0225 cria as quatro colunas com DEFAULT NULL e faz o backfill só em ativa com vencimento futuro", () => {
    const sql = ler("drizzle/0225_assinatura_periodo_pago.sql");
    for (const col of ["ultimo_pagamento_em", "ciclo ENUM('monthly','yearly')", "fim_periodo_pago_em", "aviso_fim_acesso_enviado_em"]) {
      expect(sql).toContain(col);
    }
    expect(sql).toContain("SET fim_periodo_pago_em = currentPeriodEnd");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("currentPeriodEnd > UNIX_TIMESTAMP() * 1000");
    const schema = ler("drizzle/schema.ts");
    for (const campo of ["ultimoPagamentoEm", "fimPeriodoPagoEm", "avisoFimAcessoEnviadoEm", 'mysqlEnum("ciclo", ["monthly", "yearly"])']) {
      expect(schema).toContain(campo);
    }
  });

  it("o ciclo é gravado onde ele é conhecido", () => {
    const sub = ler("server/routers/subscription.ts");
    expect(sub.match(/ciclo: input\.interval/g)?.length).toBeGreaterThanOrEqual(3);
    const adm = ler("server/routers/admin.ts");
    const trocar = adm.slice(adm.indexOf("trocarPlanoAdmin: adminProcedure"), adm.indexOf("ativarAssinaturaNegociada: adminProcedure"));
    expect(trocar.match(/ciclo: input\.interval/g)?.length).toBe(2);
    const negociada = adm.slice(adm.indexOf("ativarAssinaturaNegociada: adminProcedure"), adm.indexOf("marcarCortesia:"));
    expect(negociada.match(/ciclo: input\.interval/g)?.length).toBe(2);
  });

  it("os quatro lugares que gravam canceled passam pela carência; o cron diário está registrado", () => {
    expect(ler("server/routers/admin.ts")).toContain(".set(camposDeCancelamento(sub))");
    expect(ler("server/routers/admin-financeiro.ts")).toContain(".set(camposDeCancelamento(local))");
    expect(ler("server/billing/asaas-billing-webhook.ts")).toContain(".set(camposDeCancelamento(existing))");
    expect(ler("server/_core/cron-jobs.ts")).toContain("processarAvisosFimDeAcesso");
  });

  it("a tela: AlertDialog no lugar do confirm(), textos da cláusula 5, reativar com onError, cancelar some quando cancelada", () => {
    const tela = ler("client/src/pages/Plans.tsx");
    expect(tela).not.toMatch(/\bconfirm\(/);
    expect(tela).toContain("Cancelar a assinatura {previaCancelamento?.planName ?? currentPlanName ?? \"\"}?");
    expect(tela).toContain("Nenhuma cobrança nova será feita. Você continua com acesso a tudo até ${formatDate(dataPreviaCancelamento)}, o fim do período que já pagou. Depois disso a conta fica sem plano — os dados continuam guardados, e você pode reativar até lá sem pagar nada agora.");
    expect(tela).toContain("Acesso até ${formatDate(acessoAte)} — o fim do período que você já pagou. Depois disso a conta fica sem plano.");
    expect(tela).toContain("nenhuma cobrança nova");
    expect(tela).toContain("Reativar assinatura");
    expect(tela).toContain("Reativar cria a assinatura de novo no Asaas, com a primeira cobrança em");
    expect(tela).toContain("Ver planos");
    expect(tela).toContain('currentSub.status !== "trialing" && currentSub.status !== "canceled"');
    const reativar = tela.slice(tela.indexOf("trpc.subscription.reativar.useMutation"), tela.indexOf("const handleSelectPlan"));
    expect(reativar).toContain("onError");
    expect(tela).toContain("trpc.subscription.previaCancelamento.useQuery");
  });

  it("os dois e-mails existem com o tipo próprio no log", () => {
    const email = ler("server/_core/email.ts");
    expect(email).toContain("export async function enviarEmailAssinaturaCancelada(");
    expect(email).toContain('tipo: "assinatura_cancelada"');
    expect(email).toContain("export async function enviarEmailAcessoTermina3Dias(");
    expect(email).toContain('tipo: "acesso_termina_3dias"');
  });
});
