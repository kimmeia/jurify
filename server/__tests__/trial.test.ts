/**
 * Testes do fluxo de trial (Fase 3 do roadmap de Planos).
 *
 * Cobre lógica pura de `temAcessoAtivo` com os novos campos + validação
 * de input das procedures. Fluxo completo (iniciar → cron → expira) precisa
 * de DB real (testes de integração).
 */

import { describe, expect, it } from "vitest";
import { temAcessoAtivo } from "../db";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

const AGORA = Date.now();
const UM_DIA = 24 * 60 * 60 * 1000;

function subBase() {
  return {
    status: "active" as const,
    cortesia: false,
    cortesiaExpiraEm: null,
    trialExpiraEm: null,
  };
}

describe("temAcessoAtivo — Fase 3 (com trialExpiraEm)", () => {
  it("status=active libera independente de trial", () => {
    expect(temAcessoAtivo({ ...subBase(), status: "active" })).toBe(true);
  });

  it("status=trialing sem trialExpiraEm libera (compat retroativa)", () => {
    expect(temAcessoAtivo({ ...subBase(), status: "trialing", trialExpiraEm: null })).toBe(true);
  });

  it("status=trialing com trial ainda válido (3 dias restantes) libera", () => {
    expect(temAcessoAtivo({
      ...subBase(),
      status: "trialing",
      trialExpiraEm: AGORA + 3 * UM_DIA,
    })).toBe(true);
  });

  it("status=trialing com trial expirado BLOQUEIA (defesa em profundidade)", () => {
    expect(temAcessoAtivo({
      ...subBase(),
      status: "trialing",
      trialExpiraEm: AGORA - 1 * UM_DIA,
    })).toBe(false);
  });

  it("status=trialing expirando NESTE INSTANTE bloqueia (boundary)", () => {
    expect(temAcessoAtivo({
      ...subBase(),
      status: "trialing",
      trialExpiraEm: AGORA - 1,
    })).toBe(false);
  });

  it("cortesia ativa SEMPRE libera (mesmo com trial expirado)", () => {
    expect(temAcessoAtivo({
      ...subBase(),
      status: "trialing",
      trialExpiraEm: AGORA - 10 * UM_DIA,
      cortesia: true,
      cortesiaExpiraEm: null,
    })).toBe(true);
  });

  it("cortesia expirada + trial expirado BLOQUEIA", () => {
    expect(temAcessoAtivo({
      ...subBase(),
      status: "trialing",
      trialExpiraEm: AGORA - UM_DIA,
      cortesia: true,
      cortesiaExpiraEm: AGORA - UM_DIA,
    })).toBe(false);
  });

  it("status=canceled BLOQUEIA (não importa trial)", () => {
    expect(temAcessoAtivo({
      ...subBase(),
      status: "canceled",
      trialExpiraEm: AGORA + UM_DIA,
    })).toBe(false);
  });

  it("status=past_due BLOQUEIA", () => {
    expect(temAcessoAtivo({ ...subBase(), status: "past_due" })).toBe(false);
  });
});

function createAnonymousContext(): { ctx: TrpcContext } {
  const ctx: TrpcContext = {
    user: undefined,
    req: {
      protocol: "https",
      headers: {},
      ip: "127.0.0.1",
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as unknown as TrpcContext["res"],
  };
  return { ctx };
}

describe("subscription.iniciarTrial — validação de input", () => {
  it("rejeita planoSlug vazio", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.subscription.iniciarTrial({ planoSlug: "" }))
      .rejects.toThrow();
  });

  it("rejeita sem usuário autenticado (procedure protegida)", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.subscription.iniciarTrial({ planoSlug: "basico" }))
      .rejects.toThrow();
  });
});
