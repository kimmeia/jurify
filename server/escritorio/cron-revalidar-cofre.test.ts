/**
 * Testes de regressão pro cron de revalidação do cofre.
 *
 * Cenários cobertos (após fix 22/05/2026):
 *  1. Credenciais em status "expirada" ENTRAM na fila de revalidação
 *     (antes ficavam presas pra sempre).
 *  2. Quando uma credencial em "expirada"/"erro" volta a funcionar,
 *     `notificarCredencialRecuperada` é chamada — fecha o loop do user.
 *  3. Quando uma credencial "ativa" cai durante o cron, dispara
 *     `notificarCredencialCaiu` (user é avisado antes de tentar usar).
 *  4. Transições "erro"→"erro" e "expirada"→"expirada" não geram ruído.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────
const buscarCredencialDecriptada = vi.fn();
const atualizarStatusAposLogin = vi.fn();
const salvarSessao = vi.fn();
const notificarCredencialCaiu = vi.fn();
const notificarCredencialRecuperada = vi.fn();

vi.mock("./cofre-helpers", () => ({
  buscarCredencialDecriptada,
  atualizarStatusAposLogin,
  salvarSessao,
  notificarCredencialCaiu,
  notificarCredencialRecuperada,
}));

const testarLoginMock = vi.fn();
class PjeTjceScraper {
  constructor(_: any) {}
  testarLogin() {
    return testarLoginMock();
  }
}
vi.mock(
  "../../scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce",
  () => ({ PjeTjceScraper }),
);

// Capturas
const filtroDoUltimoSelect = {
  ultimaWhere: null as any,
};
let candidatasMock: any[] = [];

const mockDb = {
  select: () => ({
    from: () => ({
      where: (cond: any) => {
        filtroDoUltimoSelect.ultimaWhere = cond;
        return Promise.resolve(candidatasMock);
      },
    }),
  }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

vi.mock("../_core/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { revalidarCofreCredenciais } = await import("./cron-revalidar-cofre");

beforeEach(() => {
  buscarCredencialDecriptada.mockReset();
  atualizarStatusAposLogin.mockReset();
  salvarSessao.mockReset();
  notificarCredencialCaiu.mockReset();
  notificarCredencialRecuperada.mockReset();
  testarLoginMock.mockReset();
  candidatasMock = [];
});

const CRED_BASE = {
  id: 1,
  escritorioId: 100,
  sistema: "pje_tjce",
  apelido: "OAB-CE 12345",
  criadoPor: 7,
  status: "ativa",
  ultimoLoginTentativaEm: new Date(Date.now() - 80 * 60 * 1000), // 80min atrás, > corte
};

describe("revalidarCofreCredenciais — fila inclui expirada", () => {
  it("credencial em status 'expirada' ENTRA na fila de revalidação", async () => {
    candidatasMock = [{ ...CRED_BASE, status: "expirada" }];
    buscarCredencialDecriptada.mockResolvedValue({
      id: 1,
      username: "u",
      password: "p",
      totpSecret: null,
    });
    testarLoginMock.mockResolvedValue({ ok: true, storageStateJson: "abc" });

    const resultado = await revalidarCofreCredenciais();

    expect(resultado.total).toBe(1);
    expect(resultado.okeis).toBe(1);
    expect(testarLoginMock).toHaveBeenCalledOnce();
  });
});

describe("revalidarCofreCredenciais — notificações de transição", () => {
  it("transição 'expirada' → 'ativa' chama notificarCredencialRecuperada", async () => {
    candidatasMock = [{ ...CRED_BASE, status: "expirada" }];
    buscarCredencialDecriptada.mockResolvedValue({ id: 1, username: "u", password: "p", totpSecret: null });
    testarLoginMock.mockResolvedValue({ ok: true, storageStateJson: "abc" });

    await revalidarCofreCredenciais();

    expect(notificarCredencialRecuperada).toHaveBeenCalledOnce();
    expect(notificarCredencialRecuperada).toHaveBeenCalledWith(
      expect.objectContaining({
        credencialId: 1,
        userId: 7,
        apelido: "OAB-CE 12345",
        sistema: "pje_tjce",
      }),
    );
    expect(notificarCredencialCaiu).not.toHaveBeenCalled();
  });

  it("transição 'erro' → 'ativa' também chama notificarCredencialRecuperada", async () => {
    candidatasMock = [{ ...CRED_BASE, status: "erro" }];
    buscarCredencialDecriptada.mockResolvedValue({ id: 1, username: "u", password: "p", totpSecret: null });
    testarLoginMock.mockResolvedValue({ ok: true, storageStateJson: "abc" });

    await revalidarCofreCredenciais();

    expect(notificarCredencialRecuperada).toHaveBeenCalledOnce();
  });

  it("transição 'ativa' → 'erro' (login falha) chama notificarCredencialCaiu", async () => {
    candidatasMock = [{ ...CRED_BASE, status: "ativa" }];
    buscarCredencialDecriptada.mockResolvedValue({ id: 1, username: "u", password: "p", totpSecret: null });
    testarLoginMock.mockResolvedValue({
      ok: false,
      mensagem: "Senha incorreta",
      detalhes: "Keycloak retornou 401",
    });

    await revalidarCofreCredenciais();

    expect(notificarCredencialCaiu).toHaveBeenCalledOnce();
    expect(notificarCredencialCaiu).toHaveBeenCalledWith(
      expect.objectContaining({
        credencialId: 1,
        userId: 7,
        novoStatus: "erro",
        motivo: expect.stringContaining("Senha incorreta"),
      }),
    );
    expect(notificarCredencialRecuperada).not.toHaveBeenCalled();
  });

  it("transição 'erro' → 'erro' (ainda falha) NÃO repete notificação", async () => {
    candidatasMock = [{ ...CRED_BASE, status: "erro" }];
    buscarCredencialDecriptada.mockResolvedValue({ id: 1, username: "u", password: "p", totpSecret: null });
    testarLoginMock.mockResolvedValue({ ok: false, mensagem: "Ainda errado" });

    await revalidarCofreCredenciais();

    expect(notificarCredencialCaiu).not.toHaveBeenCalled();
    expect(notificarCredencialRecuperada).not.toHaveBeenCalled();
  });

  it("transição 'expirada' → 'expirada' (ainda quebrado) NÃO repete notificação", async () => {
    candidatasMock = [{ ...CRED_BASE, status: "expirada" }];
    buscarCredencialDecriptada.mockResolvedValue({ id: 1, username: "u", password: "p", totpSecret: null });
    testarLoginMock.mockResolvedValue({ ok: false, mensagem: "Continua expirado" });

    await revalidarCofreCredenciais();

    expect(notificarCredencialCaiu).not.toHaveBeenCalled();
    expect(notificarCredencialRecuperada).not.toHaveBeenCalled();
  });

  it("transição 'validando' → 'ativa' (primeira validação OK) NÃO notifica recuperada", async () => {
    // Validando = primeira vez configurando. Não tinha "caído" antes.
    candidatasMock = [{ ...CRED_BASE, status: "validando" }];
    buscarCredencialDecriptada.mockResolvedValue({ id: 1, username: "u", password: "p", totpSecret: null });
    testarLoginMock.mockResolvedValue({ ok: true, storageStateJson: "abc" });

    await revalidarCofreCredenciais();

    expect(notificarCredencialRecuperada).not.toHaveBeenCalled();
    expect(notificarCredencialCaiu).not.toHaveBeenCalled();
  });
});

describe("revalidarCofreCredenciais — segurança", () => {
  it("sistemas que não sejam pje_tjce são pulados sem crash", async () => {
    candidatasMock = [
      { ...CRED_BASE, id: 2, sistema: "esaj_tjsp", status: "ativa" },
    ];

    const resultado = await revalidarCofreCredenciais();

    expect(resultado.puladas).toBe(1);
    expect(testarLoginMock).not.toHaveBeenCalled();
    expect(notificarCredencialCaiu).not.toHaveBeenCalled();
  });

  it("credencial não decriptável NÃO crasha cron", async () => {
    candidatasMock = [{ ...CRED_BASE, status: "ativa" }];
    buscarCredencialDecriptada.mockResolvedValue(null);

    const resultado = await revalidarCofreCredenciais();

    expect(resultado.erros).toBe(1);
    expect(testarLoginMock).not.toHaveBeenCalled();
  });
});
