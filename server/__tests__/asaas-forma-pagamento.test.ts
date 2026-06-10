/**
 * Testes — mapearFormaPagamento (billingType Asaas → enum local).
 *
 * Regressão do travamento da importação histórica: payments antigos vêm
 * com billingType fora do enum local (DEBIT_CARD/TRANSFER/DEPOSIT) e o
 * INSERT com cast `as any` estourava "Data truncated" no MySQL strict,
 * derrubando a janela do dia inteiro e travando o sync no mesmo ponto.
 */

import { describe, it, expect } from "vitest";
import { mapearFormaPagamento } from "../integracoes/asaas-forma-pagamento";

describe("mapearFormaPagamento", () => {
  it("valores do enum local passam direto", () => {
    for (const v of ["BOLETO", "CREDIT_CARD", "PIX", "UNDEFINED", "DINHEIRO", "TRANSFERENCIA", "OUTRO"] as const) {
      expect(mapearFormaPagamento(v)).toBe(v);
    }
  });

  it("TRANSFER e DEPOSIT viram TRANSFERENCIA", () => {
    expect(mapearFormaPagamento("TRANSFER")).toBe("TRANSFERENCIA");
    expect(mapearFormaPagamento("DEPOSIT")).toBe("TRANSFERENCIA");
  });

  it("DEBIT_CARD agrupa como cartão", () => {
    expect(mapearFormaPagamento("DEBIT_CARD")).toBe("CREDIT_CARD");
  });

  it("vazio/null/undefined viram UNDEFINED", () => {
    expect(mapearFormaPagamento("")).toBe("UNDEFINED");
    expect(mapearFormaPagamento(null)).toBe("UNDEFINED");
    expect(mapearFormaPagamento(undefined)).toBe("UNDEFINED");
    expect(mapearFormaPagamento("   ")).toBe("UNDEFINED");
  });

  it("valor desconhecido cai em OUTRO (nunca lança)", () => {
    expect(mapearFormaPagamento("BOLEPIX")).toBe("OUTRO");
    expect(mapearFormaPagamento("WIRE_TRANSFER")).toBe("OUTRO");
  });

  it("é case-insensitive e tolera espaços", () => {
    expect(mapearFormaPagamento("pix")).toBe("PIX");
    expect(mapearFormaPagamento(" transfer ")).toBe("TRANSFERENCIA");
    expect(mapearFormaPagamento("debit_card")).toBe("CREDIT_CARD");
  });
});
