/**
 * WhatsApp obrigatório no cadastro (pedido do dono, 08/09): o cadastro só
 * pedia nome, e-mail e senha, e quem entrava pelo Google não informava nada —
 * um cliente novo em teste não tinha como ser chamado.
 *
 * Decisões dele que ficam travadas aqui:
 *  - dono de escritório NOVO informa (e-mail/senha e Google) — a trava é no
 *    servidor, não só no form;
 *  - colaborador convidado NÃO informa;
 *  - conta antiga sem número NÃO é cobrada no login.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";
import { MENSAGEM_WHATSAPP_OBRIGATORIO, normalizarWhatsappCadastro } from "../../shared/telefone";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

// ─── Banco falso + dependências do router de auth ─────────────────────────

const NOME = Symbol.for("drizzle:Name");
function nomeTabela(t: any): string { return (t?.[NOME] as string) || ""; }
const filas: Record<string, any[][]> = {};
const capturado = {
  inserts: [] as { table: string; values: any }[],
  updates: [] as { table: string; set: any }[],
};
function proximaFila(table: string): any[] {
  const fila = filas[table];
  return fila && fila.length > 0 ? fila.shift()! : [];
}
function makeDb() {
  function builder(): any {
    let table = "";
    const b: any = {
      from: (t: any) => { table = nomeTabela(t); return b; },
      where: () => b,
      orderBy: () => b,
      limit: () => Promise.resolve(proximaFila(table)),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(proximaFila(table)).then(res, rej),
    };
    return b;
  }
  return {
    select: () => builder(),
    insert: (t: any) => ({
      values: (v: any) => { capturado.inserts.push({ table: nomeTabela(t), values: v }); return Promise.resolve([{ insertId: 1 }]); },
    }),
    update: (t: any) => ({
      set: (s: any) => ({ where: () => { capturado.updates.push({ table: nomeTabela(t), set: s }); return Promise.resolve([{ affectedRows: 1 }]); } }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
}
const dbInstance = makeDb();

const upsertUserMock = vi.fn(async (_u: any) => {});
const getUserByEmailMock = vi.fn(async (_e: string): Promise<any> => undefined);
const getUserByGoogleSubMock = vi.fn(async (_s: string): Promise<any> => undefined);
vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  return {
    ...real,
    getDb: vi.fn(async () => dbInstance),
    upsertUser: (...a: unknown[]) => (upsertUserMock as any)(...a),
    getUserByEmail: (...a: unknown[]) => (getUserByEmailMock as any)(...a),
    getUserByGoogleSub: (...a: unknown[]) => (getUserByGoogleSubMock as any)(...a),
  };
});
vi.mock("../_core/rate-limit", () => ({
  consume: () => ({ allowed: true, retryAfter: 0 }),
  reset: () => {},
}));
vi.mock("../_core/turnstile", () => ({
  verificarTurnstile: async () => ({ ok: true }),
  turnstileAtivo: () => false,
}));
vi.mock("../_core/email", () => ({
  enviarEmailConfirmacao: vi.fn(async () => ({ success: true })),
  enviarEmailRedefinirSenha: vi.fn(async () => ({ success: true })),
  enviarEmailBoasVindas: vi.fn(async () => ({ success: true })),
}));
vi.mock("../_core/sdk", () => ({
  sdk: { createSessionToken: vi.fn(async () => "token-de-sessao") },
}));
vi.mock("../_core/password", () => ({
  hashPassword: vi.fn(async () => "hash"),
  verifyPassword: vi.fn(async () => true),
}));
const aceitarConviteMock = vi.fn(async () => {});
vi.mock("../escritorio/db-escritorio", () => ({
  aceitarConvite: (...a: unknown[]) => (aceitarConviteMock as any)(...a),
  getEscritorioPorUsuario: vi.fn(async () => null),
}));

const { authRouter } = await import("../routers/auth");

const cookies: string[] = [];
function ctxAnonimo(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {}, ip: "127.0.0.1" } as any,
    res: { clearCookie: () => {}, cookie: (nome: string) => { cookies.push(nome); } } as any,
  };
}
const caller = () => authRouter.createCaller(ctxAnonimo());

/** O Google devolve o perfil do token — aqui a resposta do `tokeninfo`. */
function googleResponde(perfil: { sub: string; email: string; name: string }) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => perfil })));
}

