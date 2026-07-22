/**
 * Testes — dedup de inbound por wamid (processarMensagemRecebida).
 *
 * A Meta reentrega webhooks (timeout/retry) e, em CoEx, mensagem enviada
 * pela própria API pode voltar como echo com o MESMO wamid. Regra: id
 * externo já persistido = mensagem já processada — nada de bolha duplicada
 * nem SmartFlow redisparado.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// db genérico: toda query interna do handler (conversa por chatId, status,
// escritório...) resolve vazio — força o caminho "tudo novo".
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
  registrarOptInSeAusente: vi.fn(),
  aplicarOptOut: vi.fn(),
  removerOptOut: vi.fn(),
  mensagemConfirmacaoSaida: () => "",
  mensagemConfirmacaoVolta: () => "",
}));

vi.mock("../_core/sse-notifications", () => ({ emitirParaResponsaveisEMaster: vi.fn() }));

vi.mock("../smartflow/dispatcher", () => ({
  dispararMensagemCanal: vi.fn().mockResolvedValue({ executou: false, respostas: [] }),
  janelaAcumulacaoAtiva: vi.fn().mockResolvedValue(0),
  dispararNovoLead: vi.fn(),
}));

import { processarMensagemRecebida } from "../integracoes/whatsapp-handler";
import {
  buscarMensagemPorIdExterno,
  enviarMensagem as salvarMensagem,
  criarConversa,
} from "../escritorio/db-crm";
import { dispararMensagemCanal } from "../smartflow/dispatcher";

const msgBase = {
  chatId: "5585999990000@s.whatsapp.net",
  nome: "Maria",
  telefone: "5585999990000",
  conteudo: "olá!",
  tipo: "texto" as const,
  timestamp: 1700000000,
  isGroup: false,
};

describe("processarMensagemRecebida — dedup por wamid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buscarMensagemPorIdExterno).mockResolvedValue(null);
    vi.mocked(criarConversa).mockResolvedValue(42);
    vi.mocked(salvarMensagem).mockResolvedValue(999);
    vi.mocked(dispararMensagemCanal).mockResolvedValue({ executou: false, respostas: [] } as any);
  });

  it("wamid já persistido → retorna a mensagem existente sem salvar nem disparar fluxo", async () => {
    vi.mocked(buscarMensagemPorIdExterno).mockResolvedValue({ id: 777, conversaId: 33 });

    const r = await processarMensagemRecebida(1, 10, { ...msgBase, messageId: "wamid.REPETIDO" });

    expect(r).toEqual({ contatoId: 0, conversaId: 33, mensagemId: 777 });
    expect(salvarMensagem).not.toHaveBeenCalled();
    expect(criarConversa).not.toHaveBeenCalled();
    expect(dispararMensagemCanal).not.toHaveBeenCalled();
  });

  it("wamid novo → processa e persiste com idExterno preenchido", async () => {
    const r = await processarMensagemRecebida(1, 10, { ...msgBase, messageId: "wamid.NOVO" });

    expect(r.mensagemId).toBe(999);
    expect(salvarMensagem).toHaveBeenCalledTimes(1);
    expect(salvarMensagem).toHaveBeenCalledWith(
      expect.objectContaining({ direcao: "entrada", idExterno: "wamid.NOVO", conteudo: "olá!" }),
    );
  });

  it("mensagem sem messageId (canal legado) não consulta dedup e processa normal", async () => {
    const r = await processarMensagemRecebida(1, 10, { ...msgBase, messageId: "" });

    expect(buscarMensagemPorIdExterno).not.toHaveBeenCalled();
    expect(r.mensagemId).toBe(999);
  });
});
