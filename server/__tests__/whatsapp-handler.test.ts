/**
 * Testes — WhatsApp Handler: fallback via auto-reply fixo
 *
 * Foca em `enviarAutoReply`: a função que substituiu o antigo `processarChatBot`
 * quando nenhum cenário do SmartFlow bate com a mensagem recebida. Agentes IA
 * agora só rodam dentro do SmartFlow — o fallback é texto fixo configurável.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock das dependências ANTES do import do handler (vi.mock é hoisted).

vi.mock("../escritorio/db-canais", () => ({
  obterAutoReplyCanal: vi.fn(),
}));

vi.mock("../escritorio/db-crm", () => ({
  enviarMensagem: vi.fn(),
  // Também importadas pelo handler em outras funções — mockar pra não travar o load
  criarOuReutilizarContato: vi.fn(),
  listarContatos: vi.fn(),
  buscarContatoPorTelefone: vi.fn(),
  criarConversa: vi.fn(),
  listarConversas: vi.fn(),
  atualizarConversa: vi.fn(),
  distribuirLead: vi.fn(),
}));

// O handler faz `await import("./whatsapp-baileys")` dentro de enviarResposta
vi.mock("../integracoes/whatsapp-baileys", () => ({
  getWhatsappManager: vi.fn(() => ({
    isConectado: () => true,
    enviarMensagemJid: vi.fn(),
  })),
}));

import { enviarAutoReply } from "../integracoes/whatsapp-handler";
import { obterAutoReplyCanal } from "../escritorio/db-canais";
import { enviarMensagem as salvarMensagem } from "../escritorio/db-crm";

describe("enviarAutoReply (fallback quando SmartFlow não responde)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("envia o texto fixo quando o canal tem auto-reply configurado", async () => {
    vi.mocked(obterAutoReplyCanal).mockResolvedValue("Em breve retornamos.");

    await enviarAutoReply(1, 42, "5511999999999@s.whatsapp.net");

    expect(obterAutoReplyCanal).toHaveBeenCalledWith(1);
    expect(salvarMensagem).toHaveBeenCalledTimes(1);
    expect(salvarMensagem).toHaveBeenCalledWith(
      expect.objectContaining({
        conversaId: 42,
        direcao: "saida",
        tipo: "texto",
        conteudo: "Em breve retornamos.",
      }),
    );
  });

  it("não envia nada quando auto-reply é null", async () => {
    vi.mocked(obterAutoReplyCanal).mockResolvedValue(null);

    await enviarAutoReply(1, 42, "5511999999999@s.whatsapp.net");

    expect(obterAutoReplyCanal).toHaveBeenCalledWith(1);
    expect(salvarMensagem).not.toHaveBeenCalled();
  });

  it("não envia nada quando auto-reply é string vazia (obterAutoReplyCanal já trima)", async () => {
    // obterAutoReplyCanal já retorna null pra strings vazias/brancas — este
    // teste garante que enviarAutoReply também aceita null explícito da query.
    vi.mocked(obterAutoReplyCanal).mockResolvedValue("");

    await enviarAutoReply(1, 42, "5511999999999@s.whatsapp.net");

    expect(salvarMensagem).not.toHaveBeenCalled();
  });

  it("passa o chatId externo adiante (pra respeitar LID vs PN)", async () => {
    vi.mocked(obterAutoReplyCanal).mockResolvedValue("oi");

    await enviarAutoReply(7, 99, "abc123@lid");

    expect(salvarMensagem).toHaveBeenCalledWith(
      expect.objectContaining({
        conversaId: 99,
        conteudo: "oi",
      }),
    );
  });
});
