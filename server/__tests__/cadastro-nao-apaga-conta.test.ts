/**
 * O cadastro é rota PÚBLICA e nunca apaga conta.
 *
 * Antes, e-mail já cadastrado sem vínculo ativo com escritório ("órfão":
 * colaborador removido, dono ainda em onboarding) fazia o signup apagar
 * `colaboradores` e `users` daquele e-mail e criar a conta de novo — qualquer
 * pessoa na internet tomava a conta. Regra que fica travada aqui:
 *  - e-mail existente e CONFIRMADO → recusa, com a dica do "Esqueci a senha";
 *  - e-mail existente NÃO confirmado e órfão → não apaga nada, não troca a
 *    senha: reenvia a confirmação e devolve a MESMA resposta de um cadastro
 *    novo (quem tenta não descobre se a conta existia);
 *  - e-mail novo → cria como sempre.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

// ─── Banco falso + dependências do router de auth ─────────────────────────

const NOME = Symbol.for("drizzle:Name");
function nomeTabela(t: any): string { return (t?.[NOME] as string) || ""; }
const filas: Record<string, any[][]> = {};
const capturado = {
  inserts: [] as { table: string; values: any }[],
  updates: [] as { table: string; set: any }[],
  deletes: [] as { table: string }[],
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
    delete: (t: any) => ({
      where: () => { capturado.deletes.push({ table: nomeTabela(t) }); return Promise.resolve([{ affectedRows: 1 }]); },
    }),
  };
}
const dbInstance = makeDb();

const upsertUserMock = vi.fn(async (_u: any) => {});
const getUserByEmailMock = vi.fn(async (_e: string): Promise<any> => undefined);
vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  return {
    ...real,
    getDb: vi.fn(async () => dbInstance),
    upsertUser: (...a: unknown[]) => (upsertUserMock as any)(...a),
    getUserByEmail: (...a: unknown[]) => (getUserByEmailMock as any)(...a),
    getUserByGoogleSub: vi.fn(async () => undefined),
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
const enviarEmailConfirmacaoMock = vi.fn(async (_a: any) => ({ success: true }));
vi.mock("../_core/email", () => ({
  enviarEmailConfirmacao: (...a: unknown[]) => (enviarEmailConfirmacaoMock as any)(...a),
  enviarEmailRedefinirSenha: vi.fn(async () => ({ success: true })),
  enviarEmailBoasVindas: vi.fn(async () => ({ success: true })),
}));
vi.mock("../_core/sdk", () => ({
  sdk: { createSessionToken: vi.fn(async () => "token-de-sessao") },
}));
vi.mock("../_core/password", () => ({
  hashPassword: vi.fn(async () => "hash-novo"),
  verifyPassword: vi.fn(async () => true),
}));
vi.mock("../escritorio/db-escritorio", () => ({
  aceitarConvite: vi.fn(async () => {}),
  criarEscritorio: vi.fn(async () => {}),
  getEscritorioPorUsuario: vi.fn(async () => null),
}));

const { authRouter, MENSAGEM_EMAIL_JA_CADASTRADO } = await import("../routers/auth");

function ctxAnonimo(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {}, ip: "127.0.0.1" } as any,
    res: { clearCookie: () => {}, cookie: () => {} } as any,
  };
}
const caller = () => authRouter.createCaller(ctxAnonimo());

const CADASTRO = {
  name: "Invasor Qualquer",
  email: "carla@ramoslacerda.adv.br",
  password: "senha-do-invasor",
  whatsapp: "85997965706",
  aceitouTermos: true as const,
};
const CONTA_EXISTENTE = {
  id: 7,
  openId: "email-x",
  email: CADASTRO.email,
  name: "Carla Ramos",
  passwordHash: "hash-antigo-da-carla",
  emailVerificado: true,
};

/** Sem vínculo ativo em `colaboradores` = conta órfã. */
const semVinculoAtivo = () => { filas.colaboradores = [[]]; };

beforeEach(() => {
  capturado.inserts = [];
  capturado.updates = [];
  capturado.deletes = [];
  upsertUserMock.mockClear();
  enviarEmailConfirmacaoMock.mockClear();
  getUserByEmailMock.mockReset();
  getUserByEmailMock.mockResolvedValue(undefined);
  for (const k of Object.keys(filas)) delete filas[k];
});

