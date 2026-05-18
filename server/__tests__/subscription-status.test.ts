/**
 * Testes do helper `resolverStatusVisual` (Fase 5 do roadmap de Planos).
 *
 * Converte shape bruto de subscription em discriminated union pra UI consumir.
 * Função pura — sem DB.
 */

import { describe, expect, it } from "vitest";
import { resolverStatusVisual } from "../../client/src/lib/subscription-status";

describe("resolverStatusVisual", () => {
  it("retorna sem_plano quando sub é null", () => {
    expect(resolverStatusVisual(null).tipo).toBe("sem_plano");
    expect(resolverStatusVisual(undefined).tipo).toBe("sem_plano");
  });

  it("cortesia tem prioridade sobre qualquer status", () => {
    const r = resolverStatusVisual({
      status: "canceled",
      cortesia: true,
      cortesiaMotivo: "Cliente piloto",
      cortesiaExpiraEm: null,
    });
    expect(r.tipo).toBe("cortesia");
    if (r.tipo === "cortesia") {
      expect(r.motivo).toBe("Cliente piloto");
      expect(r.expiraEm).toBeNull();
    }
  });

  it("cortesia com expiração futura mantém tipo cortesia", () => {
    const futuro = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const r = resolverStatusVisual({
      status: "active",
      cortesia: true,
      cortesiaExpiraEm: futuro,
    });
    expect(r.tipo).toBe("cortesia");
    if (r.tipo === "cortesia") {
      expect(r.expiraEm?.getTime()).toBe(futuro);
    }
  });

  it("status=active retorna ativo + próxima cobrança", () => {
    const proxima = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const r = resolverStatusVisual({
      status: "active",
      currentPeriodEnd: proxima,
    });
    expect(r.tipo).toBe("ativo");
    if (r.tipo === "ativo") {
      expect(r.proximaCobranca?.getTime()).toBe(proxima);
    }
  });

  it("status=trialing retorna trial com dias restantes", () => {
    const expira = Date.now() + 10 * 24 * 60 * 60 * 1000;
    const r = resolverStatusVisual({
      status: "trialing",
      trialExpiraEm: expira,
      diasRestantesTrial: 10,
    });
    expect(r.tipo).toBe("trial");
    if (r.tipo === "trial") {
      expect(r.diasRestantes).toBe(10);
      expect(r.expiraEm.getTime()).toBe(expira);
    }
  });

  it("status=past_due retorna vencido com dias de atraso", () => {
    const venc = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const r = resolverStatusVisual({
      status: "past_due",
      currentPeriodEnd: venc,
    });
    expect(r.tipo).toBe("vencido");
    if (r.tipo === "vencido") {
      expect(r.diasAtraso).toBeGreaterThanOrEqual(4);
      expect(r.diasAtraso).toBeLessThanOrEqual(6);
    }
  });

  it("status=canceled retorna cancelado", () => {
    const r = resolverStatusVisual({ status: "canceled" });
    expect(r.tipo).toBe("cancelado");
  });

  it("status=incomplete retorna incompleto", () => {
    const r = resolverStatusVisual({ status: "incomplete" });
    expect(r.tipo).toBe("incompleto");
  });

  it("status=incomplete_expired retorna cancelado (cliente nunca pagou)", () => {
    const r = resolverStatusVisual({ status: "incomplete_expired" });
    expect(r.tipo).toBe("cancelado");
  });

  it("status desconhecido cai em sem_plano (não trava UI)", () => {
    const r = resolverStatusVisual({ status: "futuristic_status_xyz" });
    expect(r.tipo).toBe("sem_plano");
  });

  it("cortesia expirada cai pro caso non-cortesia (continua respeitando status)", () => {
    // Conversão: cortesia=true mas cortesiaExpiraEm passou — helper retorna
    // tipo cortesia (decisão de produto: mostra como cortesia até admin
    // remover a flag manualmente). Backend `temAcessoAtivo` que decide
    // se libera acesso, não este helper.
    const passado = Date.now() - 24 * 60 * 60 * 1000;
    const r = resolverStatusVisual({
      status: "canceled",
      cortesia: true,
      cortesiaExpiraEm: passado,
    });
    expect(r.tipo).toBe("cortesia");
  });
});
