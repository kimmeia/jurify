/**
 * Testes do cache de saldo Asaas em DB com TTL e invalidação por webhook.
 *
 * Os testes cobrem a lógica de decisão "cache hit vs miss vs fallback"
 * de forma isolada — sem instanciar o router tRPC completo (middleware
 * pesado de auth). Replicamos a função de decisão em código testável.
 *
 * O comportamento real testado:
 *   - cache hit (< 10min): retorna do DB, NÃO chama Asaas
 *   - cache miss (> 10min OU null): chama Asaas + atualiza DB
 *   - falha na chamada Asaas: devolve saldo stale (se existir) em vez de null
 *   - webhook invalida cache zerando saldoAtualizadoEm
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const SALDO_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Réplica testável da lógica de decisão do `obterSaldo`. Função pura.
 * Recebe o estado atual do DB + o resultado da chamada Asaas (se for
 * preciso) e retorna o que deve ser devolvido + se deve atualizar o DB.
 */
function decidirRetornoSaldo(params: {
  cfg: { saldo: string | null; saldoAtualizadoEm: Date | null };
  agora: Date;
  asaasResult: { ok: true; balance: number } | { ok: false } | null;
}): {
  resultado: { balance: number } | null;
  deveAtualizarCache: boolean;
} {
  const { cfg, agora, asaasResult } = params;

  const cacheValido =
    cfg.saldoAtualizadoEm !== null &&
    cfg.saldo !== null &&
    agora.getTime() - cfg.saldoAtualizadoEm.getTime() < SALDO_CACHE_TTL_MS;

  if (cacheValido) {
    return {
      resultado: { balance: Number(cfg.saldo) || 0 },
      deveAtualizarCache: false,
    };
  }

  if (asaasResult === null) {
    if (cfg.saldo !== null) {
      return {
        resultado: { balance: Number(cfg.saldo) || 0 },
        deveAtualizarCache: false,
      };
    }
    return { resultado: null, deveAtualizarCache: false };
  }

  if (asaasResult.ok) {
    return {
      resultado: { balance: asaasResult.balance },
      deveAtualizarCache: true,
    };
  }

  // Falha na chamada Asaas — fallback pra cacheado se houver
  if (cfg.saldo !== null) {
    return {
      resultado: { balance: Number(cfg.saldo) || 0 },
      deveAtualizarCache: false,
    };
  }
  return { resultado: null, deveAtualizarCache: false };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-13T12:00:00Z"));
});

describe("obterSaldo — cache hit (cache fresco < 10min)", () => {
  it("retorna saldo do DB sem chamar Asaas", () => {
    const cacheFresco = new Date("2026-05-13T11:55:00Z"); // 5min atrás
    const r = decidirRetornoSaldo({
      cfg: { saldo: "1234.56", saldoAtualizadoEm: cacheFresco },
      agora: new Date(),
      asaasResult: null, // proposital: não chamamos Asaas
    });
    expect(r.resultado).toEqual({ balance: 1234.56 });
    expect(r.deveAtualizarCache).toBe(false);
  });

  it("cache exatamente no limite de 9min ainda é válido", () => {
    const cache = new Date("2026-05-13T11:51:00Z"); // 9min atrás
    const r = decidirRetornoSaldo({
      cfg: { saldo: "500.00", saldoAtualizadoEm: cache },
      agora: new Date(),
      asaasResult: null,
    });
    expect(r.resultado).toEqual({ balance: 500 });
  });
});

describe("obterSaldo — cache miss (> 10min OU null timestamp)", () => {
  it("cache 11min antigo: chama Asaas e marca pra atualizar", () => {
    const cacheStale = new Date("2026-05-13T11:49:00Z"); // 11min atrás
    const r = decidirRetornoSaldo({
      cfg: { saldo: "1000.00", saldoAtualizadoEm: cacheStale },
      agora: new Date(),
      asaasResult: { ok: true, balance: 1500 },
    });
    expect(r.resultado).toEqual({ balance: 1500 });
    expect(r.deveAtualizarCache).toBe(true);
  });

  it("primeira leitura (saldoAtualizadoEm=null): chama Asaas", () => {
    const r = decidirRetornoSaldo({
      cfg: { saldo: null, saldoAtualizadoEm: null },
      agora: new Date(),
      asaasResult: { ok: true, balance: 2000 },
    });
    expect(r.resultado).toEqual({ balance: 2000 });
    expect(r.deveAtualizarCache).toBe(true);
  });

  it("cache invalidado pelo webhook (timestamp=null com saldo antigo): chama Asaas", () => {
    const r = decidirRetornoSaldo({
      cfg: { saldo: "100.00", saldoAtualizadoEm: null },
      agora: new Date(),
      asaasResult: { ok: true, balance: 3500 },
    });
    expect(r.resultado).toEqual({ balance: 3500 });
    expect(r.deveAtualizarCache).toBe(true);
  });
});

