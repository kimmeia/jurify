/**
 * Variáveis de cobrança (link de pagamento, PIX copia-e-cola, código de
 * barras) expostas nos gatilhos de pagamento — pra montar a mensagem de
 * cobrança vencida / a vencer com os dados do Asaas.
 */
import { describe, it, expect } from "vitest";
import { CATALOGO_VARIAVEIS, interpolarVariaveis } from "../smartflow/interpolar";

describe("SmartFlow — variáveis de link/PIX/boleto da cobrança", () => {
  it("expõe link, boleto, PIX e código de barras no gatilho pagamento_vencido", () => {
    const g = CATALOGO_VARIAVEIS.find((c) => c.gatilho === "pagamento_vencido");
    expect(g).toBeTruthy();
    const paths = g!.variaveis.map((v) => v.path);
    expect(paths).toEqual(
      expect.arrayContaining(["linkPagamento", "linkBoleto", "pixCopiaECola", "codigoBarras", "formaPagamento"]),
    );
  });

  it("também expõe no gatilho pagamento_proximo_vencimento", () => {
    const g = CATALOGO_VARIAVEIS.find((c) => c.gatilho === "pagamento_proximo_vencimento");
    expect(g).toBeTruthy();
    const paths = g!.variaveis.map((v) => v.path);
    expect(paths).toEqual(expect.arrayContaining(["linkPagamento", "pixCopiaECola", "codigoBarras"]));
  });

  it("interpola os valores da cobrança numa mensagem", () => {
    const ctx = {
      nomeCliente: "Ana",
      linkPagamento: "https://asaas.com/i/abc",
      pixCopiaECola: "00020126360014br.gov.bcb.pix",
      codigoBarras: "23793.38128 60007.812",
    };
    const msg = interpolarVariaveis(
      "Oi {{nomeCliente}}, pague em {{linkPagamento}} ou PIX {{pixCopiaECola}} (boleto {{codigoBarras}})",
      ctx as any,
    );
    expect(msg).toBe(
      "Oi Ana, pague em https://asaas.com/i/abc ou PIX 00020126360014br.gov.bcb.pix (boleto 23793.38128 60007.812)",
    );
  });
});
