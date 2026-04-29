/**
 * Testes do helper `extrairDataPagamento` — fallback de campos de
 * data do Asaas. Garante que CONFIRMED e RECEIVED_IN_CASH não fiquem
 * com "Pago em" vazio quando há `confirmedDate` ou `clientPaymentDate`.
 */

import { describe, it, expect } from "vitest";
import { extrairDataPagamento } from "../integracoes/asaas-sync";

describe("extrairDataPagamento", () => {
  it("usa paymentDate quando disponível (RECEIVED — dinheiro caiu)", () => {
    expect(
      extrairDataPagamento({
        paymentDate: "2025-04-15",
        clientPaymentDate: "2025-04-14",
        confirmedDate: "2025-04-13",
      }),
    ).toBe("2025-04-15");
  });

  it("usa clientPaymentDate quando paymentDate vazio (RECEIVED_IN_CASH)", () => {
    expect(
      extrairDataPagamento({
        paymentDate: undefined,
        clientPaymentDate: "2025-04-14",
        confirmedDate: "2025-04-13",
      }),
    ).toBe("2025-04-14");
  });

  it("usa confirmedDate quando os outros estão vazios (CONFIRMED)", () => {
    expect(
      extrairDataPagamento({
        paymentDate: undefined,
        clientPaymentDate: undefined,
        confirmedDate: "2025-04-13",
      }),
    ).toBe("2025-04-13");
  });

  it("retorna null quando nenhum campo está preenchido (PENDING)", () => {
    expect(extrairDataPagamento({})).toBeNull();
  });

  it("trata strings vazias como ausência (paymentDate=\"\")", () => {
    expect(
      extrairDataPagamento({
        paymentDate: "",
        clientPaymentDate: "",
        confirmedDate: "2025-04-13",
      }),
    ).toBe("2025-04-13");
  });

  it("preserva ordem de prioridade — paymentDate vence sempre", () => {
    expect(
      extrairDataPagamento({
        paymentDate: "2025-04-15",
        confirmedDate: "2025-04-10",
      }),
    ).toBe("2025-04-15");
  });
});
