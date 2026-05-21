/**
 * Testes do roteamento de envio por tipo de canal. Mocka:
 *   - getDb → devolve um stub que retorna a row do canal
 *   - whatsapp-baileys → mockado (isConectado/enviarMensagemJid)
 *   - whatsapp-cloud → mockado (enviarTexto)
 *   - crypto-utils.decryptConfig → mockado pra devolver config plain
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const dbStub = {
  selectRows: [] as any[],
  select: vi.fn(() => dbStub),
  from: vi.fn(() => dbStub),
  where: vi.fn(() => dbStub),
  limit: vi.fn(async () => dbStub.selectRows),
};

vi.mock("../db", () => ({ getDb: async () => dbStub }));

const baileysMock = {
  isConectado: vi.fn(),
  enviarMensagemJid: vi.fn(),
};
vi.mock("./whatsapp-baileys", () => ({
  getWhatsappManager: () => baileysMock,
}));

const cloudClientMock = {
  enviarTexto: vi.fn(),
};
const CloudClientCtorMock = vi.fn(() => cloudClientMock);
vi.mock("./whatsapp-cloud", () => ({
  WhatsAppCloudClient: CloudClientCtorMock,
}));

vi.mock("../escritorio/crypto-utils", () => ({
  decryptConfig: vi.fn(() => ({ accessToken: "TOKEN_TEST", phoneNumberId: "PHONE_TEST" })),
}));

import { enviarMensagemPeloCanal } from "./canal-envio";

beforeEach(() => {
  vi.clearAllMocks();
  dbStub.selectRows = [];
});

describe("enviarMensagemPeloCanal — guards", () => {
  it("falha quando conteúdo vazio", async () => {
    const r = await enviarMensagemPeloCanal({ canalId: 1, telefone: "5511999", conteudo: "" });
    expect(r.ok).toBe(false);
    expect(r.erro).toBe("Conteúdo vazio");
  });

  it("falha quando canal não existe no DB", async () => {
    dbStub.selectRows = [];
    const r = await enviarMensagemPeloCanal({ canalId: 999, telefone: "5511999", conteudo: "oi" });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("não encontrado");
  });

  it("recusa tipos não suportados", async () => {
    dbStub.selectRows = [{ id: 1, tipo: "instagram" }];
    const r = await enviarMensagemPeloCanal({ canalId: 1, telefone: "5511999", conteudo: "oi" });
    expect(r.ok).toBe(false);
    expect(r.provider).toBe("outro");
    expect(r.erro).toContain("instagram");
  });
});

describe("enviarMensagemPeloCanal — whatsapp_qr (Baileys)", () => {
  beforeEach(() => {
    dbStub.selectRows = [{ id: 5, tipo: "whatsapp_qr" }];
  });

  it("envia com sucesso quando Baileys conectado", async () => {
    baileysMock.isConectado.mockReturnValue(true);
    baileysMock.enviarMensagemJid.mockResolvedValue(undefined);

    const r = await enviarMensagemPeloCanal({
      canalId: 5,
      chatIdExterno: "5511999@s.whatsapp.net",
      telefone: "5511999",
      conteudo: "olá",
    });

    expect(r.ok).toBe(true);
    expect(r.provider).toBe("whatsapp_qr");
    expect(baileysMock.enviarMensagemJid).toHaveBeenCalledWith(
      5,
      "5511999@s.whatsapp.net",
      "olá",
    );
  });

  it("retorna erro quando sessão desconectada", async () => {
    baileysMock.isConectado.mockReturnValue(false);

    const r = await enviarMensagemPeloCanal({
      canalId: 5,
      telefone: "5511999",
      conteudo: "olá",
    });

    expect(r.ok).toBe(false);
    expect(r.erro).toContain("desconectada");
    expect(baileysMock.enviarMensagemJid).not.toHaveBeenCalled();
  });

  it("converte LID pra PN quando tem telefone disponível", async () => {
    baileysMock.isConectado.mockReturnValue(true);
    baileysMock.enviarMensagemJid.mockResolvedValue(undefined);

    await enviarMensagemPeloCanal({
      canalId: 5,
      chatIdExterno: "1234567890@lid",
      telefone: "5511988887777",
      conteudo: "olá",
    });

    expect(baileysMock.enviarMensagemJid).toHaveBeenCalledWith(
      5,
      "5511988887777@s.whatsapp.net",
      "olá",
    );
  });

  it("captura erro do Baileys e devolve ok=false", async () => {
    baileysMock.isConectado.mockReturnValue(true);
    baileysMock.enviarMensagemJid.mockRejectedValue(new Error("Chat not found"));

    const r = await enviarMensagemPeloCanal({
      canalId: 5,
      telefone: "5511999",
      conteudo: "olá",
    });

    expect(r.ok).toBe(false);
    expect(r.erro).toBe("Chat not found");
  });

  it("falha sem destinatário (sem telefone nem chatId)", async () => {
    baileysMock.isConectado.mockReturnValue(true);

    const r = await enviarMensagemPeloCanal({ canalId: 5, conteudo: "olá" });

    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Sem destinatário");
  });
});

describe("enviarMensagemPeloCanal — whatsapp_api (Cloud)", () => {
  beforeEach(() => {
    dbStub.selectRows = [{
      id: 8,
      tipo: "whatsapp_api",
      configEncrypted: "enc",
      configIv: "iv",
      configTag: "tag",
    }];
  });

  it("envia com sucesso via Cloud API com msgId externo", async () => {
    cloudClientMock.enviarTexto.mockResolvedValue("WAMID.HBgM");

    const r = await enviarMensagemPeloCanal({
      canalId: 8,
      telefone: "5511988887777",
      conteudo: "olá",
    });

    expect(r.ok).toBe(true);
    expect(r.provider).toBe("whatsapp_api");
    expect(r.idExterno).toBe("WAMID.HBgM");
    expect(cloudClientMock.enviarTexto).toHaveBeenCalledWith("5511988887777", "olá");
    expect(CloudClientCtorMock).toHaveBeenCalledWith({
      accessToken: "TOKEN_TEST",
      phoneNumberId: "PHONE_TEST",
    });
  });

  it("falha quando canal Cloud sem credenciais", async () => {
    dbStub.selectRows = [{ id: 8, tipo: "whatsapp_api" }];

    const r = await enviarMensagemPeloCanal({
      canalId: 8,
      telefone: "5511988887777",
      conteudo: "olá",
    });

    expect(r.ok).toBe(false);
    expect(r.erro).toContain("sem credenciais");
  });

  it("falha quando telefone inválido pra Cloud API", async () => {
    const r = await enviarMensagemPeloCanal({
      canalId: 8,
      telefone: "abc",
      conteudo: "olá",
    });

    expect(r.ok).toBe(false);
    expect(r.erro).toContain("inválido");
    expect(cloudClientMock.enviarTexto).not.toHaveBeenCalled();
  });

  it("extrai telefone do chatId quando só ele está disponível", async () => {
    cloudClientMock.enviarTexto.mockResolvedValue("WAMID.OK");

    const r = await enviarMensagemPeloCanal({
      canalId: 8,
      chatIdExterno: "5511988887777@s.whatsapp.net",
      conteudo: "olá",
    });

    expect(r.ok).toBe(true);
    expect(cloudClientMock.enviarTexto).toHaveBeenCalledWith("5511988887777", "olá");
  });

  it("propaga mensagem de erro da API Meta quando disponível", async () => {
    const erroMeta: any = new Error("Request failed");
    erroMeta.response = { data: { error: { message: "Recipient phone number not in allowed list" } } };
    cloudClientMock.enviarTexto.mockRejectedValue(erroMeta);

    const r = await enviarMensagemPeloCanal({
      canalId: 8,
      telefone: "5511988887777",
      conteudo: "olá",
    });

    expect(r.ok).toBe(false);
    expect(r.erro).toBe("Recipient phone number not in allowed list");
  });
});