const CADASTRO = { name: "Carla Ramos", email: "carla@ramoslacerda.adv.br", password: "segredo1", aceitouTermos: true as const };
const USUARIO_CRIADO = { id: 7, openId: "email-x", email: CADASTRO.email, name: CADASTRO.name };
const TOKEN_GOOGLE = "id-token-do-google-com-tamanho-suficiente";
const TOKEN_CONVITE = "convite-com-dezesseis-ou-mais";

beforeEach(() => {
  capturado.inserts = [];
  capturado.updates = [];
  cookies.length = 0;
  upsertUserMock.mockClear();
  aceitarConviteMock.mockClear();
  getUserByEmailMock.mockReset();
  getUserByEmailMock.mockResolvedValue(undefined);
  getUserByGoogleSubMock.mockReset();
  getUserByGoogleSubMock.mockResolvedValue(undefined);
  for (const k of Object.keys(filas)) delete filas[k];
  vi.unstubAllGlobals();
});

describe("normalizarWhatsappCadastro", () => {
  it("aceita celular e fixo com DDD, com ou sem DDI, e grava só os dígitos nacionais", () => {
    expect(normalizarWhatsappCadastro("(85) 99123-4567")).toBe("85991234567");
    expect(normalizarWhatsappCadastro("5585991234567")).toBe("85991234567");
    expect(normalizarWhatsappCadastro("+55 85 99123-4567")).toBe("85991234567");
    expect(normalizarWhatsappCadastro("85 3212-3456")).toBe("8532123456");
    // "55" com 11 dígitos é DDD (Rio Grande do Sul), não DDI.
    expect(normalizarWhatsappCadastro("(55) 99123-4567")).toBe("55991234567");
  });

  it("recusa o que o botão “Abrir WhatsApp” nunca alcançaria", () => {
    expect(normalizarWhatsappCadastro("")).toBeNull();
    expect(normalizarWhatsappCadastro(null)).toBeNull();
    expect(normalizarWhatsappCadastro("8599")).toBeNull();
    // DDI colado como DDD: "(55) 85997-9657" é o bug do atendimento-x1.
    expect(normalizarWhatsappCadastro("(55) 85997-9657")).toBeNull();
    // Celular sem o 9 na frente, DDD começando com zero, número estrangeiro.
    expect(normalizarWhatsappCadastro("85812345678")).toBeNull();
    expect(normalizarWhatsappCadastro("05991234567")).toBeNull();
    expect(normalizarWhatsappCadastro("+1 415 555 2671")).toBeNull();
  });
});

