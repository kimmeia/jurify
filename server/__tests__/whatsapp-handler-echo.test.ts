/**
 * Testes — processarEchoCelular (CoEx: mensagem enviada pelo app do celular).
 *
 * Contrato da ingestão silenciosa:
 *  - persiste como saída com origem 'celular' + idExterno (wamid)
 *  - dedup: wamid já persistido (ex: enviado pela própria API) não duplica
 *  - marca a conversa em_atendimento (humano assumiu; bot pausa)
 *  - cria contato/conversa quando a relação viveu só no celular
 *  - NÃO dispara SmartFlow nem auto-reply
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const emptySelect = () => {
  const b: any = {
    from: () => b,
    where: () => b,
    orderBy: () => b,
    innerJoin: () => b,
    limit: () => Promise.resolve([]),
    then: (r: (v: unknown) => unknown) => r([]),
  };
  return b;
};
vi.mock("../db", () => ({ getDb: async () => ({ select: () => emptySelect() }) }));

vi.mock("../escritorio/db-canais", () => ({ obterAutoReplyCanal: vi.fn().mockResolvedValue(null) }));

vi.mock("../escritorio/db-crm", () => ({
  criarOuReutilizarContato: vi.fn().mockResolvedValue({ id: 5, jaCadastrado: false }),
  listarContatos: vi.fn().mockResolvedValue([]),
  buscarContatoPorTelefone: vi.fn().mockResolvedValue(undefined),
  criarConversa: vi.fn().mockResolvedValue(42),
  enviarMensagem: vi.fn().mockResolvedValue(999),
  atualizarStatusMensagem: vi.fn(),
  atualizarConversa: vi.fn(),
  buscarMensagemPorIdExterno: vi.fn().mockResolvedValue(null),
  desarquivarSeArquivada: vi.fn(),
}));

vi.mock("../smartflow/dispatcher", () => ({
  dispararMensagemCanal: vi.fn(),
  janelaAcumulacaoAtiva: vi.fn().mockResolvedValue(0),
  dispararNovoLead: vi.fn(),
}));

import { processarEchoCelular } from "../integracoes/whatsapp-handler";
import {
  buscarMensagemPorIdExterno,
  enviarMensagem as salvarMensagem,
  criarOuReutilizarContato,
  criarConversa,
  atualizarConversa,
} from "../escritorio/db-crm";
import { dispararMensagemCanal, dispararNovoLead } from "../smartflow/dispatcher";

const echoBase = {
  chatId: "5585988887777@s.whatsapp.net",
  telefone: "5585988887777",
  conteudo: "Já estou vendo seu processo, um momento",
  tipo: "texto" as const,
  messageId: "wamid.ECHO1",
};

describe("processarEchoCelular — ingestão silenciosa de echo CoEx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buscarMensagemPorIdExterno).mockResolvedValue(null);
    vi.mocked(criarOuReutilizarContato).mockResolvedValue({ id: 5, jaCadastrado: false } as any);
    vi.mocked(criarConversa).mockResolvedValue(42);
    vi.mocked(salvarMensagem).mockResolvedValue(999);
  });

  it("persiste como saída origem 'celular' com wamid e marca em_atendimento", async () => {
    const r = await processarEchoCelular(1, 10, echoBase);

    expect(r).toEqual({ conversaId: 42, mensagemId: 999, duplicada: false });
    expect(salvarMensagem).toHaveBeenCalledTimes(1);
    expect(salvarMensagem).toHaveBeenCalledWith(
      expect.objectContaining({
        conversaId: 42,
        direcao: "saida",
        origem: "celular",
        idExterno: "wamid.ECHO1",
        status: "enviada",
        conteudo: echoBase.conteudo,
      }),
    );
    expect(atualizarConversa).toHaveBeenCalledWith(42, 10, { status: "em_atendimento" });
  });

  it("wamid já persistido (mensagem enviada pela API) → não duplica nem mexe na conversa", async () => {
    vi.mocked(buscarMensagemPorIdExterno).mockResolvedValue({ id: 777, conversaId: 33 });

    const r = await processarEchoCelular(1, 10, echoBase);

    expect(r).toEqual({ conversaId: 33, mensagemId: 777, duplicada: true });
    expect(salvarMensagem).not.toHaveBeenCalled();
    expect(atualizarConversa).not.toHaveBeenCalled();
  });

  it("cria contato e conversa quando a relação viveu só no celular", async () => {
    await processarEchoCelular(1, 10, echoBase);

    expect(criarOuReutilizarContato).toHaveBeenCalledWith(
      expect.objectContaining({ escritorioId: 10, telefone: "5585988887777", origem: "whatsapp" }),
    );
    expect(criarConversa).toHaveBeenCalledWith(
      expect.objectContaining({ escritorioId: 10, contatoId: 5, canalId: 1, chatIdExterno: echoBase.chatId }),
    );
  });

  it("NUNCA dispara SmartFlow, novo_lead ou auto-reply — echo não é mensagem de cliente", async () => {
    await processarEchoCelular(1, 10, echoBase);

    expect(dispararMensagemCanal).not.toHaveBeenCalled();
    expect(dispararNovoLead).not.toHaveBeenCalled();
  });
});
