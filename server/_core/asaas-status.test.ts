import { describe, expect, it } from "vitest";
import {
  STATUS_PAGO_ASAAS,
  STATUS_PENDENTE_ASAAS,
  STATUS_VENCIDO_ASAAS,
} from "./asaas-status";

describe("asaas-status — agrupamento dos cards do painel", () => {
  it("status pago cobre os 4 caminhos de recebimento", () => {
    expect(STATUS_PAGO_ASAAS).toContain("RECEIVED");
    expect(STATUS_PAGO_ASAAS).toContain("CONFIRMED");
    expect(STATUS_PAGO_ASAAS).toContain("RECEIVED_IN_CASH");
    expect(STATUS_PAGO_ASAAS).toContain("DUNNING_RECEIVED");
  });

  it("status pendente cobre PENDING + estados intermediários do gateway", () => {
    expect(STATUS_PENDENTE_ASAAS).toContain("PENDING");
    expect(STATUS_PENDENTE_ASAAS).toContain("AWAITING_RISK_ANALYSIS");
    expect(STATUS_PENDENTE_ASAAS).toContain("AUTHORIZED");
  });

  it("status vencido cobre OVERDUE e dunning solicitado", () => {
    expect(STATUS_VENCIDO_ASAAS).toContain("OVERDUE");
    expect(STATUS_VENCIDO_ASAAS).toContain("DUNNING_REQUESTED");
  });

  it("os 3 grupos são disjuntos — nenhum status entra em mais de uma categoria", () => {
    const pagos = new Set<string>(STATUS_PAGO_ASAAS);
    const pendentes = new Set<string>(STATUS_PENDENTE_ASAAS);
    const vencidos = new Set<string>(STATUS_VENCIDO_ASAAS);

    for (const s of pagos) {
      expect(pendentes.has(s)).toBe(false);
      expect(vencidos.has(s)).toBe(false);
    }
    for (const s of pendentes) {
      expect(vencidos.has(s)).toBe(false);
    }
  });

  it("estornos e chargebacks ficam FORA dos 3 cards (intencional)", () => {
    const todos = new Set<string>([
      ...STATUS_PAGO_ASAAS,
      ...STATUS_PENDENTE_ASAAS,
      ...STATUS_VENCIDO_ASAAS,
    ]);
    expect(todos.has("REFUNDED")).toBe(false);
    expect(todos.has("REFUND_REQUESTED")).toBe(false);
    expect(todos.has("REFUND_IN_PROGRESS")).toBe(false);
    expect(todos.has("CHARGEBACK_REQUESTED")).toBe(false);
    expect(todos.has("CHARGEBACK_DISPUTE")).toBe(false);
    expect(todos.has("AWAITING_CHARGEBACK_REVERSAL")).toBe(false);
  });
});
