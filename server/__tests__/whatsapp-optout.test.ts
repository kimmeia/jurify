/**
 * Testes — opt-out/opt-in WhatsApp e janela de 24h.
 *
 * Cobre as funções puras (comando na conversa, janela) — o comportamento
 * que o mockup aprovado prometeu: SAIR/PARAR/STOP isolados marcam opt-out,
 * frases que contêm as palavras NÃO marcam; janela fecha 24h após a última
 * mensagem DO CLIENTE.
 */

import { describe, it, expect } from "vitest";
import {
  interpretarComandoOptOut,
  janela24hAberta,
  mensagemConfirmacaoSaida,
  mensagemConfirmacaoVolta,
  JANELA_24H_MS,
} from "../integracoes/whatsapp-optout";

describe("interpretarComandoOptOut", () => {
  it("reconhece SAIR/PARAR/STOP isolados, em qualquer capitalização", () => {
    expect(interpretarComandoOptOut("SAIR")).toBe("sair");
    expect(interpretarComandoOptOut("sair")).toBe("sair");
    expect(interpretarComandoOptOut("  Parar ")).toBe("sair");
    expect(interpretarComandoOptOut("stop")).toBe("sair");
    expect(interpretarComandoOptOut("sair!")).toBe("sair");
    expect(interpretarComandoOptOut("SAIR.")).toBe("sair");
  });

  it("reconhece VOLTAR (reativação)", () => {
    expect(interpretarComandoOptOut("VOLTAR")).toBe("voltar");
    expect(interpretarComandoOptOut("voltar")).toBe("voltar");
  });

  it("NÃO casa frases que apenas contêm as palavras", () => {
    expect(interpretarComandoOptOut("quero cancelar a consulta")).toBeNull();
    expect(interpretarComandoOptOut("vou sair de casa agora")).toBeNull();
    expect(interpretarComandoOptOut("pode parar de me cobrar?")).toBeNull();
    expect(interpretarComandoOptOut("voltar a falar amanhã")).toBeNull();
    expect(interpretarComandoOptOut("")).toBeNull();
    expect(interpretarComandoOptOut(null)).toBeNull();
  });
});

describe("janela24hAberta", () => {
  const agora = Date.parse("2026-07-14T18:00:00Z");

  it("aberta quando a última entrada do cliente tem menos de 24h", () => {
    expect(janela24hAberta(new Date(agora - 1000), agora)).toBe(true);
    expect(janela24hAberta(new Date(agora - JANELA_24H_MS + 60_000), agora)).toBe(true);
  });

  it("fechada com 24h ou mais (ou sem nenhuma entrada)", () => {
    expect(janela24hAberta(new Date(agora - JANELA_24H_MS), agora)).toBe(false);
    expect(janela24hAberta(new Date(agora - 2 * JANELA_24H_MS), agora)).toBe(false);
    expect(janela24hAberta(null, agora)).toBe(false);
    expect(janela24hAberta(undefined, agora)).toBe(false);
  });
});

describe("mensagens de confirmação", () => {
  it("citam o nome do escritório (clareza exigida pela política)", () => {
    expect(mensagemConfirmacaoSaida("Boyadjian Advogados")).toContain("Boyadjian Advogados");
    expect(mensagemConfirmacaoSaida("Boyadjian Advogados")).toContain("VOLTAR");
    expect(mensagemConfirmacaoVolta("Boyadjian Advogados")).toContain("Boyadjian Advogados");
  });

  it("caem num genérico legível sem nome", () => {
    expect(mensagemConfirmacaoSaida("")).toContain("este escritório");
  });
});
