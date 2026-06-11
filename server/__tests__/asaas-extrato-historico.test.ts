/**
 * Testes — helpers do sync de extrato em segundo plano.
 *
 * Cobre a elegibilidade por tick (status, intervalo entre janelas e
 * backoff de cota via proximaTentativaEm) e o cálculo da janela a partir
 * do cursor (recorte no limite inferior, contagem de dias).
 */

import { describe, it, expect } from "vitest";
import {
  elegivelParaProximaJanelaExtrato,
  calcularJanelaExtrato,
} from "../integracoes/asaas-extrato-historico";

const agora = new Date("2026-06-10T12:00:00Z");

function cfg(over: Partial<Parameters<typeof elegivelParaProximaJanelaExtrato>[0]> = {}) {
  return {
    extratoSyncStatus: "executando",
    extratoSyncUltimaJanelaEm: null,
    extratoSyncIntervaloMinutos: 10,
    extratoSyncProximaTentativaEm: null,
    ...over,
  };
}

describe("elegivelParaProximaJanelaExtrato", () => {
  it("agendado processa imediatamente (1ª janela)", () => {
    expect(elegivelParaProximaJanelaExtrato(cfg({ extratoSyncStatus: "agendado" }), agora)).toBe(true);
  });

  it("pausado/concluido/erro/inativo nunca processam", () => {
    for (const s of ["pausado", "concluido", "erro", "inativo"]) {
      expect(elegivelParaProximaJanelaExtrato(cfg({ extratoSyncStatus: s }), agora)).toBe(false);
    }
  });

  it("executando sem ultimaJanelaEm processa", () => {
    expect(elegivelParaProximaJanelaExtrato(cfg(), agora)).toBe(true);
  });

  it("executando respeita o intervalo entre janelas", () => {
    const ha5min = new Date(agora.getTime() - 5 * 60_000);
    const ha15min = new Date(agora.getTime() - 15 * 60_000);
    expect(elegivelParaProximaJanelaExtrato(cfg({ extratoSyncUltimaJanelaEm: ha5min }), agora)).toBe(false);
    expect(elegivelParaProximaJanelaExtrato(cfg({ extratoSyncUltimaJanelaEm: ha15min }), agora)).toBe(true);
  });

  it("backoff de cota: proximaTentativaEm no futuro bloqueia mesmo com intervalo vencido", () => {
    const ha2h = new Date(agora.getTime() - 2 * 3600_000);
    const daquiMeiaHora = new Date(agora.getTime() + 30 * 60_000);
    expect(
      elegivelParaProximaJanelaExtrato(
        cfg({ extratoSyncUltimaJanelaEm: ha2h, extratoSyncProximaTentativaEm: daquiMeiaHora }),
        agora,
      ),
    ).toBe(false);
  });

  it("proximaTentativaEm no passado libera o processamento", () => {
    const ha2h = new Date(agora.getTime() - 2 * 3600_000);
    const haMeiaHora = new Date(agora.getTime() - 30 * 60_000);
    expect(
      elegivelParaProximaJanelaExtrato(
        cfg({ extratoSyncUltimaJanelaEm: ha2h, extratoSyncProximaTentativaEm: haMeiaHora }),
        agora,
      ),
    ).toBe(true);
  });
});

describe("calcularJanelaExtrato", () => {
  it("janela cheia de N dias terminando no cursor", () => {
    const j = calcularJanelaExtrato({ cursor: "2026-06-10", de: "2020-01-01", diasPorTick: 7 });
    expect(j).toEqual({ inicio: "2026-06-04", fim: "2026-06-10", dias: 7 });
  });

  it("recorta no limite inferior quando o período acaba", () => {
    const j = calcularJanelaExtrato({ cursor: "2026-06-10", de: "2026-06-08", diasPorTick: 7 });
    expect(j).toEqual({ inicio: "2026-06-08", fim: "2026-06-10", dias: 3 });
  });

  it("diasPorTick=1 produz janela de 1 dia (inicio == fim)", () => {
    const j = calcularJanelaExtrato({ cursor: "2026-06-10", de: "2020-01-01", diasPorTick: 1 });
    expect(j).toEqual({ inicio: "2026-06-10", fim: "2026-06-10", dias: 1 });
  });

  it("cursor no próprio limite inferior → última janela de 1 dia", () => {
    const j = calcularJanelaExtrato({ cursor: "2026-01-01", de: "2026-01-01", diasPorTick: 7 });
    expect(j).toEqual({ inicio: "2026-01-01", fim: "2026-01-01", dias: 1 });
  });

  it("atravessa viradas de mês/ano corretamente", () => {
    const j = calcularJanelaExtrato({ cursor: "2026-01-03", de: "2020-01-01", diasPorTick: 7 });
    expect(j).toEqual({ inicio: "2025-12-28", fim: "2026-01-03", dias: 7 });
  });
});