describe("auth.signup — dono de escritório novo informa WhatsApp", () => {
  it("sem WhatsApp a conta NÃO nasce — a trava é do servidor, não do form", async () => {
    await expect(caller().signup(CADASTRO)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: MENSAGEM_WHATSAPP_OBRIGATORIO,
    });
    expect(upsertUserMock).not.toHaveBeenCalled();
    expect(capturado.inserts).toHaveLength(0);
  });

  it("número inválido (DDI colado como DDD) também não passa", async () => {
    await expect(caller().signup({ ...CADASTRO, whatsapp: "(55) 85997-9657" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(upsertUserMock).not.toHaveBeenCalled();
  });

  it("com WhatsApp válido grava só os dígitos nacionais no user", async () => {
    getUserByEmailMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce(USUARIO_CRIADO);
    const r = await caller().signup({ ...CADASTRO, whatsapp: "+55 (85) 99123-4567" });
    expect(r.needsConfirmation).toBe(true);
    expect(upsertUserMock).toHaveBeenCalledWith(expect.objectContaining({ email: CADASTRO.email, whatsapp: "85991234567" }));
  });

  it("colaborador convidado não informa WhatsApp (decisão do dono)", async () => {
    filas["convites_colaborador"] = [[{ id: 3, escritorioId: 9, email: CADASTRO.email, status: "pendente", token: TOKEN_CONVITE, expiresAt: new Date(Date.now() + 86_400_000) }]];
    getUserByEmailMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce(USUARIO_CRIADO);
    const r = await caller().signup({ ...CADASTRO, conviteToken: TOKEN_CONVITE });
    expect(r.needsConfirmation).toBe(false);
    expect(aceitarConviteMock).toHaveBeenCalledWith(TOKEN_CONVITE, USUARIO_CRIADO.id);
    expect(upsertUserMock).toHaveBeenCalledWith(expect.objectContaining({ email: CADASTRO.email }));
    expect((upsertUserMock.mock.calls[0] as any[])[0].whatsapp).toBeUndefined();
  });
});

describe("auth.loginGoogle — conta nova pelo Google nasce com WhatsApp", () => {
  const PERFIL = { sub: "g-123", email: "nova@escritorio.adv.br", name: "Nova Advogada" };

  it("e-mail sem conta e sem WhatsApp: devolve precisaWhatsapp e NÃO cria a conta nem loga", async () => {
    googleResponde(PERFIL);
    const r = await caller().loginGoogle({ idToken: TOKEN_GOOGLE });
    expect(r).toEqual({ success: false, precisaWhatsapp: true, email: PERFIL.email, name: PERFIL.name });
    expect(upsertUserMock).not.toHaveBeenCalled();
    expect(cookies).toHaveLength(0);
  });

  it("WhatsApp sem o aceite dos termos também volta pro passo (o modal manda os dois)", async () => {
    googleResponde(PERFIL);
    const r = await caller().loginGoogle({ idToken: TOKEN_GOOGLE, whatsapp: "(85) 99123-4567" });
    expect(r).toEqual(expect.objectContaining({ precisaWhatsapp: true }));
    expect(upsertUserMock).not.toHaveBeenCalled();
  });

  it("com WhatsApp + aceite: cria a conta com o número, registra o aceite e loga", async () => {
    googleResponde(PERFIL);
    getUserByEmailMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: 8, openId: "google-g-123", email: PERFIL.email });
    const r = await caller().loginGoogle({ idToken: TOKEN_GOOGLE, whatsapp: "(85) 99123-4567", aceitouTermos: true });
    expect(r).toEqual(expect.objectContaining({ success: true, email: PERFIL.email }));
    expect(upsertUserMock).toHaveBeenCalledWith(expect.objectContaining({ googleSub: "g-123", whatsapp: "85991234567", emailVerificado: true }));
    expect(capturado.updates.find((u) => u.table === "users")?.set).toEqual(expect.objectContaining({ termosVersaoAceita: expect.any(Number) }));
    expect(capturado.inserts.find((i) => i.table === "aceites_termos")?.values).toEqual(expect.objectContaining({ userId: 8, contexto: "cadastro", ip: "127.0.0.1" }));
    expect(cookies).toHaveLength(1);
  });

  it("conta antiga sem número entra como sempre — ninguém é cobrado no login", async () => {
    googleResponde(PERFIL);
    getUserByGoogleSubMock.mockResolvedValue({ id: 5, openId: "google-g-123", email: PERFIL.email, whatsapp: null });
    const r = await caller().loginGoogle({ idToken: TOKEN_GOOGLE });
    expect(r).toEqual(expect.objectContaining({ success: true }));
    expect((upsertUserMock.mock.calls[0] as any[])[0].whatsapp).toBeUndefined();
    expect(capturado.inserts.filter((i) => i.table === "aceites_termos")).toHaveLength(0);
    expect(cookies).toHaveLength(1);
  });

  it("convidado por um escritório entra pelo Google sem informar WhatsApp", async () => {
    googleResponde(PERFIL);
    filas["convites_colaborador"] = [[{ status: "pendente", expiresAt: new Date(Date.now() + 86_400_000) }]];
    getUserByEmailMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: 9, openId: "google-g-123" });
    const r = await caller().loginGoogle({ idToken: TOKEN_GOOGLE, conviteToken: TOKEN_CONVITE });
    expect(r).toEqual(expect.objectContaining({ success: true }));
    expect(upsertUserMock).toHaveBeenCalledTimes(1);
  });

  it("convite inventado (ou já usado) não abre o atalho", async () => {
    googleResponde(PERFIL);
    filas["convites_colaborador"] = [[{ status: "aceito", expiresAt: new Date(Date.now() + 86_400_000) }]];
    const r = await caller().loginGoogle({ idToken: TOKEN_GOOGLE, conviteToken: TOKEN_CONVITE });
    expect(r).toEqual(expect.objectContaining({ precisaWhatsapp: true }));
    expect(upsertUserMock).not.toHaveBeenCalled();
  });
});

