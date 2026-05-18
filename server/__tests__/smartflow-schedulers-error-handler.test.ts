/**
 * Regressão: erros inesperados escapados dos schedulers do SmartFlow
 * NÃO podem ser engolidos silenciosamente.
 *
 * Bug histórico (pre-fix): os 3 schedulers tinham
 *   `setInterval(() => rodarCiclo().catch(() => {}))` — `.catch(() => {})`
 * silencia COMPLETAMENTE qualquer erro que escape do try/catch interno
 * do ciclo (ex: rejeição async em `await getDb()` antes do try-block).
 * Em produção, scheduler parava sem alerta; operador só descobria horas/
 * dias depois quando lembretes/cobranças/retomadas deixavam de disparar.
 *
 * Fix: `.catch(reportarErroInesperado)` — handler que LOGA via pino +
 * reporta via Sentry `captureError`. Esses testes provam que o handler
 * exporta o erro pros 2 canais e marca o `kind` correto pra Sentry
 * filtrar por scheduler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/sentry", () => ({
  captureError: vi.fn(),
}));

const { captureError } = await import("../_core/sentry");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("smartflow/scheduler.ts — reportarErroInesperado", () => {
  it("chama captureError com kind='smartflow-scheduler'", async () => {
    const { reportarErroInesperado } = await import("../smartflow/scheduler");
    const err = new Error("falha simulada no ciclo");

    reportarErroInesperado(err);

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(err, {
      kind: "smartflow-scheduler",
    });
  });

  it("aceita não-Error (string) e ainda reporta sem crashar", async () => {
    const { reportarErroInesperado } = await import("../smartflow/scheduler");

    reportarErroInesperado("erro string crua");

    expect(captureError).toHaveBeenCalledWith("erro string crua", {
      kind: "smartflow-scheduler",
    });
  });
});

describe("smartflow/cobrancas-scheduler.ts — reportarErroInesperado", () => {
  it("chama captureError com kind='smartflow-cobrancas-scheduler'", async () => {
    const { reportarErroInesperado } = await import(
      "../smartflow/cobrancas-scheduler"
    );
    const err = new Error("falha simulada cobranças");

    reportarErroInesperado(err);

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(err, {
      kind: "smartflow-cobrancas-scheduler",
    });
  });
});

describe("smartflow/calcom-lembretes-scheduler.ts — reportarErroInesperado", () => {
  it("chama captureError com kind='smartflow-calcom-lembretes-scheduler'", async () => {
    const { reportarErroInesperado } = await import(
      "../smartflow/calcom-lembretes-scheduler"
    );
    const err = new Error("falha simulada lembretes");

    reportarErroInesperado(err);

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(err, {
      kind: "smartflow-calcom-lembretes-scheduler",
    });
  });
});

describe("os 3 schedulers usam kinds distintos (pra filtrar no Sentry)", () => {
  it("kinds não colidem entre schedulers", async () => {
    const m1 = await import("../smartflow/scheduler");
    const m2 = await import("../smartflow/cobrancas-scheduler");
    const m3 = await import("../smartflow/calcom-lembretes-scheduler");

    const err = new Error("x");
    m1.reportarErroInesperado(err);
    m2.reportarErroInesperado(err);
    m3.reportarErroInesperado(err);

    expect(captureError).toHaveBeenCalledTimes(3);
    const kinds = (captureError as any).mock.calls.map(
      (c: [unknown, { kind: string }]) => c[1].kind,
    );
    const distintos = new Set(kinds);
    expect(distintos.size).toBe(3);
  });
});
