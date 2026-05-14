/**
 * Testes do cache de linha digitável de boleto.
 *
 * Linha digitável é imutável por boleto: uma vez emitida pelo Asaas,
 * o número não muda. Antes, toda vez que o usuário pedia "copiar
 * boleto" o sistema fazia 1 chamada Asaas (GET /payments/:id/
 * identificationField). Agora cacheamos em `asaas_cobrancas.
 * linhaDigitavelPayload` (JSON serializado dos 3 campos).
 *
 * Os testes cobrem a lógica de decisão isoladamente — sem instanciar
 * a procedure tRPC (que exige auth e DB completo).
 */

import { describe, it, expect } from "vitest";

interface LinhaDigitavelPayload {
  identificationField: string;
  nossoNumero: string;
  barCode: string;
}

/**
 * Réplica testável da lógica de decisão da procedure `obterLinhaDigitavel`.
 * Retorna o payload e indica se houve hit de cache ou se chamou o Asaas.
 */
function decidirRetornoLinhaDigitavel(params: {
  cobrancaTemPaymentId: boolean;
  payloadCacheado: string | null;
  asaasResposta: LinhaDigitavelPayload | null;
}): {
  payload: LinhaDigitavelPayload | null;
  fonte: "cache" | "asaas" | "erro_payment_id_ausente";
  deveCachear: boolean;
} {
  if (!params.cobrancaTemPaymentId) {
    return {
      payload: null,
      fonte: "erro_payment_id_ausente",
      deveCachear: false,
    };
  }

  if (params.payloadCacheado) {
    try {
      return {
        payload: JSON.parse(params.payloadCacheado) as LinhaDigitavelPayload,
        fonte: "cache",
        deveCachear: false,
      };
    } catch {
      // JSON corrompido (improvável): cai pro Asaas
    }
  }

  if (!params.asaasResposta) {
    return { payload: null, fonte: "asaas", deveCachear: false };
  }

  return {
    payload: params.asaasResposta,
    fonte: "asaas",
    deveCachear: true,
  };
}

const payloadValido: LinhaDigitavelPayload = {
  identificationField: "23793.39001 23456.789012 34567.890123 1 12340000010000",
  nossoNumero: "123456789",
  barCode: "23791234500000100002339000123456789012345678901",
};

describe("obterLinhaDigitavel — cache hit", () => {
  it("payload cacheado válido: retorna do DB sem chamar Asaas", () => {
    const r = decidirRetornoLinhaDigitavel({
      cobrancaTemPaymentId: true,
      payloadCacheado: JSON.stringify(payloadValido),
      asaasResposta: null,
    });
    expect(r.fonte).toBe("cache");
    expect(r.payload).toEqual(payloadValido);
    expect(r.deveCachear).toBe(false);
  });

  it("preserva todos os 3 campos do payload no roundtrip JSON", () => {
    const r = decidirRetornoLinhaDigitavel({
      cobrancaTemPaymentId: true,
      payloadCacheado: JSON.stringify(payloadValido),
      asaasResposta: null,
    });
    expect(r.payload?.identificationField).toBe(payloadValido.identificationField);
    expect(r.payload?.nossoNumero).toBe(payloadValido.nossoNumero);
    expect(r.payload?.barCode).toBe(payloadValido.barCode);
  });
});

describe("obterLinhaDigitavel — cache miss", () => {
  it("payload nunca cacheado: chama Asaas e marca pra cachear", () => {
    const r = decidirRetornoLinhaDigitavel({
      cobrancaTemPaymentId: true,
      payloadCacheado: null,
      asaasResposta: payloadValido,
    });
    expect(r.fonte).toBe("asaas");
    expect(r.payload).toEqual(payloadValido);
    expect(r.deveCachear).toBe(true);
  });

  it("payload cacheado mas JSON corrompido: fallback pra Asaas", () => {
    const r = decidirRetornoLinhaDigitavel({
      cobrancaTemPaymentId: true,
      payloadCacheado: "{nao-eh-json-valido",
      asaasResposta: payloadValido,
    });
    expect(r.fonte).toBe("asaas");
    expect(r.payload).toEqual(payloadValido);
    expect(r.deveCachear).toBe(true);
  });
});

describe("obterLinhaDigitavel — casos de erro", () => {
  it("cobrança sem paymentId (manual): erro sem chamar Asaas", () => {
    const r = decidirRetornoLinhaDigitavel({
      cobrancaTemPaymentId: false,
      payloadCacheado: null,
      asaasResposta: null,
    });
    expect(r.fonte).toBe("erro_payment_id_ausente");
    expect(r.payload).toBeNull();
  });

  it("Asaas falha (sem cache + sem resposta): retorna null", () => {
    const r = decidirRetornoLinhaDigitavel({
      cobrancaTemPaymentId: true,
      payloadCacheado: null,
      asaasResposta: null,
    });
    expect(r.fonte).toBe("asaas");
    expect(r.payload).toBeNull();
    expect(r.deveCachear).toBe(false);
  });
});

describe("Redução de tráfego — simulação", () => {
  it("10 cópias do mesmo boleto: 1 chamada Asaas + 9 hits", () => {
    let chamadasAsaas = 0;
    let cache: string | null = null;

    const simularCopia = () => {
      const r = decidirRetornoLinhaDigitavel({
        cobrancaTemPaymentId: true,
        payloadCacheado: cache,
        asaasResposta: payloadValido,
      });
      if (r.fonte === "asaas" && r.payload) {
        chamadasAsaas++;
        if (r.deveCachear) cache = JSON.stringify(r.payload);
      }
    };

    for (let i = 0; i < 10; i++) simularCopia();

    expect(chamadasAsaas).toBe(1);
  });

  it("100 cópias de 5 boletos diferentes: 5 chamadas Asaas (não 100)", () => {
    let chamadasAsaas = 0;
    // Cache por cobrança (5 cobranças, cada uma com seu cache)
    const cachePorCobranca: (string | null)[] = [null, null, null, null, null];

    const simularCopia = (cobrancaIdx: number) => {
      const r = decidirRetornoLinhaDigitavel({
        cobrancaTemPaymentId: true,
        payloadCacheado: cachePorCobranca[cobrancaIdx],
        asaasResposta: payloadValido,
      });
      if (r.fonte === "asaas" && r.payload) {
        chamadasAsaas++;
        if (r.deveCachear)
          cachePorCobranca[cobrancaIdx] = JSON.stringify(r.payload);
      }
    };

    // 100 cópias, ciclando entre 5 boletos
    for (let i = 0; i < 100; i++) simularCopia(i % 5);

    expect(chamadasAsaas).toBe(5);
  });
});