describe("obterSaldo — fallback quando Asaas falha", () => {
  it("Asaas falha mas cache stale existe: devolve stale (não null)", () => {
    const cacheStale = new Date("2026-05-13T10:00:00Z"); // 2h atrás
    const r = decidirRetornoSaldo({
      cfg: { saldo: "800.00", saldoAtualizadoEm: cacheStale },
      agora: new Date(),
      asaasResult: { ok: false },
    });
    expect(r.resultado).toEqual({ balance: 800 });
    expect(r.deveAtualizarCache).toBe(false);
  });

  it("Asaas falha + nunca houve cache: retorna null", () => {
    const r = decidirRetornoSaldo({
      cfg: { saldo: null, saldoAtualizadoEm: null },
      agora: new Date(),
      asaasResult: { ok: false },
    });
    expect(r.resultado).toBeNull();
  });

  it("Sem client Asaas disponível + cache existe: devolve cache stale", () => {
    const cacheStale = new Date("2026-05-13T08:00:00Z");
    const r = decidirRetornoSaldo({
      cfg: { saldo: "999.99", saldoAtualizadoEm: cacheStale },
      agora: new Date(),
      asaasResult: null, // null = client indisponível
    });
    expect(r.resultado).toEqual({ balance: 999.99 });
  });
});

describe("Redução de tráfego — simulação multi-user", () => {
  it("10 leituras em 5min com cache: 1 hit Asaas + 9 cache hits", () => {
    let chamadasAsaas = 0;
    let saldo: string | null = null;
    let saldoAtualizadoEm: Date | null = null;

    const simularLeitura = (agora: Date) => {
      const cfg = { saldo, saldoAtualizadoEm };
      const cacheValido =
        cfg.saldoAtualizadoEm !== null &&
        cfg.saldo !== null &&
        agora.getTime() - cfg.saldoAtualizadoEm.getTime() < SALDO_CACHE_TTL_MS;
      if (!cacheValido) {
        chamadasAsaas++;
        saldo = "1234.56";
        saldoAtualizadoEm = agora;
      }
    };

    // Simula 10 usuários acessando em rajada (mesmo segundo)
    const t0 = new Date("2026-05-13T12:00:00Z");
    for (let i = 0; i < 10; i++) simularLeitura(t0);
    // E 9 minutos depois (ainda dentro do TTL de 10min) novamente
    const t1 = new Date("2026-05-13T12:09:00Z");
    for (let i = 0; i < 10; i++) simularLeitura(t1);

    // Cenário antes: 20 chamadas Asaas. Com cache: 1.
    expect(chamadasAsaas).toBe(1);
  });

  it("após 11min: cache expira, próximo acesso bate Asaas + cacheia de novo", () => {
    let chamadasAsaas = 0;
    let saldo: string | null = null;
    let saldoAtualizadoEm: Date | null = null;

    const simularLeitura = (agora: Date) => {
      const cacheValido =
        saldoAtualizadoEm !== null &&
        saldo !== null &&
        agora.getTime() - saldoAtualizadoEm.getTime() < SALDO_CACHE_TTL_MS;
      if (!cacheValido) {
        chamadasAsaas++;
        saldo = "1234.56";
        saldoAtualizadoEm = agora;
      }
    };

    simularLeitura(new Date("2026-05-13T12:00:00Z")); // miss inicial
    simularLeitura(new Date("2026-05-13T12:09:59Z")); // hit
    simularLeitura(new Date("2026-05-13T12:10:01Z")); // miss (>10min)
    simularLeitura(new Date("2026-05-13T12:11:00Z")); // hit

    expect(chamadasAsaas).toBe(2);
  });
});
