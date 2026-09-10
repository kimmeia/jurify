/**
 * Um número, um cadastro — o gancho no recebimento de mensagem.
 *
 * Depois de resolver conversa e contato, o handler pergunta ao
 * reconhecimento de cadastro se a ficha presa à conversa foi absorvida por
 * um cadastro completo (e atualiza o endereço de resposta). O contato
 * devolvido é o que o resto do fluxo usa: episódio, opt-in, notificação,
 * SmartFlow. E se o reconhecimento falhar, a mensagem segue — nunca cai.
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
  criarOuReutilizarContato: vi.fn().mockResolvedValue({ id: 5, jaCadastrado: true }),
  listarContatos: vi.fn().mockResolvedValue([]),
  buscarContatoPorTelefone: vi.fn().mockResolvedValue(undefined),
  criarConversa: vi.fn().mockResolvedValue(42),
  enviarMensagem: vi.fn().mockResolvedValue(999),
  atualizarStatusMensagem: vi.fn(),
  atualizarConversa: vi.fn(),
  buscarMensagemPorIdExterno: vi.fn().mockResolvedValue(null),
  desarquivarSeArquivada: vi.fn(),
}));

vi.mock("../integracoes/whatsapp-optout", () => ({
  interpretarComandoOptOut: () => null,
  pareceIntencaoDeOptOut: () => false,
  registrarOptInSeAusente: vi.fn(),
  aplicarOptOut: vi.fn(),
  removerOptOut: vi.fn(),
  mensagemConfirmacaoSaida: () => "",
  mensagemConfirmacaoVolta: () => "",
}));

const registrarEpisodio = vi.fn(async () => {});
vi.mock("../atendimento/episodios", () => ({
  registrarMensagemNoEpisodio: (...a: unknown[]) => (registrarEpisodio as any)(...a),
}));

vi.mock("../_core/sse-notifications", () => ({ emitirParaResponsaveisEMaster: vi.fn() }));

vi.mock("../smartflow/dispatcher", () => ({
  dispararMensagemCanal: vi.fn().mockResolvedValue({ executou: false, respostas: [] }),
  janelaAcumulacaoAtiva: vi.fn().mockResolvedValue(0),
  dispararNovoLead: vi.fn(),
}));

const reconhecerMock = vi.fn(async (): Promise<any> => ({ contatoId: 5, unificacaoId: null, enderecoAtualizado: false }));
vi.mock("../escritorio/reconhecer-cadastro", () => ({
  reconhecerCadastroNaEntrada: (...a: unknown[]) => reconhecerMock(...(a as [])),
}));

import { processarMensagemRecebida } from "../integracoes/whatsapp-handler";
import { enviarMensagem as salvarMensagem } from "../escritorio/db-crm";

const msg = {
  chatId: "558598765432@s.whatsapp.net",
  nome: "Francisco",
  telefone: "558598765432",
  conteudo: "Bom dia",
  tipo: "texto" as const,
  timestamp: 1700000000,
  messageId: "wamid.1",
  isGroup: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  reconhecerMock.mockResolvedValue({ contatoId: 5, unificacaoId: null, enderecoAtualizado: false });
});

describe("processarMensagemRecebida — reconhecimento do cadastro na entrada", () => {
  it("chama o reconhecimento com conversa, contato e de onde o cliente escreveu", async () => {
    await processarMensagemRecebida(1, 10, msg);
    expect(reconhecerMock).toHaveBeenCalledTimes(1);
    expect((reconhecerMock.mock.calls[0] as any[])[1]).toEqual({
      escritorioId: 10, conversaId: 42, contatoId: 5, chatId: msg.chatId, telefone: msg.telefone,
    });
  });

  it("ficha magra absorvida → o resto do fluxo passa a usar o cadastro completo", async () => {
    reconhecerMock.mockResolvedValue({ contatoId: 77, unificacaoId: 9, enderecoAtualizado: true });
    await processarMensagemRecebida(1, 10, msg);
    expect(salvarMensagem).toHaveBeenCalledTimes(1);
    expect(registrarEpisodio).toHaveBeenCalledWith(expect.objectContaining({ contatoId: 77, conversaId: 42 }));
  });

  it("sem unificação, o contato continua o mesmo", async () => {
    await processarMensagemRecebida(1, 10, msg);
    expect(registrarEpisodio).toHaveBeenCalledWith(expect.objectContaining({ contatoId: 5 }));
  });

  it("se o reconhecimento falhar, a mensagem é salva do mesmo jeito", async () => {
    reconhecerMock.mockRejectedValue(new Error("banco fora"));
    const r = await processarMensagemRecebida(1, 10, msg);
    expect(r.mensagemId).toBe(999);
    expect(salvarMensagem).toHaveBeenCalledTimes(1);
    expect(registrarEpisodio).toHaveBeenCalledWith(expect.objectContaining({ contatoId: 5 }));
  });
});
