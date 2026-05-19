/**
 * Tests — `processos.consultarDocumento` (busca por CPF/CNPJ).
 *
 * Procedure adicionada no fix do bug em que o frontend chamava uma
 * procedure que não existia (`trpc.processos.consultarDocumento`) e a
 * busca por CPF/CNPJ na aba Consultar falhava com erro tRPC genérico.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

// ─── Mocks de motor-proprio-runner ──────────────────────────────────────────
const iniciarConsultaDocumentoMotorProprio = vi.fn(() => ({
  requestId: "motor:tjce:doc:fake-uuid",
  status: "running" as const,
}));
vi.mock("../processos/motor-proprio-runner", () => ({
  ehRequestMotorProprio: vi.fn(() => true),
  iniciarConsultaMotorProprio: vi.fn(() => ({ requestId: "motor:tjce:fake", status: "running" })),
  iniciarConsultaDocumentoMotorProprio,
  obterStatusMotorProprio: vi.fn(),
  obterResultadoMotorProprio: vi.fn(),
}));

// ─── Mock cofre helper (recuperação de sessão) ──────────────────────────────
const recuperarSessao = vi.fn();
vi.mock("../escritorio/cofre-helpers", () => ({
  recuperarSessao,
}));

// ─── Mock consumirCreditos ──────────────────────────────────────────────────
const consumirCreditosEscritorio = vi.fn();
vi.mock("../billing/escritorio-creditos", () => ({
  consumirCreditosEscritorio,
  getSaldoEscritorio: vi.fn(async () => ({
    saldo: 100, totalConsumido: 0, totalComprado: 100, cotaMensal: 0, ultimoReset: null,
  })),
}));

// ─── Mock DB ────────────────────────────────────────────────────────────────
const dbState = {
  credenciais: [] as Array<{
    id: number; escritorioId: number; sistema: string; status: string; apelido: string;
  }>,
};

function makeDb() {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: async (_n: number) => dbState.credenciais.slice(0, _n),
    orderBy: () => builder,
    then: (resolve: any) => resolve(dbState.credenciais),
  } as any;

  return {
    select: () => builder,
    insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
}

vi.mock("../db", () => ({
  getDb: vi.fn(async () => makeDb()),
}));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc Teste" },
    colaborador: { id: 10, cargo: "atendente" },
  })),
}));

const { appRouter } = await import("../routers");

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

beforeEach(() => {
  dbState.credenciais = [];
  iniciarConsultaDocumentoMotorProprio.mockClear();
  recuperarSessao.mockReset();
  consumirCreditosEscritorio.mockReset();
});

describe("processos.consultarDocumento — validação de input", () => {
  it("rejeita CPF com menos de 11 dígitos", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.processos.consultarDocumento({ tipo: "cpf", valor: "123" }),
    ).rejects.toThrow();
  });

  it("rejeita CPF com 12 dígitos (limpo)", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.processos.consultarDocumento({ tipo: "cpf", valor: "123456789012" }),
    ).rejects.toThrow(/11 dígitos/i);
  });

  it("rejeita CNPJ com 13 dígitos (limpo)", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.processos.consultarDocumento({ tipo: "cnpj", valor: "1234567890123" }),
    ).rejects.toThrow(/14 dígitos/i);
  });
});

describe("processos.consultarDocumento — credencial", () => {
  it("erro PRECONDITION_FAILED quando não tem credencial ativa", async () => {
    dbState.credenciais = []; // sem credenciais
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.processos.consultarDocumento({ tipo: "cpf", valor: "12345678901" }),
    ).rejects.toThrow(/Cadastre sua credencial OAB/i);
  });

  it("erro quando credencial existe mas sistema não é suportado", async () => {
    dbState.credenciais = [
      { id: 1, escritorioId: 1, sistema: "pje_tjsp", status: "ativa", apelido: "OAB SP" },
    ];
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.processos.consultarDocumento({ tipo: "cpf", valor: "12345678901" }),
    ).rejects.toThrow();
  });

  it("erro quando sessão não pode ser recuperada (expirada)", async () => {
    dbState.credenciais = [
      { id: 1, escritorioId: 1, sistema: "pje_tjce", status: "ativa", apelido: "OAB CE" },
    ];
    recuperarSessao.mockResolvedValue(null); // sessão expirou
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.processos.consultarDocumento({ tipo: "cpf", valor: "12345678901" }),
    ).rejects.toThrow(/expirou|renovar/i);
  });
});

describe("processos.consultarDocumento — sucesso", () => {
  it("cobra crédito, inicia consulta e retorna requestId", async () => {
    dbState.credenciais = [
      { id: 1, escritorioId: 1, sistema: "pje_tjce", status: "ativa", apelido: "OAB CE" },
    ];
    recuperarSessao.mockResolvedValue("storage-state-json");
    consumirCreditosEscritorio.mockResolvedValue(undefined);

    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.processos.consultarDocumento({
      tipo: "cpf",
      valor: "123.456.789-01",
    });

    expect(result.requestId).toMatch(/^motor:/);
    expect(result.status).toBe("running");

    // Limpou máscara antes de passar ao adapter + passa credencialId
    // (5º arg, opcional) pro runner conseguir marcar credencial como
    // expirada se o scrape falhar por sessão caída.
    expect(iniciarConsultaDocumentoMotorProprio).toHaveBeenCalledWith(
      "cpf",
      "12345678901",
      "storage-state-json",
      "tjce",
      expect.any(Number),
    );

    // Cobrou exatamente 3 créditos (CUSTOS.consulta_documento)
    expect(consumirCreditosEscritorio).toHaveBeenCalledWith(
      1, // escritorioId
      100, // userId
      3, // CUSTOS.consulta_documento
      "consulta_documento",
      expect.stringContaining("CPF"),
    );
  });

  it("aceita CNPJ com 14 dígitos", async () => {
    dbState.credenciais = [
      { id: 1, escritorioId: 1, sistema: "pje_tjce", status: "ativa", apelido: "OAB CE" },
    ];
    recuperarSessao.mockResolvedValue("storage-state-json");

    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.processos.consultarDocumento({
      tipo: "cnpj",
      valor: "12.345.678/0001-90",
    });

    expect(result.requestId).toMatch(/^motor:/);
    expect(iniciarConsultaDocumentoMotorProprio).toHaveBeenCalledWith(
      "cnpj",
      "12345678000190",
      "storage-state-json",
      "tjce",
      expect.any(Number),
    );
  });

  it("usa credencial específica quando credencialId é informado", async () => {
    dbState.credenciais = [
      { id: 5, escritorioId: 1, sistema: "pje_tjce", status: "ativa", apelido: "OAB CE específica" },
    ];
    recuperarSessao.mockResolvedValue("storage-state-json");

    const caller = appRouter.createCaller(fakeCtx());
    await caller.processos.consultarDocumento({
      tipo: "cpf",
      valor: "12345678901",
      credencialId: 5,
    });

    // 2º arg `{ tentarRelogin: true }` faz auto-recovery se sessão caiu.
    expect(recuperarSessao).toHaveBeenCalledWith(5, { tentarRelogin: true });
  });
});
