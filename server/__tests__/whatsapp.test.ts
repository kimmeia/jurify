/**
 * Testes — WhatsApp Types & Helpers
 * Validação de tipos, formatação e helpers de telefone/JID.
 */

import { describe, it, expect } from "vitest";
import {
  jidToPhone,
  phoneToJid,
  formatPhoneBR,
  phoneVariantsBR,
} from "../../shared/whatsapp-types";
import type {
  WhatsappMensagemRecebida,
  WhatsappMensagemEnviar,
} from "../../shared/whatsapp-types";

// ─── Testes: Formatação de JID/Telefone ──────────────────────────────────────

describe("jidToPhone", () => {
  it("converte JID individual para número", () => {
    expect(jidToPhone("5511999999999@s.whatsapp.net")).toBe("5511999999999");
  });

  it("converte JID de grupo para ID do grupo", () => {
    expect(jidToPhone("120363012345678901@g.us")).toBe("120363012345678901");
  });

  it("retorna string sem alteração se não tem sufixo", () => {
    expect(jidToPhone("5511999999999")).toBe("5511999999999");
  });
});

describe("phoneToJid", () => {
  it("converte número limpo para JID", () => {
    expect(phoneToJid("5511999999999")).toBe("5511999999999@s.whatsapp.net");
  });

  it("remove caracteres não numéricos", () => {
    expect(phoneToJid("+55 (11) 99999-9999")).toBe("5511999999999@s.whatsapp.net");
  });

  it("lida com formato internacional", () => {
    expect(phoneToJid("55 11 99999 9999")).toBe("5511999999999@s.whatsapp.net");
  });
});

describe("formatPhoneBR", () => {
  it("formata celular com 13 dígitos (com código país)", () => {
    expect(formatPhoneBR("5511999999999")).toBe("+55 (11) 99999-9999");
  });

  it("formata fixo com 12 dígitos (com código país)", () => {
    expect(formatPhoneBR("551133334444")).toBe("+55 (11) 3333-4444");
  });

  it("retorna original se formato desconhecido", () => {
    expect(formatPhoneBR("123")).toBe("123");
  });

  it("lida com string com caracteres extras", () => {
    expect(formatPhoneBR("+55 11 99999-9999")).toBe("+55 (11) 99999-9999");
  });
});

// ─── Testes: phoneVariantsBR (quirk do "9" antecipado) ─────────────────────

describe("phoneVariantsBR", () => {
  it("BR celular 13 dígitos → variante sem o 9", () => {
    expect(phoneVariantsBR("5585999999999")).toEqual([
      "5585999999999",
      "558599999999",
    ]);
  });

  it("BR celular 12 dígitos → variante com o 9", () => {
    expect(phoneVariantsBR("558599999999")).toEqual([
      "558599999999",
      "5585999999999",
    ]);
  });

  it("BR DDD 11 (São Paulo) — 13 dígitos", () => {
    expect(phoneVariantsBR("5511987654321")).toEqual([
      "5511987654321",
      "551187654321",
    ]);
  });

  it("BR sem DDI prepende 55 e gera variantes", () => {
    expect(phoneVariantsBR("85999999999")).toEqual([
      "5585999999999",
      "558599999999",
    ]);
  });

  it("BR fixo 12 dígitos (3xxx) → variante com 9 (servidor pode aceitar)", () => {
    // Fixo BR começa com 2/3/4/5 — a função gera ambas variantes e deixa o
    // servidor decidir qual existe.
    expect(phoneVariantsBR("551133334444")).toEqual([
      "551133334444",
      "5511933334444",
    ]);
  });

  it("Internacional não-BR → retorna só o original sem variante", () => {
    expect(phoneVariantsBR("12025551234")).toEqual(["12025551234"]);
    expect(phoneVariantsBR("442071234567")).toEqual(["442071234567"]);
  });

  it("string vazia → array vazio", () => {
    expect(phoneVariantsBR("")).toEqual([]);
    expect(phoneVariantsBR("abc")).toEqual([]);
  });

  it("formato com máscara é normalizado", () => {
    expect(phoneVariantsBR("(85) 99999-9999")).toEqual([
      "5585999999999",
      "558599999999",
    ]);
  });

  it("BR muito curto/longo (não-padrão) → não gera variante extra", () => {
    expect(phoneVariantsBR("123456")).toEqual(["123456"]);
    expect(phoneVariantsBR("5512345")).toEqual(["5512345"]);
  });
});

