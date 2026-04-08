/**
 * Testes — módulo de billing (Asaas SaaS).
 *
 * Cobre os mappers puros usados pelo webhook + endpoints do router de
 * subscription. NÃO testa integrações HTTP reais (Asaas API) — para
 * isso seria necessário sandbox + credenciais.
 */

import { describe, it, expect } from "vitest";
import {
  mapAsaasStatus,
  isPaymentPaidEvent,
  isPaymentOverdueEvent,
  parseExternalReference,
  dataVencimentoEmDias,
} from "../billing/asaas-billing-mappers";
import { PLANS, getPlanById } from "../billing/products";
import { getLimites } from "../billing/plan-limits";

// ─── Mappers de status ──────────────────────────────────────────────────

describe("mapAsaasStatus", () => {
  it("ACTIVE → active", () => {
    expect(mapAsaasStatus("ACTIVE")).toBe("active");
  });

  it("INACTIVE → canceled", () => {
    expect(mapAsaasStatus("INACTIVE")).toBe("canceled");
  });

  it("EXPIRED → canceled", () => {
    expect(mapAsaasStatus("EXPIRED")).toBe("canceled");
  });

  it("status desconhecido → incomplete (estado seguro)", () => {
    expect(mapAsaasStatus("FOO")).toBe("incomplete");
    expect(mapAsaasStatus("")).toBe("incomplete");
    expect(mapAsaasStatus("active")).toBe("incomplete"); // case-sensitive
  });
});

// ─── Detecção de pagamento confirmado ───────────────────────────────────

describe("isPaymentPaidEvent", () => {
  it("reconhece via nome do evento", () => {
    expect(isPaymentPaidEvent("PAYMENT_RECEIVED", "")).toBe(true);
    expect(isPaymentPaidEvent("PAYMENT_CONFIRMED", "")).toBe(true);
  });

  it("reconhece via status (fallback)", () => {
    expect(isPaymentPaidEvent("OUTRO_EVENTO", "RECEIVED")).toBe(true);
    expect(isPaymentPaidEvent("OUTRO_EVENTO", "CONFIRMED")).toBe(true);
  });

  it("rejeita pagamento não confirmado", () => {
    expect(isPaymentPaidEvent("PAYMENT_OVERDUE", "OVERDUE")).toBe(false);
    expect(isPaymentPaidEvent("PAYMENT_CREATED", "PENDING")).toBe(false);
  });
});

describe("isPaymentOverdueEvent", () => {
  it("reconhece OVERDUE via evento ou status", () => {
    expect(isPaymentOverdueEvent("PAYMENT_OVERDUE", "")).toBe(true);
    expect(isPaymentOverdueEvent("OUTRO", "OVERDUE")).toBe(true);
  });

  it("rejeita não-overdue", () => {
    expect(isPaymentOverdueEvent("PAYMENT_RECEIVED", "RECEIVED")).toBe(false);
  });
});

// ─── Parse de externalReference ─────────────────────────────────────────

describe("parseExternalReference", () => {
  it("formato padrão userId:planId", () => {
    expect(parseExternalReference("42:profissional")).toEqual({
      userId: 42,
      planId: "profissional",
    });
  });

  it("apenas userId", () => {
    expect(parseExternalReference("42")).toEqual({
      userId: 42,
      planId: null,
    });
  });

  it("ref vazio ou null", () => {
    expect(parseExternalReference("")).toEqual({ userId: null, planId: null });
    expect(parseExternalReference(null)).toEqual({ userId: null, planId: null });
    expect(parseExternalReference(undefined)).toEqual({
      userId: null,
      planId: null,
    });
  });

  it("userId não numérico → null", () => {
    expect(parseExternalReference("abc:xyz")).toEqual({
      userId: null,
      planId: "xyz",
    });
  });

  it("rejeita userId com sufixo não numérico", () => {
    expect(parseExternalReference("42abc:plano")).toEqual({
      userId: null,
      planId: "plano",
    });
  });
});

// ─── Cálculo de data de vencimento ──────────────────────────────────────

describe("dataVencimentoEmDias", () => {
  it("retorna formato YYYY-MM-DD", () => {
    const r = dataVencimentoEmDias(3, new Date("2025-01-15T12:00:00Z"));
    expect(r).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("soma dias corretamente", () => {
    const r = dataVencimentoEmDias(3, new Date("2025-01-15T12:00:00Z"));
    expect(r).toBe("2025-01-18");
  });

  it("lida com mudança de mês", () => {
    const r = dataVencimentoEmDias(5, new Date("2025-01-30T12:00:00Z"));
    expect(r).toBe("2025-02-04");
  });

  it("lida com mudança de ano", () => {
    const r = dataVencimentoEmDias(3, new Date("2025-12-30T12:00:00Z"));
    expect(r).toBe("2026-01-02");
  });
});

// ─── Estrutura dos planos ───────────────────────────────────────────────

describe("PLANS (jurify products)", () => {
  it("tem exatamente 3 planos: iniciante, profissional, escritorio", () => {
    expect(PLANS).toHaveLength(3);
    const ids = PLANS.map((p) => p.id);
    expect(ids).toEqual(["iniciante", "profissional", "escritorio"]);
  });

  it("preços anuais sempre menores que 12x mensal (desconto)", () => {
    for (const plan of PLANS) {
      expect(plan.priceYearly).toBeLessThan(plan.priceMonthly * 12);
      expect(plan.priceYearly).toBeGreaterThan(0);
    }
  });

  it("todos têm currency BRL", () => {
    for (const plan of PLANS) {
      expect(plan.currency).toBe("brl");
    }
  });

  it("profissional é o popular", () => {
    const popular = PLANS.filter((p) => p.popular);
    expect(popular).toHaveLength(1);
    expect(popular[0].id).toBe("profissional");
  });

  it("getPlanById retorna o plano correto", () => {
    expect(getPlanById("profissional")?.name).toBe("Profissional");
    expect(getPlanById("inexistente")).toBeUndefined();
  });
});

// ─── Plan limits batem com products ─────────────────────────────────────

describe("plan-limits.ts <-> products.ts", () => {
  it("todo planId em PLANS tem limites definidos", () => {
    for (const plan of PLANS) {
      const limits = getLimites(plan.id);
      // Não deve cair no fallback "free"
      expect(limits.maxClientes).toBeGreaterThan(10);
    }
  });

  it("escritorio tem limites ilimitados (>= 999999)", () => {
    const lim = getLimites("escritorio");
    expect(lim.maxClientes).toBeGreaterThanOrEqual(999999);
    expect(lim.maxColaboradores).toBeGreaterThanOrEqual(999999);
  });

  it("planId desconhecido cai no plano free (trial)", () => {
    const lim = getLimites("plano-fake-xyz");
    expect(lim.maxClientes).toBe(10); // free tier
  });

  it("hierarquia de limites: iniciante < profissional < escritorio", () => {
    const ini = getLimites("iniciante");
    const pro = getLimites("profissional");
    const esc = getLimites("escritorio");

    expect(ini.maxClientes).toBeLessThan(pro.maxClientes);
    expect(pro.maxClientes).toBeLessThan(esc.maxClientes);
    expect(ini.maxColaboradores).toBeLessThanOrEqual(pro.maxColaboradores);
    expect(pro.maxColaboradores).toBeLessThanOrEqual(esc.maxColaboradores);
  });
});
