/**
 * Testes de regressão — bug #6: persistência de status em emails do Resend.
 *
 * Antes: erros em `enviarEmail` viviam só no logger e no response —
 * somiam quando o caller fazia fire-and-forget (boas-vindas em
 * auth.ts:246 usa `.then(...)` sem `await`). Admin não tinha histórico
 * pra auditar nem como reenviar.
 *
 * Contrato novo:
 *  - TODO envio (sucesso ou falha) gera 1 row em `email_log`
 *  - Falha de fetch, status !=200, e API key ausente são todos cobertos
 *  - Log é best-effort: erro de DB no insert NÃO propaga (caller
 *    original recebe a resposta normal)
 *  - Wrappers passam `tipo` correto pra UI poder filtrar
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const insertCalls: any[] = [];
let insertShouldThrow: Error | null = null;
let dbAvailable = true;

const mockDb = {
  insert: vi.fn(() => ({
    values: (vals: any) => {
      insertCalls.push(vals);
      if (insertShouldThrow) return Promise.reject(insertShouldThrow);
      // MySQL retorna [{ insertId, ... }] após insert
      return Promise.resolve([{ insertId: insertCalls.length }]);
    },
  })),
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([]), // sem chave no DB → cai no ENV
      }),
    }),
  }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => (dbAvailable ? mockDb : null)),
}));

// fetch global mockado
const fetchMock = vi.fn();
beforeEach(() => {
  insertCalls.length = 0;
  insertShouldThrow = null;
  dbAvailable = true;
  fetchMock.mockReset();
  // @ts-expect-error redefining global
  global.fetch = fetchMock;
  process.env.RESEND_API_KEY = "re_test_123";
  vi.clearAllMocks();
});

const { enviarEmail, enviarEmailConvite, enviarEmailRedefinirSenha, enviarEmailBoasVindas } =
  await import("../_core/email");

describe("enviarEmail — persistência de log", () => {
  it("sucesso: insere row com status='sucesso' e devolve logId", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "re_msg_abc" }),
    });

    const r = await enviarEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      text: "hi",
      tipo: "outro",
    });

    expect(r.success).toBe(true);
    expect(r.logId).toBe(1);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      tipo: "outro",
      destinatario: "user@example.com",
      assunto: "Test",
      status: "sucesso",
    });
    expect(insertCalls[0].erro).toBeNull();
    // contextoJson preserva html+text pra reenvio
    const ctx = JSON.parse(insertCalls[0].contextoJson);
    expect(ctx.html).toBe("<p>hi</p>");
    expect(ctx.text).toBe("hi");
  });

  it("falha HTTP não-2xx: grava status='falha' com erro do Resend", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Domain not verified",
    });

    const r = await enviarEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      tipo: "boas_vindas",
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/422/);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].status).toBe("falha");
    expect(insertCalls[0].erro).toMatch(/422/);
    expect(insertCalls[0].erro).toMatch(/Domain not verified/);
    expect(insertCalls[0].tipo).toBe("boas_vindas");
  });

  it("network error: grava status='falha' com mensagem do fetch", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const r = await enviarEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      tipo: "redefinir_senha",
    });

    expect(r.success).toBe(false);
    expect(insertCalls[0].status).toBe("falha");
    expect(insertCalls[0].erro).toMatch(/ECONNREFUSED/);
  });

  it("API key ausente: NÃO faz fetch mas grava log de falha", async () => {
    process.env.RESEND_API_KEY = "";

    const r = await enviarEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      tipo: "boas_vindas",
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/não configurado/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].status).toBe("falha");
  });

  it("log best-effort: DB indisponível NÃO crasha o envio", async () => {
    dbAvailable = false;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "x" }) });

    const r = await enviarEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    // Email foi entregue mesmo sem log
    expect(r.success).toBe(true);
    expect(r.logId).toBeNull();
    expect(insertCalls).toHaveLength(0);
  });

  it("log best-effort: INSERT que falha NÃO propaga erro pro caller", async () => {
    insertShouldThrow = new Error("Duplicate entry for foo");
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "x" }) });

    const r = await enviarEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    // Caller ainda recebe success=true — log falhou mas email foi entregue
    expect(r.success).toBe(true);
    expect(r.logId).toBeNull();
  });

  it("escritorioId e userId passam pro log pra rastreio", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "x" }) });

    await enviarEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      tipo: "convite_colaborador",
      escritorioId: 42,
      userId: 99,
    });

    expect(insertCalls[0]).toMatchObject({
      escritorioId: 42,
      userId: 99,
      tipo: "convite_colaborador",
    });
  });

  it("erro com mensagem >1024 chars é truncado pra caber na coluna VARCHAR(1024)", async () => {
    const longMsg = "x".repeat(2000);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => longMsg,
    });

    await enviarEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    expect(insertCalls[0].erro.length).toBeLessThanOrEqual(1024);
  });
});

describe("Wrappers (boas-vindas, redefinir, convite): tipo correto no log", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "x" }) });
  });

  it("enviarEmailBoasVindas → tipo='boas_vindas'", async () => {
    await enviarEmailBoasVindas({ email: "a@b.com", nome: "Ana" });
    expect(insertCalls[0].tipo).toBe("boas_vindas");
  });

  it("enviarEmailRedefinirSenha → tipo='redefinir_senha'", async () => {
    await enviarEmailRedefinirSenha({ email: "a@b.com", nome: "Ana", token: "t1" });
    expect(insertCalls[0].tipo).toBe("redefinir_senha");
  });

  it("enviarEmailConvite → tipo='convite_colaborador'", async () => {
    await enviarEmailConvite({
      email: "a@b.com",
      nomeEscritorio: "Escritório X",
      cargo: "Gestor",
      token: "t1",
      convidadoPor: "Dono",
    });
    expect(insertCalls[0].tipo).toBe("convite_colaborador");
  });
});