describe("auth.signup — e-mail já cadastrado", () => {
  it("(1) confirmado e órfão: recusa com a dica do 'Esqueci a senha' e não apaga nada", async () => {
    getUserByEmailMock.mockResolvedValue({ ...CONTA_EXISTENTE, emailVerificado: true });
    semVinculoAtivo();

    await expect(caller().signup(CADASTRO)).rejects.toMatchObject({
      message: expect.stringContaining("Já existe uma conta com este e-mail"),
    });
    await expect(caller().signup(CADASTRO)).rejects.toMatchObject({
      message: expect.stringContaining("Esqueci a senha"),
    });

    expect(capturado.deletes).toEqual([]);
    expect(upsertUserMock).not.toHaveBeenCalled();
    expect(capturado.updates.filter((u) => u.table === "users")).toEqual([]);
    expect(enviarEmailConfirmacaoMock).not.toHaveBeenCalled();
  });

  it("(2) NÃO confirmado e órfão: nada apagado, senha intacta, confirmação reenviada, resposta igual à de cadastro novo", async () => {
    getUserByEmailMock.mockResolvedValue({ ...CONTA_EXISTENTE, emailVerificado: false });
    semVinculoAtivo();

    const r = await caller().signup(CADASTRO);

    expect(r).toEqual({ success: true, email: CADASTRO.email, name: CADASTRO.name, needsConfirmation: true });

    // Nenhuma linha apagada, nenhuma senha/nome/número gravado na conta que já existe.
    expect(capturado.deletes).toEqual([]);
    expect(upsertUserMock).not.toHaveBeenCalled();
    expect(capturado.updates.filter((u) => u.table === "users")).toEqual([]);
    expect(capturado.inserts.filter((i) => i.table === "users")).toEqual([]);
    expect(capturado.inserts.filter((i) => i.table === "aceites_termos")).toEqual([]);

    // Reenvio: tokens antigos invalidados, token novo pro user EXISTENTE, e-mail pro endereço dele.
    const invalidacao = capturado.updates.filter((u) => u.table === "email_confirmation_tokens");
    expect(invalidacao).toHaveLength(1);
    expect(invalidacao[0].set.usedAt).toBeInstanceOf(Date);
    const tokens = capturado.inserts.filter((i) => i.table === "email_confirmation_tokens");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].values.userId).toBe(CONTA_EXISTENTE.id);
    expect(enviarEmailConfirmacaoMock).toHaveBeenCalledTimes(1);
    expect(enviarEmailConfirmacaoMock.mock.calls[0][0]).toMatchObject({
      email: CADASTRO.email,
      nome: CONTA_EXISTENTE.name,
      token: tokens[0].values.token,
    });
  });

  it("(2b) a resposta do caso não confirmado não revela a conta: mesmas chaves e valores de um cadastro novo", async () => {
    getUserByEmailMock.mockResolvedValue({ ...CONTA_EXISTENTE, emailVerificado: false });
    semVinculoAtivo();
    const repetido = await caller().signup(CADASTRO);

    getUserByEmailMock.mockReset();
    getUserByEmailMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 99, openId: "email-y", email: CADASTRO.email, name: CADASTRO.name });
    const novo = await caller().signup(CADASTRO);

    expect(repetido).toEqual(novo);
  });

  it("NÃO confirmado mas com vínculo ativo: recusa como sempre, sem apagar", async () => {
    getUserByEmailMock.mockResolvedValue({ ...CONTA_EXISTENTE, emailVerificado: false });
    filas.colaboradores = [[{ id: 3 }]];

    await expect(caller().signup(CADASTRO)).rejects.toMatchObject({ message: MENSAGEM_EMAIL_JA_CADASTRADO });
    expect(capturado.deletes).toEqual([]);
    expect(upsertUserMock).not.toHaveBeenCalled();
  });

  it("(3) e-mail novo: cria a conta como antes e fica aguardando confirmação", async () => {
    getUserByEmailMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 99, openId: "email-y", email: CADASTRO.email, name: CADASTRO.name });

    const r = await caller().signup(CADASTRO);

    expect(r).toEqual({ success: true, email: CADASTRO.email, name: CADASTRO.name, needsConfirmation: true });
    expect(upsertUserMock).toHaveBeenCalledTimes(1);
    expect(upsertUserMock.mock.calls[0][0]).toMatchObject({ email: CADASTRO.email, passwordHash: "hash-novo", loginMethod: "email" });
    expect(capturado.inserts.filter((i) => i.table === "aceites_termos")).toHaveLength(1);
    const tokens = capturado.inserts.filter((i) => i.table === "email_confirmation_tokens");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].values.userId).toBe(99);
    expect(capturado.deletes).toEqual([]);
  });
});

describe("auth.ts — o caminho do cadastro não apaga linha nenhuma", () => {
  it("(4) não existe db.delete(users) nem db.delete(colaboradores) em auth.ts", () => {
    const fonte = ler("server/routers/auth.ts");
    expect(fonte).not.toMatch(/\.delete\(\s*users\s*\)/);
    expect(fonte).not.toMatch(/\.delete\(\s*colaboradores\s*\)/);
  });

  it("o cadastro repetido reaproveita o mesmo reenvio do 'Reenviar email'", () => {
    const fonte = ler("server/routers/auth.ts");
    expect(fonte.match(/reenviarEmailDeConfirmacao\(db,/g)?.length).toBe(2);
  });
});
