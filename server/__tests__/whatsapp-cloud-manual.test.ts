/**
 * Testes — `configuracoes.conectarWhatsappCloudManual`.
 *
 * Cadastro MANUAL de WhatsApp Cloud (cola token + phoneNumberId + wabaId).
 * Regressão pros 2 bugs que travavam canais manuais:
 *
 *   1. Canal nascia com `registradoCloudApi=false` → a UI o tratava como
 *      "falta registrar na Cloud API" (formulário de PIN), escondendo
 *      Templates/Perfil/Re-inscrever. Fix: cadastro manual grava `true`
 *      (número já validado via Graph API).
 *
 *   2. Diferente do Embedded Signup, o cadastro manual NÃO inscrevia o app
 *      nos webhooks da WABA → canal enviava mas nunca RECEBIA. Fix: chama
 *      subscribeAppToWaba (best-effort) e devolve `webhooksInscritos`.
 *
 * Tudo mockado (DB, plano, Graph API, axios) — a procedure roda via caller.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async () => ({
    allowed: true, verTodos: true, verProprios: true,
    criar: true, editar: true, excluir: true,
    colaboradorId: 10, escritorioId: 1, cargo: "dono",
  })),
}));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc Teste" },
    colaborador: { id: 10, cargo: "dono" },
  })),
}));

const criarCanalMock = vi.fn(async () => 555);
const registrarAuditMock = vi.fn(async () => {});
vi.mock("../escritorio/db-canais", () => ({
  criarCanal: criarCanalMock,
  contarCanaisPorTipo: vi.fn(async () => ({})),
  registrarAudit: registrarAuditMock,
}));

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({})),
  // cortesia=true pula a checagem de limite de plano (não é o foco aqui).
  getActiveSubscriptionComHeranca: vi.fn(async () => ({ cortesia: true })),
}));

vi.mock("../billing/planos-repo", () => ({
  getPlanoBySlug: vi.fn(async () => ({ limites: { maxConexoesWhatsapp: 999999 } })),
}));

// Graph API: testarConexao controlável por teste.
const testarConexaoMock = vi.fn(async () => ({
  ok: true, nome: "Escritório Teste", telefone: "5585999999999",
}));
vi.mock("../integracoes/whatsapp-cloud", () => ({
  WhatsAppCloudClient: vi.fn(() => ({ testarConexao: testarConexaoMock })),
}));

// axios: usado pelo subscribeAppToWaba (real) — capturamos a inscrição.
const axiosPostMock = vi.fn(async () => ({ data: {} }));
vi.mock("axios", () => ({
  default: {
    post: axiosPostMock,
    create: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() })),
  },
}));

const { configuracoesRouter } = await import("../escritorio/router-configuracoes");

function fakeCtx(): TrpcContext {
  return {
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X",
      loginMethod: "google", role: "user", asaasCustomerId: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

const INPUT_OK = {
  accessToken: "EAA" + "x".repeat(40),
  phoneNumberId: "123456789012345",
  wabaId: "987654321098765",
};

beforeEach(() => {
  vi.clearAllMocks();
  testarConexaoMock.mockResolvedValue({
    ok: true, nome: "Escritório Teste", telefone: "5585999999999",
  });
  axiosPostMock.mockResolvedValue({ data: {} });
});

describe("conectarWhatsappCloudManual", () => {
  it("cria o canal whatsapp_api com a config colada, sem forçar registradoCloudApi", async () => {
    const caller = configuracoesRouter.createCaller(fakeCtx());
    await caller.conectarWhatsappCloudManual(INPUT_OK);

    expect(criarCanalMock).toHaveBeenCalledTimes(1);
    const arg = criarCanalMock.mock.calls[0][0] as any;
    expect(arg.tipo).toBe("whatsapp_api");
    // NÃO força registradoCloudApi: número novo costuma estar "Pendente" e
    // precisa do registro por PIN. Forçar true esconderia essa etapa.
    expect(arg.registradoCloudApi).toBeUndefined();
    expect(arg.config).toMatchObject({
      accessToken: INPUT_OK.accessToken,
      phoneNumberId: INPUT_OK.phoneNumberId,
      wabaId: INPUT_OK.wabaId,
    });
  });

  it("usa nome e telefone verificados pela Meta (não o que o usuário colou)", async () => {
    const caller = configuracoesRouter.createCaller(fakeCtx());
    const res = await caller.conectarWhatsappCloudManual(INPUT_OK);

    expect(res.id).toBe(555);
    expect(res.nome).toBe("Escritório Teste");
    expect(res.telefone).toBe("5585999999999");
  });

  it("inscreve o app nos webhooks da WABA (recebimento de mensagens)", async () => {
    const caller = configuracoesRouter.createCaller(fakeCtx());
    const res = await caller.conectarWhatsappCloudManual(INPUT_OK);

    expect(axiosPostMock).toHaveBeenCalledTimes(1);
    expect(axiosPostMock.mock.calls[0][0]).toContain(`/${INPUT_OK.wabaId}/subscribed_apps`);
    expect(res.webhooksInscritos).toBe(true);
  });

  it("não bloqueia o cadastro quando a inscrição de webhooks falha (best-effort)", async () => {
    axiosPostMock.mockRejectedValueOnce(new Error("sem escopo pra inscrever"));
    const caller = configuracoesRouter.createCaller(fakeCtx());
    const res = await caller.conectarWhatsappCloudManual(INPUT_OK);

    // Canal mesmo assim é criado; só sinaliza que recebimento ficou pendente.
    expect(criarCanalMock).toHaveBeenCalledTimes(1);
    expect(res.id).toBe(555);
    expect(res.webhooksInscritos).toBe(false);
  });

  it("recusa e NÃO grava nada quando a Meta rejeita as credenciais", async () => {
    testarConexaoMock.mockResolvedValueOnce({ ok: false, erro: "Invalid OAuth access token" } as any);
    const caller = configuracoesRouter.createCaller(fakeCtx());

    await expect(caller.conectarWhatsappCloudManual(INPUT_OK)).rejects.toThrow(/validar credenciais|Invalid OAuth/i);
    expect(criarCanalMock).not.toHaveBeenCalled();
    expect(axiosPostMock).not.toHaveBeenCalled();
  });
});
