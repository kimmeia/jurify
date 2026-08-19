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
  pareceIntencaoDeOptOut,
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

  it("o vocabulário cobre as formas que a pessoa realmente digita", () => {
    // "PARE" não casava e a pessoa continuava recebendo — quem já pediu pra
    // sair e continua recebendo é exatamente quem denuncia spam (aviso da
    // Meta em 19/08). A política manda honrar "all requests to opt out".
    expect(interpretarComandoOptOut("PARE")).toBe("sair");
    expect(interpretarComandoOptOut("pare")).toBe("sair");
    expect(interpretarComandoOptOut("cancelar")).toBe("sair");
    expect(interpretarComandoOptOut("Descadastrar")).toBe("sair");
    expect(interpretarComandoOptOut("unsubscribe")).toBe("sair");
    expect(interpretarComandoOptOut("remover")).toBe("sair");
  });

  it("frases inequívocas de descadastro casam por igualdade", () => {
    expect(interpretarComandoOptOut("não quero mais receber")).toBe("sair");
    expect(interpretarComandoOptOut("Quero sair")).toBe("sair");
    expect(interpretarComandoOptOut("remova meu número")).toBe("sair");
    expect(interpretarComandoOptOut("parar de receber")).toBe("sair");
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

describe("pareceIntencaoDeOptOut (sinal fraco → alerta humano)", () => {
  it("pega o pedido educado no meio da frase", () => {
    expect(pareceIntencaoDeOptOut("por favor não me mandem mais mensagens")).toBe(true);
    expect(pareceIntencaoDeOptOut("podem parar de mandar essas mensagens?")).toBe(true);
    expect(pareceIntencaoDeOptOut("quero parar de receber esses avisos")).toBe(true);
    expect(pareceIntencaoDeOptOut("como faço pra me descadastrar daqui")).toBe(true);
    expect(pareceIntencaoDeOptOut("isso é spam")).toBe(true);
  });

  it("acento não esconde a intenção", () => {
    expect(pareceIntencaoDeOptOut("NÃO me mande mais nada")).toBe(true);
  });

  it("comando exato NÃO vira alerta — o descadastro automático já resolveu", () => {
    expect(pareceIntencaoDeOptOut("SAIR")).toBe(false);
    expect(pareceIntencaoDeOptOut("não quero mais receber")).toBe(false);
  });

  it("conversa normal não dispara", () => {
    // Automatizar sobre sinal fraco descadastraria "quero cancelar a
    // audiência" — por isso é alerta, e por isso o alerta não pode gritar à toa.
    expect(pareceIntencaoDeOptOut("quero cancelar a audiência de quinta")).toBe(false);
    expect(pareceIntencaoDeOptOut("pode me mandar o contrato?")).toBe(false);
    expect(pareceIntencaoDeOptOut("obrigado pelo aviso")).toBe(false);
    expect(pareceIntencaoDeOptOut("")).toBe(false);
    expect(pareceIntencaoDeOptOut(null)).toBe(false);
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
