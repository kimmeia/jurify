/**
 * Testes — `verificarLimite`/`moduloDisponivel` respeitam trial (status='trialing').
 *
 * Regressão: a query local antiga só casava status='active' OU cortesia=true,
 * então um trial do Completo caía no fallback "free" (maxClientes=10,
 * maxAgentesIa=0) — o gate de módulo (requireModulo) liberava agentes_ia mas
 * a criação era barrada pelo limite do free. Agora ambos usam a regra
 * canônica de `getActiveSubscription` (cortesia válida OU active OU trialing
 * dentro do prazo).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  ownerRow: [{ ownerId: 7 }] as Array<{ ownerId: number }>,
  count: 0,
  sub: null as null | { planId: string | null; status: string; cortesia: boolean },
};

function makeDb() {
  function newBuilder() {
    const b: any = {
      from: () => b,
      where: () => b,
      // 1ª query (escritório) usa .limit(1); counts são awaited direto (thenable).
      limit: async () => state.ownerRow,
      then: (resolve: any) => resolve([{ count: state.count, total: state.count }]),
    };
    return b;
  }
  return { select: () => newBuilder() };
}

vi.mock("../db", () => ({
  getDb: vi.fn(async () => makeDb()),
  getActiveSubscription: vi.fn(async () => state.sub),
}));

const { getActiveSubscription } = await import("../db");
const { verificarLimite, moduloDisponivel } = await import("../billing/plan-limits");

beforeEach(() => {
  state.ownerRow = [{ ownerId: 7 }];
  state.count = 0;
  state.sub = null;
  vi.mocked(getActiveSubscription).mockClear();
});

describe("verificarLimite — trial (status='trialing')", () => {
  it("trial do Completo libera agentes_ia (maximo 5, não o 0 do free)", async () => {
    state.sub = { planId: "completo", status: "trialing", cortesia: false };
    state.count = 0;
    const r = await verificarLimite(1, 7, "agentes_ia");
    expect(r.permitido).toBe(true);
    expect(r.maximo).toBe(5);
    expect(r.planId).toBe("completo");
    expect(getActiveSubscription).toHaveBeenCalledWith(7);
  });

  it("trial do Completo usa teto de clientes do Completo (50 clientes passa; free barraria em 10)", async () => {
    state.sub = { planId: "completo", status: "trialing", cortesia: false };
    state.count = 50;
    const r = await verificarLimite(1, 7, "clientes");
    expect(r.permitido).toBe(true);
    expect(r.planId).toBe("completo");
  });

  it("limite do plano continua valendo no trial (5/5 agentes barra)", async () => {
    state.sub = { planId: "completo", status: "trialing", cortesia: false };
    state.count = 5;
    const r = await verificarLimite(1, 7, "agentes_ia");
    expect(r.permitido).toBe(false);
    expect(r.maximo).toBe(5);
  });
});

describe("verificarLimite — sem sub e cortesia", () => {
  it("sem sub ativa cai no free (agentes_ia bloqueado)", async () => {
    state.sub = null;
    const r = await verificarLimite(1, 7, "agentes_ia");
    expect(r.permitido).toBe(false);
    expect(r.maximo).toBe(0);
    expect(r.planId).toBe("free");
  });

  it("cortesia libera sem limite (maximo -1)", async () => {
    state.sub = { planId: "completo", status: "canceled", cortesia: true };
    const r = await verificarLimite(1, 7, "clientes");
    expect(r.permitido).toBe(true);
    expect(r.maximo).toBe(-1);
  });
});

describe("moduloDisponivel — trial e cortesia", () => {
  it("trial do Completo libera módulo agentes_ia", async () => {
    state.sub = { planId: "completo", status: "trialing", cortesia: false };
    expect(await moduloDisponivel(1, "agentes_ia")).toBe(true);
  });

  it("sem sub ativa: módulo agentes_ia indisponível (free)", async () => {
    state.sub = null;
    expect(await moduloDisponivel(1, "agentes_ia")).toBe(false);
  });

  it("cortesia libera qualquer módulo", async () => {
    state.sub = { planId: null, status: "canceled", cortesia: true };
    expect(await moduloDisponivel(1, "processos")).toBe(true);
  });
});
