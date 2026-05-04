/**
 * Testes — WhatsApp Baileys Types & Handler
 * Etapa 3: Validação de tipos, formatação e processamento de mensagens
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  jidToPhone,
  phoneToJid,
  formatPhoneBR,
  phoneVariantsBR,
  resolverJidValido,
  limparCacheJid,
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
    // Fixo BR começa com 2/3/4/5 — função gera variante mas Baileys vai rejeitar
    // a variante com 9 via onWhatsApp(). Comportamento aceitável: gera ambas e
    // deixa o servidor decidir.
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

// ─── Testes: resolverJidValido (consulta ao Baileys) ────────────────────────

describe("resolverJidValido", () => {
  beforeEach(() => {
    limparCacheJid();
  });

  it("retorna JID com 9 quando servidor confirma esse formato", async () => {
    const socket = {
      onWhatsApp: vi.fn(async (numbers: string[]) => [
        { exists: true, jid: `${numbers[0]}@s.whatsapp.net` },
        { exists: false, jid: `${numbers[1]}@s.whatsapp.net` },
      ]),
    };
    const jid = await resolverJidValido(socket, "5585999999999");
    expect(jid).toBe("5585999999999@s.whatsapp.net");
    expect(socket.onWhatsApp).toHaveBeenCalledWith([
      "5585999999999",
      "558599999999",
    ]);
  });

  it("retorna JID sem 9 quando só essa variante existe (caso real do bug)", async () => {
    const socket = {
      onWhatsApp: vi.fn(async (numbers: string[]) => [
        { exists: false, jid: `${numbers[0]}@s.whatsapp.net` },
        { exists: true, jid: `${numbers[1]}@s.whatsapp.net` },
      ]),
    };
    const jid = await resolverJidValido(socket, "5585999999999");
    expect(jid).toBe("558599999999@s.whatsapp.net");
  });

  it("retorna null quando nenhuma variante existe (cliente sem WhatsApp)", async () => {
    const socket = {
      onWhatsApp: vi.fn(async (numbers: string[]) =>
        numbers.map((n) => ({ exists: false, jid: `${n}@s.whatsapp.net` })),
      ),
    };
    const jid = await resolverJidValido(socket, "5585999999999");
    expect(jid).toBeNull();
  });

  it("cacheia resultado pra evitar nova chamada com mesmo número", async () => {
    const socket = {
      onWhatsApp: vi.fn(async (numbers: string[]) => [
        { exists: true, jid: `${numbers[0]}@s.whatsapp.net` },
      ]),
    };
    await resolverJidValido(socket, "5585999999999");
    await resolverJidValido(socket, "5585999999999");
    await resolverJidValido(socket, "5585999999999");
    expect(socket.onWhatsApp).toHaveBeenCalledTimes(1);
  });

  it("fallback pro JID literal quando socket.onWhatsApp lança erro", async () => {
    const socket = {
      onWhatsApp: vi.fn(async () => {
        throw new Error("Network down");
      }),
    };
    const jid = await resolverJidValido(socket, "5585999999999");
    // Sem cache — fallback usa primeira variante (preferida)
    expect(jid).toBe("5585999999999@s.whatsapp.net");
  });

  it("retorna null pra string vazia (sem variantes)", async () => {
    const socket = { onWhatsApp: vi.fn() };
    const jid = await resolverJidValido(socket, "");
    expect(jid).toBeNull();
    expect(socket.onWhatsApp).not.toHaveBeenCalled();
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
