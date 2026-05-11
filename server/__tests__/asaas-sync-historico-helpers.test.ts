/**
 * Testes dos helpers puros de `asaas-sync-historico`. Não tocam DB —
 * cobrem a aritmética de janelas e a regra de elegibilidade.
 *
 * As funções testadas são determinísticas e não têm efeitos colaterais,
 * o que mantém o teste rápido e robusto a refactor do cron.
 */

import { describe, it, expect } from "vitest";
import {
  contarDiasInclusivos,
  elegivelParaProximaJanela,
  subtrairDias,
} from "../integracoes/asaas-sync-historico";

describe("subtrairDias", () => {
  it("decrementa 1 dia dentro do mesmo mês", () => {
    expect(subtrairDias("2026-05-15", 1)).toBe("2026-05-14");
  });

  it("atravessa fronteira de mês", () => {
    expect(subtrairDias("2026-05-01", 1)).toBe("2026-04-30");
  });

  it("atravessa fronteira de ano", () => {
    expect(subtrairDias("2026-01-01", 1)).toBe("2025-12-31");
  });

  it("aceita N > 1 (subtrai N dias corretamente)", () => {
    expect(subtrairDias("2026-05-10", 7)).toBe("2026-05-03");
  });

  it("ano bissexto: subtrai do começo de março volta pra 29-fev", () => {
    expect(subtrairDias("2024-03-01", 1)).toBe("2024-02-29");
  });

  it("não-bissexto: subtrai do começo de março volta pra 28-fev", () => {
    expect(subtrairDias("2025-03-01", 1)).toBe("2025-02-28");
  });
});

describe("contarDiasInclusivos", () => {
  it("retorna 1 quando datas são iguais", () => {
    expect(contarDiasInclusivos("2026-05-10", "2026-05-10")).toBe(1);
  });

  it("retorna N+1 pra um intervalo de N dias", () => {
    expect(contarDiasInclusivos("2026-05-01", "2026-05-10")).toBe(10);
    expect(contarDiasInclusivos("2026-05-01", "2026-05-31")).toBe(31);
  });

  it("respeita fronteira de ano", () => {
    expect(contarDiasInclusivos("2025-12-30", "2026-01-02")).toBe(4);
  });

  it("retorna 0 quando de > ate (proteção contra input inválido)", () => {
    expect(contarDiasInclusivos("2026-05-20", "2026-05-10")).toBe(0);
  });

  it("retorna 366 pra um ano bissexto completo", () => {
    expect(contarDiasInclusivos("2024-01-01", "2024-12-31")).toBe(366);
  });

  it("retorna 365 pra um ano não-bissexto completo", () => {
    expect(contarDiasInclusivos("2025-01-01", "2025-12-31")).toBe(365);
  });
});

describe("elegivelParaProximaJanela", () => {
  const agora = new Date("2026-05-11T12:00:00.000Z");

  it("status='agendado' sempre é elegível (primeira janela)", () => {
    expect(
      elegivelParaProximaJanela(
        {
          historicoSyncStatus: "agendado",
          historicoSyncUltimaJanelaEm: null,
          historicoSyncIntervaloMinutos: 60,
        },
        agora,
      ),
    ).toBe(true);
  });

  it("status='executando' sem ultimaJanelaEm é elegível", () => {
    expect(
      elegivelParaProximaJanela(
        {
          historicoSyncStatus: "executando",
          historicoSyncUltimaJanelaEm: null,
          historicoSyncIntervaloMinutos: 60,
        },
        agora,
      ),
    ).toBe(true);
  });

  it("status='executando' com ultimaJanelaEm dentro do intervalo NÃO é elegível", () => {
    const recente = new Date(agora.getTime() - 30 * 60_000); // 30min atrás
    expect(
      elegivelParaProximaJanela(
        {
          historicoSyncStatus: "executando",
          historicoSyncUltimaJanelaEm: recente,
          historicoSyncIntervaloMinutos: 60,
        },
        agora,
      ),
    ).toBe(false);
  });

  it("status='executando' com ultimaJanelaEm além do intervalo É elegível", () => {
    const antiga = new Date(agora.getTime() - 90 * 60_000); // 90min atrás
    expect(
      elegivelParaProximaJanela(
        {
          historicoSyncStatus: "executando",
          historicoSyncUltimaJanelaEm: antiga,
          historicoSyncIntervaloMinutos: 60,
        },
        agora,
      ),
    ).toBe(true);
  });

  it("status='executando' exatamente no limite (passou intervalo): elegível", () => {
    const exato = new Date(agora.getTime() - 60 * 60_000); // 60min atrás
    expect(
      elegivelParaProximaJanela(
        {
          historicoSyncStatus: "executando",
          historicoSyncUltimaJanelaEm: exato,
          historicoSyncIntervaloMinutos: 60,
        },
        agora,
      ),
    ).toBe(true);
  });

  it("status='pausado' NUNCA é elegível (espera retomada manual)", () => {
    expect(
      elegivelParaProximaJanela(
        {
          historicoSyncStatus: "pausado",
          historicoSyncUltimaJanelaEm: null,
          historicoSyncIntervaloMinutos: 60,
        },
        agora,
      ),
    ).toBe(false);
  });

  it("status='concluido' NÃO é elegível", () => {
    expect(
      elegivelParaProximaJanela(
        {
          historicoSyncStatus: "concluido",
          historicoSyncUltimaJanelaEm: null,
          historicoSyncIntervaloMinutos: 60,
        },
        agora,
      ),
    ).toBe(false);
  });

  it("status='erro' NÃO é elegível (espera retomar/cancelar)", () => {
    expect(
      elegivelParaProximaJanela(
        {
          historicoSyncStatus: "erro",
          historicoSyncUltimaJanelaEm: null,
          historicoSyncIntervaloMinutos: 60,
        },
        agora,
      ),
    ).toBe(false);
  });

  it("status='inativo' NÃO é elegível (sync nunca foi iniciada)", () => {
    expect(
      elegivelParaProximaJanela(
        {
          historicoSyncStatus: "inativo",
          historicoSyncUltimaJanelaEm: null,
          historicoSyncIntervaloMinutos: 60,
        },
        agora,
      ),
    ).toBe(false);
  });

  it("intervalo curto (5min) permite janelas rápidas", () => {
    const seisMinAtras = new Date(agora.getTime() - 6 * 60_000);
    expect(
      elegivelParaProximaJanela(
        {
          historicoSyncStatus: "executando",
          historicoSyncUltimaJanelaEm: seisMinAtras,
          historicoSyncIntervaloMinutos: 5,
        },
        agora,
      ),
    ).toBe(true);
  });
});