// ─── Testes: Tipos de Interface ──────────────────────────────────────────────

describe("WhatsappMensagemRecebida", () => {
  it("pode criar mensagem de texto válida", () => {
    const msg: WhatsappMensagemRecebida = {
      chatId: "5511999999999@s.whatsapp.net",
      nome: "João Silva",
      telefone: "5511999999999",
      conteudo: "Olá, preciso de uma consulta",
      tipo: "texto",
      timestamp: Math.floor(Date.now() / 1000),
      messageId: "BAE5ABCDEF123",
      isGroup: false,
    };
    expect(msg.tipo).toBe("texto");
    expect(msg.isGroup).toBe(false);
    expect(msg.conteudo).toContain("consulta");
  });

  it("pode criar mensagem de mídia", () => {
    const msg: WhatsappMensagemRecebida = {
      chatId: "5511999999999@s.whatsapp.net",
      nome: "Maria",
      telefone: "5511999999999",
      conteudo: "[Imagem]",
      tipo: "imagem",
      mediaUrl: "https://example.com/image.jpg",
      timestamp: Math.floor(Date.now() / 1000),
      messageId: "BAE5ABCDEF456",
      isGroup: false,
    };
    expect(msg.tipo).toBe("imagem");
    expect(msg.mediaUrl).toBeTruthy();
  });

  it("pode criar mensagem de grupo", () => {
    const msg: WhatsappMensagemRecebida = {
      chatId: "120363012345678901@g.us",
      nome: "Pedro",
      telefone: "5511888888888",
      conteudo: "Mensagem no grupo",
      tipo: "texto",
      timestamp: Math.floor(Date.now() / 1000),
      messageId: "BAE5ABCDEF789",
      isGroup: true,
    };
    expect(msg.isGroup).toBe(true);
    expect(msg.chatId).toContain("@g.us");
  });
});

describe("WhatsappMensagemEnviar", () => {
  it("pode criar mensagem de texto para envio", () => {
    const msg: WhatsappMensagemEnviar = {
      telefone: "5511999999999",
      conteudo: "Olá! Sua consulta foi agendada.",
      tipo: "texto",
    };
    expect(msg.tipo).toBe("texto");
    expect(msg.telefone).toHaveLength(13);
  });

  it("pode criar mensagem com mídia", () => {
    const msg: WhatsappMensagemEnviar = {
      telefone: "5511999999999",
      conteudo: "",
      tipo: "documento",
      mediaUrl: "https://example.com/parecer.pdf",
      mediaCaption: "Parecer técnico anexo",
    };
    expect(msg.tipo).toBe("documento");
    expect(msg.mediaUrl).toBeTruthy();
  });
});

// ─── Testes: Agendamento Types ──────────────────────────────────────────────

import {
  TIPO_LABELS as AGEND_TIPO_LABELS,
  TIPO_CORES as AGEND_TIPO_CORES,
} from "../../shared/agendamento-constants";

describe("Agendamento Types", () => {
  it("TIPO_LABELS tem todos os tipos", () => {
    expect(AGEND_TIPO_LABELS.prazo_processual).toBe("Prazo Processual");
    expect(AGEND_TIPO_LABELS.audiencia).toBe("Audiência");
    expect(AGEND_TIPO_LABELS.reuniao_comercial).toBe("Reunião Comercial");
    expect(AGEND_TIPO_LABELS.tarefa).toBe("Tarefa");
    expect(AGEND_TIPO_LABELS.follow_up).toBe("Follow-up");
    expect(AGEND_TIPO_LABELS.outro).toBe("Outro");
  });

  it("TIPO_CORES tem cor hex para todos os tipos", () => {
    const tipos = ["prazo_processual", "audiencia", "reuniao_comercial", "tarefa", "follow_up", "outro"];
    for (const t of tipos) {
      expect(AGEND_TIPO_CORES[t as keyof typeof AGEND_TIPO_CORES]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
