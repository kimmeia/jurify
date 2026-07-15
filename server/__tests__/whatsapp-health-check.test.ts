/**
 * Testes — avaliarSaude (health-check periódico WhatsApp Cloud).
 *
 * A função pura decide, a partir do que a Meta reporta do número, se o
 * canal deve ser pausado (restrito/desativado), alertado (qualidade
 * degradada) ou só atualizado (qualidade/tier pro badge e teto anti-ban).
 */

import { describe, it, expect } from "vitest";
import { avaliarSaude } from "../integracoes/whatsapp-health-check";

describe("avaliarSaude", () => {
  it("número saudável (GREEN): só persiste qualidade/tier, sem alerta", () => {
    const acao = avaliarSaude({ qualityRating: "GREEN", tier: "TIER_1K", contaOk: true, motivo: null });
    expect(acao.marcarRestrito).toBe(false);
    expect(acao.alertaQualidade).toBe(false);
    expect(acao.updates).toEqual({ qualidadeMeta: "GREEN", tierMensagens: "TIER_1K" });
  });

  it("qualidade YELLOW/RED: alerta precoce (sem pausar o canal)", () => {
    expect(avaliarSaude({ qualityRating: "YELLOW", tier: null, contaOk: true, motivo: null }).alertaQualidade).toBe(true);
    expect(avaliarSaude({ qualityRating: "RED", tier: null, contaOk: true, motivo: null }).alertaQualidade).toBe(true);
    expect(avaliarSaude({ qualityRating: "RED", tier: null, contaOk: true, motivo: null }).marcarRestrito).toBe(false);
  });

  it("conta/número restrito na Meta: tripa o disjuntor proativamente", () => {
    const acao = avaliarSaude({ qualityRating: null, tier: null, contaOk: false, motivo: 'Número em estado "RESTRICTED" na Meta' });
    expect(acao.marcarRestrito).toBe(true);
  });

  it("sem dados novos (tudo null e conta ok): nenhum update, nenhum alerta", () => {
    const acao = avaliarSaude({ qualityRating: null, tier: null, contaOk: true, motivo: null });
    expect(acao.updates).toEqual({});
    expect(acao.marcarRestrito).toBe(false);
    expect(acao.alertaQualidade).toBe(false);
  });
});
