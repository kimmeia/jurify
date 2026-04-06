/**
 * Testes — WhatsApp Baileys Types & Handler
 * Etapa 3: Validação de tipos, formatação e processamento de mensagens
 */

import { describe, it, expect } from "vitest";
import {
  jidToPhone,
  phoneToJid,
  formatPhoneBR,
  WHATSAPP_STATUS_LABELS,
  WHATSAPP_STATUS_CORES,
} from "../../shared/whatsapp-types";
import type {
  WhatsappSessionStatus,
  WhatsappMensagemRecebida,
  WhatsappMensagemEnviar,
  WhatsappSessionInfo,
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

// ─── Testes: Status Labels e Cores ──────────────────────────────────────────

describe("WHATSAPP_STATUS_LABELS", () => {
  it("tem label para todos os status", () => {
    const statuses: WhatsappSessionStatus[] = [
      "aguardando_qr", "conectando", "conectado",
      "desconectado", "erro", "banido",
    ];
    for (const s of statuses) {
      expect(WHATSAPP_STATUS_LABELS[s]).toBeTruthy();
      expect(typeof WHATSAPP_STATUS_LABELS[s]).toBe("string");
    }
  });

  it("labels em português", () => {
    expect(WHATSAPP_STATUS_LABELS.conectado).toBe("Conectado");
    expect(WHATSAPP_STATUS_LABELS.aguardando_qr).toBe("Aguardando QR Code");
    expect(WHATSAPP_STATUS_LABELS.banido).toBe("Número Banido");
  });
});

describe("WHATSAPP_STATUS_CORES", () => {
  it("tem classes CSS para todos os status", () => {
    const statuses: WhatsappSessionStatus[] = [
      "aguardando_qr", "conectando", "conectado",
      "desconectado", "erro", "banido",
    ];
    for (const s of statuses) {
      expect(WHATSAPP_STATUS_CORES[s]).toBeTruthy();
      expect(WHATSAPP_STATUS_CORES[s]).toContain("text-");
      expect(WHATSAPP_STATUS_CORES[s]).toContain("bg-");
    }
  });

  it("conectado usa verde", () => {
    expect(WHATSAPP_STATUS_CORES.conectado).toContain("emerald");
  });

  it("erro usa vermelho", () => {
    expect(WHATSAPP_STATUS_CORES.erro).toContain("red");
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

describe("WhatsappSessionInfo", () => {
  it("pode representar sessão desconectada", () => {
    const info: WhatsappSessionInfo = {
      canalId: 1,
      status: "desconectado",
    };
    expect(info.status).toBe("desconectado");
    expect(info.qrCode).toBeUndefined();
  });

  it("pode representar sessão conectada", () => {
    const info: WhatsappSessionInfo = {
      canalId: 1,
      status: "conectado",
      telefone: "5511999999999",
      nomeDispositivo: "WhatsApp Business",
      uptime: 3600,
    };
    expect(info.status).toBe("conectado");
    expect(info.telefone).toBeTruthy();
    expect(info.uptime).toBe(3600);
  });

  it("pode representar sessão aguardando QR", () => {
    const info: WhatsappSessionInfo = {
      canalId: 1,
      status: "aguardando_qr",
      qrCode: "2@abc123...",
    };
    expect(info.status).toBe("aguardando_qr");
    expect(info.qrCode).toBeTruthy();
  });
});

// ─── Testes: Validação de dados de sessão ────────────────────────────────────

describe("Session Manager (unit)", () => {
  it("mapeia status Baileys para status DB corretamente", () => {
    const map: Record<WhatsappSessionStatus, string> = {
      conectado: "conectado",
      desconectado: "desconectado",
      aguardando_qr: "pendente",
      conectando: "pendente",
      erro: "erro",
      banido: "banido",
    };

    for (const [status, expected] of Object.entries(map)) {
      const dbStatus = mapStatusToDb(status as WhatsappSessionStatus);
      expect(dbStatus).toBe(expected);
    }
  });
});

function mapStatusToDb(status: WhatsappSessionStatus): string {
  switch (status) {
    case "conectado": return "conectado";
    case "desconectado": return "desconectado";
    case "aguardando_qr": return "pendente";
    case "conectando": return "pendente";
    case "erro": return "erro";
    case "banido": return "banido";
    default: return "desconectado";
  }
}

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
