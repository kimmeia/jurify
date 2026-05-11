/**
 * Testes — `temAcessoAtivo` (cortesia + status).
 *
 * Cortesia tem prioridade sobre status. Foco aqui: garantir que toda
 * combinação de (status, cortesia, expira) retorna o booleano certo —
 * gates de plano dependem disso.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db", async () => {
  const actual = await vi.importActual<any>("../db");
  return { ...actual, getDb: vi.fn(async () => null) };
});

const { temAcessoAtivo } = await import("../db");

describe("temAcessoAtivo — cortesia ON", () => {
  it("cortesia sem expira: sempre libera (mesmo com status canceled)", () => {
    expect(
      temAcessoAtivo({ status: "canceled", cortesia: true, cortesiaExpiraEm: null }),
    ).toBe(true);
  });

  it("cortesia com expira no futuro: libera", () => {
    const futuro = Date.now() + 60 * 60 * 1000;
    expect(
      temAcessoAtivo({ status: "past_due", cortesia: true, cortesiaExpiraEm: futuro }),
    ).toBe(true);
  });

  it("cortesia com expira no passado: NÃO libera (mesmo se status='active' seria true via fallback)", () => {
    const passado = Date.now() - 60 * 60 * 1000;
    expect(
      temAcessoAtivo({ status: "canceled", cortesia: true, cortesiaExpiraEm: passado }),
    ).toBe(false);
  });

  it("cortesia com expira no passado MAS status='active': não cai no fallback (cortesia tem prioridade)", () => {
    // Decisão: se admin marcou cortesia com expiração, quer que expire mesmo
    // que a sub normal esteja ativa. Caso de uso: cliente piloto vira pagante,
    // remove cortesia explicitamente. Se esquecer, expiração trava o acesso
    // pelo limite original — não vaza.
    const passado = Date.now() - 1000;
    expect(
      temAcessoAtivo({ status: "active", cortesia: true, cortesiaExpiraEm: passado }),
    ).toBe(false);
  });
});

describe("temAcessoAtivo — cortesia OFF (comportamento legacy)", () => {
  it("status='active' libera", () => {
    expect(temAcessoAtivo({ status: "active", cortesia: false, cortesiaExpiraEm: null })).toBe(true);
  });

  it("status='trialing' libera", () => {
    expect(temAcessoAtivo({ status: "trialing", cortesia: false, cortesiaExpiraEm: null })).toBe(true);
  });

  it("status='canceled' bloqueia", () => {
    expect(temAcessoAtivo({ status: "canceled", cortesia: false, cortesiaExpiraEm: null })).toBe(false);
  });

  it("status='past_due' bloqueia", () => {
    expect(temAcessoAtivo({ status: "past_due", cortesia: false, cortesiaExpiraEm: null })).toBe(false);
  });

  it("status='incomplete' bloqueia", () => {
    expect(temAcessoAtivo({ status: "incomplete", cortesia: false, cortesiaExpiraEm: null })).toBe(false);
  });

  it("status='unpaid' bloqueia", () => {
    expect(temAcessoAtivo({ status: "unpaid", cortesia: false, cortesiaExpiraEm: null })).toBe(false);
  });

  it("status='paused' bloqueia", () => {
    expect(temAcessoAtivo({ status: "paused", cortesia: false, cortesiaExpiraEm: null })).toBe(false);
  });
});

describe("temAcessoAtivo — sub virtual (sem planId, cortesia)", () => {
  it("sub virtual com status='active' e cortesia=true libera", () => {
    // Cenário: cliente piloto que nunca pagou. Admin marca cortesia
    // direto no detalhe do cliente, sistema cria uma sub virtual com
    // planId=null + status='active' + cortesia=true. Helper deve liberar
    // pela rota da cortesia, não pela rota do status.
    expect(
      temAcessoAtivo({ status: "active", cortesia: true, cortesiaExpiraEm: null }),
    ).toBe(true);
  });

  it("sub virtual com cortesia removida fica pendurada — status='active' libera (escolha do admin)", () => {
    // Admin removeu cortesia mas não cancelou a sub virtual. A sub
    // sobra com status='active' e cortesia=false. Comportamento esperado:
    // status='active' libera (não há diferença local entre virtual e real).
    // Admin pode cancelar via cancelarAssinaturaAdmin se quiser cortar acesso.
    expect(
      temAcessoAtivo({ status: "active", cortesia: false, cortesiaExpiraEm: null }),
    ).toBe(true);
  });
});

describe("temAcessoAtivo — fronteira de expiração", () => {
  let datenowSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    datenowSpy?.mockRestore();
  });

  it("expira exatamente no instante atual: NÃO libera (strict >)", () => {
    const now = 1_000_000;
    datenowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    expect(
      temAcessoAtivo({ status: "canceled", cortesia: true, cortesiaExpiraEm: now }),
    ).toBe(false);
  });

  it("expira 1ms no futuro: libera", () => {
    const now = 1_000_000;
    datenowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    expect(
      temAcessoAtivo({ status: "canceled", cortesia: true, cortesiaExpiraEm: now + 1 }),
    ).toBe(true);
  });
});
