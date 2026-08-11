/**
 * Saída da impersonation.
 *
 * Entrar como alguém SUBSTITUI o cookie de sessão — a do admin deixa de
 * existir, e o único rastro dela é o `impersonatedBy` dentro do token do
 * alvo. Antes disso virar procedure, a única saída era o logout: o admin
 * caía na tela de login em vez de voltar pro painel.
 *
 * O que precisa continuar valendo:
 *  - o cargo é conferido NA SAÍDA, não herdado da entrada. Um admin
 *    rebaixado (ou bloqueado, ou apagado) no meio da sessão não pode
 *    receber uma sessão de admin de volta;
 *  - a sessão nova não carrega `impersonatedBy` — senão o bypass de
 *    superuser sobreviveria à saída;
 *  - quando não há pra onde voltar, o cookie é derrubado. Deixar o token
 *    do alvo em pé seria pior que o logout que existia antes.
 */

process.env.JWT_SECRET ||= "segredo-de-teste-impersonacao";

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";
import { COOKIE_NAME } from "../../shared/const";

const getDbMock = vi.fn();

vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  return { ...real, getDb: (...a: unknown[]) => (getDbMock as any)(...a) };
});

const registrarAuditoriaMock = vi.fn(async () => {});
vi.mock("../_core/audit", () => ({
  registrarAuditoria: (...a: unknown[]) => (registrarAuditoriaMock as any)(...a),
}));

const { adminRouter } = await import("../routers/admin");
const { sdk } = await import("../_core/sdk");

const ADMIN = {
  id: 1,
  openId: "admin-openid",
  email: "admin@juridflow.com",
  name: "Admin JuridFlow",
  role: "admin",
  bloqueado: false,
};

/** Encadeamento mínimo do drizzle usado pelas duas procedures. */
function fakeDb(linhas: unknown[]) {
  const alvo = { limit: async () => linhas };
  const cadeia: any = {
    from: () => cadeia,
    innerJoin: () => cadeia,
    where: () => alvo,
  };
  return { select: () => cadeia };
}

type Cookie = { name: string; valor?: string; options: Record<string, unknown> };

function contexto(impersonatedBy: string | undefined, expiraEm?: number) {
  const setados: Cookie[] = [];
  const limpos: Cookie[] = [];

  const ctx = {
    user: {
      id: 42,
      openId: "cliente-openid",
      email: "cliente@escritorio.com",
      name: "Cliente Teste",
      role: "user",
      bloqueado: false,
      impersonatedBy,
      impersonacaoExpiraEm: expiraEm,
    },
    req: { protocol: "https", headers: {}, ip: "127.0.0.1" },
    res: {
      cookie: (name: string, valor: string, options: Record<string, unknown>) =>
        setados.push({ name, valor, options }),
      clearCookie: (name: string, options: Record<string, unknown>) =>
        limpos.push({ name, options }),
    },
  } as unknown as TrpcContext;

  return { ctx, setados, limpos };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin.encerrarImpersonacao", () => {
  it("devolve uma sessão de admin limpa quando o admin continua admin", async () => {
    getDbMock.mockResolvedValue(fakeDb([ADMIN]));
    const { ctx, setados, limpos } = contexto("admin-openid");

    const r = await adminRouter.createCaller(ctx).encerrarImpersonacao();

    expect(r).toEqual({ success: true });
    expect(limpos).toHaveLength(0);
    expect(setados).toHaveLength(1);
    expect(setados[0]?.name).toBe(COOKIE_NAME);

    const sessao = await sdk.verifySession(setados[0]!.valor);
    expect(sessao?.openId).toBe("admin-openid");
    // Sem isso, o bypass de superuser sobreviveria à saída.
    expect(sessao?.impersonatedBy).toBeUndefined();
  });

  it("registra a saída na auditoria — antes só a entrada era registrada", async () => {
    getDbMock.mockResolvedValue(fakeDb([ADMIN]));
    const { ctx } = contexto("admin-openid");

    await adminRouter.createCaller(ctx).encerrarImpersonacao();

    expect(registrarAuditoriaMock).toHaveBeenCalledTimes(1);
    expect(registrarAuditoriaMock.mock.calls[0]![0]).toMatchObject({
      acao: "user.impersonar.encerrar",
      alvoTipo: "user",
      alvoId: 42,
    });
  });

  it("admin rebaixado no meio da sessão NÃO recupera os poderes", async () => {
    getDbMock.mockResolvedValue(fakeDb([{ ...ADMIN, role: "user" }]));
    const { ctx, setados, limpos } = contexto("admin-openid");

    await expect(
      adminRouter.createCaller(ctx).encerrarImpersonacao(),
    ).rejects.toThrow(/administrador não está mais ativa/);

    expect(setados).toHaveLength(0);
    expect(limpos).toHaveLength(1);
    expect(limpos[0]?.name).toBe(COOKIE_NAME);
  });

  it("admin bloqueado no meio da sessão também cai fora", async () => {
    getDbMock.mockResolvedValue(fakeDb([{ ...ADMIN, bloqueado: true }]));
    const { ctx, setados, limpos } = contexto("admin-openid");

    await expect(
      adminRouter.createCaller(ctx).encerrarImpersonacao(),
    ).rejects.toThrow();
    expect(setados).toHaveLength(0);
    expect(limpos).toHaveLength(1);
  });

  it("admin que não existe mais deixa a sessão sem cookie nenhum", async () => {
    getDbMock.mockResolvedValue(fakeDb([]));
    const { ctx, setados, limpos } = contexto("admin-openid");

    await expect(
      adminRouter.createCaller(ctx).encerrarImpersonacao(),
    ).rejects.toThrow();
    expect(setados).toHaveLength(0);
    expect(limpos).toHaveLength(1);
  });

  it("sessão normal não tem o que encerrar", async () => {
    getDbMock.mockResolvedValue(fakeDb([ADMIN]));
    const { ctx, setados, limpos } = contexto(undefined);

    await expect(
      adminRouter.createCaller(ctx).encerrarImpersonacao(),
    ).rejects.toThrow(/não é uma impersonação/);

    // Nem devolve sessão nem derruba a que existe.
    expect(setados).toHaveLength(0);
    expect(limpos).toHaveLength(0);
  });
});

describe("admin.contextoImpersonacao", () => {
  it("entrega nome, escritório e vencimento pra faixa", async () => {
    getDbMock.mockResolvedValue(fakeDb([{ nome: "Silva Advocacia" }]));
    const expira = 1_700_000_000_000;
    const { ctx } = contexto("admin-openid", expira);

    const r = await adminRouter.createCaller(ctx).contextoImpersonacao();

    expect(r).toEqual({
      alvoNome: "Cliente Teste",
      escritorioNome: "Silva Advocacia",
      expiraEm: expira,
    });
  });

  it("fora de impersonação não devolve nada", async () => {
    getDbMock.mockResolvedValue(fakeDb([{ nome: "Silva Advocacia" }]));
    const { ctx } = contexto(undefined);

    expect(await adminRouter.createCaller(ctx).contextoImpersonacao()).toBeNull();
  });
});