describe("amarras no código", () => {
  it("o form pede o WhatsApp só pra dono novo, e o passo do Google só nasce a conta depois dele", () => {
    const form = ler("client/src/pages/auth/AuthForms.tsx");
    expect(form).toContain('id="signup-whatsapp"');
    expect(form).toContain("const exigeWhatsapp = !conviteToken;");
    expect(form).toContain("{exigeWhatsapp && (");
    expect(form).toContain("(exigeWhatsapp && !whatsappValido) ||");
    expect(form).toContain("Falta só o seu WhatsApp");
    expect(form).toContain('if ("precisaWhatsapp" in data && data.precisaWhatsapp) {');
    expect(form).toContain("loginGoogleMut.mutate({ idToken: response.credential, conviteToken })");
    expect(form).toContain("loginGoogleMut.mutate({ idToken: googlePendente.idToken, whatsapp, aceitouTermos: true })");
  });

  it("o número sobrevive ao upsert e chega ao painel admin (ficha, lista, caderninho)", () => {
    const db = ler("server/db.ts");
    expect(db).toContain('const textFields = ["name", "email", "loginMethod", "passwordHash", "googleSub", "whatsapp"] as const;');
    expect(db.slice(db.indexOf("const USERS_PUBLIC_COLUMNS"), db.indexOf("} as const;", db.indexOf("const USERS_PUBLIC_COLUMNS")))).toContain("whatsapp: users.whatsapp");
    expect(db).toContain("whatsapp: u.whatsapp ?? null,");

    const adm = ler("server/routers/admin.ts");
    const detalhe = adm.slice(adm.indexOf("clienteDetalhes: adminProcedure"), adm.indexOf(".from(users)", adm.indexOf("clienteDetalhes: adminProcedure")));
    expect(detalhe).toContain("whatsapp: users.whatsapp");

    const tela = ler("client/src/pages/admin/AdminClients.tsx");
    expect(tela).toContain("<TableHead>WhatsApp</TableHead>");
    expect(tela).toContain("telefoneParaWaMe(user.whatsapp)");
    expect(tela).toContain("telefoneParaWaMe(u.whatsapp)");
    expect(tela).toContain("Abrir conversa no WhatsApp");
    expect(tela).not.toContain("https://wa.me/");
  });

  it("coluna nova é opcional (conta antiga e convidado ficam NULL) e o schema acompanha", () => {
    expect(ler("drizzle/0215_users_whatsapp.sql")).toContain("ALTER TABLE users ADD COLUMN whatsapp VARCHAR(20) DEFAULT NULL;");
    expect(ler("drizzle/schema.ts")).toContain('whatsapp: varchar("whatsapp", { length: 20 })');
  });
});
