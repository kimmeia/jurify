/**
 * Testes — gates de permissão `verProprios` em `clientes.atualizar` e
 * `clientes.excluir`.
 *
 * Antes do fix, ambas só verificavam `editar`/`excluir` + `escritorioId`.
 * Cargo personalizado com `editar=true` (ou `excluir=true`) + `verProprios=true`
 * (sem verTodos) conseguia operar em qualquer cliente do escritório só
 * passando o ID na input — escalação horizontal por enumeração.
 *
 * Pós-fix: ambas carregam o contato, validam `responsavelId === colaboradorId`
 * quando o user tem só verProprios (mesmo pattern do registrarFechamento).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

type PermResult = {
  allowed: boolean;
  verTodos: boolean;
  verProprios: boolean;
  criar: boolean;
  editar: boolean;
  excluir: boolean;
  colaboradorId: number;
  escritorioId: number;
  cargo: string;
};

const permState: { result: PermResult } = {
  result: {
    allowed: true,
    verTodos: false,
    verProprios: true,
    criar: true,
    editar: true,
    excluir: true,
    colaboradorId: 10,
    escritorioId: 1,
    cargo: "atendente",
  },
};

vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async () => permState.result),
}));

// Mapa controlado de contatos pra simular lookup por ID.
//  - 50 pertence ao colab 10 (próprio)
//  - 60 pertence ao colab 99 (alheio)
const dbState = {
  contatos: new Map<number, { id: number; responsavelId: number | null; escritorioId: number; telefone: string | null; telefonesAnteriores: string | null }>([
    [50, { id: 50, responsavelId: 10, escritorioId: 1, telefone: null, telefonesAnteriores: null }],
    [60, { id: 60, responsavelId: 99, escritorioId: 1, telefone: null, telefonesAnteriores: null }],
  ]),
  updateCalled: false,
  cascataCalled: false,
};

const lookupState: { contatoId: number | null } = { contatoId: null };

function makeDb() {
  let currentTable: "contatos" | "other" = "other";

  function makeBuilder(): any {
    const builder: any = {
      from: (t: any) => {
        const name = (t?.[Symbol.for("drizzle:Name")] as string) || "";
        currentTable = name.includes("contatos") ? "contatos" : "other";
        return builder;
      },
      leftJoin: () => builder,
      innerJoin: () => builder,
      where: () => builder,
      orderBy: () => builder,
      groupBy: () => builder,
      limit: () => {
        if (currentTable === "contatos" && lookupState.contatoId != null) {
          const c = dbState.contatos.get(lookupState.contatoId);
          return Promise.resolve(c ? [c] : []);
        }
        return Promise.resolve([]);
      },
      then: (resolve: (v: unknown) => unknown) => resolve([]),
    };
    return builder;
  }

  return {
    select: () => makeBuilder(),
    insert: () => ({
      values: () => Promise.resolve([{ insertId: 1 }]),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          dbState.updateCalled = true;
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve([{ affectedRows: 1 }]),
    }),
  };
}

const dbInstance = makeDb();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbInstance),
}));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc Teste", fusoHorario: "America/Sao_Paulo" },
    colaborador: { id: 10, cargo: "atendente" },
  })),
}));

// Stub do cascade — só queremos saber SE foi chamado, não a lógica interna.
vi.mock("../escritorio/excluir-cliente", () => ({
  excluirClienteEmCascata: vi.fn(async () => {
    dbState.cascataCalled = true;
    return {
      success: true,
      cobrancasCanceladas: 0,
      cobrancasFalhas: 0,
      conversasExcluidas: 0,
      mensagensExcluidas: 0,
      leadsExcluidos: 0,
      tarefasExcluidas: 0,
      anotacoesExcluidas: 0,
      arquivosExcluidos: 0,
      assinaturasExcluidas: 0,
    };
  }),
}));

// `reconciliarCobrancasOrfas` é chamado quando responsavelId muda. Stub.
vi.mock("../escritorio/db-financeiro", () => ({
  reconciliarCobrancasOrfas: vi.fn(async () => ({ atribuidas: 0 })),
}));

const { appRouter } = await import("../routers");

function fakeCtx(): TrpcContext {
  return {
    user: {
      id: 100,
      openId: "x",
      email: "x@y.z",
      name: "X",
      loginMethod: "google",
      role: "user",
      asaasCustomerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

beforeEach(() => {
  dbState.updateCalled = false;
  dbState.cascataCalled = false;
  lookupState.contatoId = null;
  permState.result = {
    allowed: true,
    verTodos: false,
    verProprios: true,
    criar: true,
    editar: true,
    excluir: true,
    colaboradorId: 10,
    escritorioId: 1,
    cargo: "atendente",
  };
});

describe("clientes.atualizar — gate verProprios", () => {
  it("bloqueia user com verProprios em cliente alheio", async () => {
    lookupState.contatoId = 60; // responsavelId = 99, não 10
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.atualizar({ id: 60, nome: "Hack" }),
    ).rejects.toThrow(/Sem permissão para editar este cliente/i);
    expect(dbState.updateCalled).toBe(false);
  });

  it("permite user com verProprios em cliente próprio", async () => {
    lookupState.contatoId = 50; // responsavelId = 10 = colaboradorId
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.atualizar({ id: 50, nome: "Próprio" });
    expect(result.success).toBe(true);
    expect(dbState.updateCalled).toBe(true);
  });

  it("permite user com verTodos em cliente alheio", async () => {
    permState.result = { ...permState.result, verTodos: true };
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.atualizar({ id: 60, nome: "Admin" });
    expect(result.success).toBe(true);
    expect(dbState.updateCalled).toBe(true);
  });

  it("404 quando o cliente não existe no escritório", async () => {
    lookupState.contatoId = null; // lookup retorna []
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.atualizar({ id: 999, nome: "Fantasma" }),
    ).rejects.toThrow(/Cliente não encontrado/i);
    expect(dbState.updateCalled).toBe(false);
  });

  it("bloqueia user sem clientes.editar", async () => {
    permState.result = { ...permState.result, allowed: false, editar: false };
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.atualizar({ id: 50, nome: "Nome Válido" }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.updateCalled).toBe(false);
  });
});

describe("clientes.excluir — gate verProprios", () => {
  it("bloqueia user com excluir+verProprios em cliente alheio", async () => {
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.excluir({ id: 60 }),
    ).rejects.toThrow(/Sem permissão para excluir este cliente/i);
    expect(dbState.cascataCalled).toBe(false);
  });

  it("permite user com excluir+verProprios em cliente próprio", async () => {
    lookupState.contatoId = 50;
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.excluir({ id: 50 });
    expect(result.success).toBe(true);
    expect(dbState.cascataCalled).toBe(true);
  });

  it("permite dono (verTodos) em cliente alheio", async () => {
    permState.result = { ...permState.result, verTodos: true };
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.excluir({ id: 60 });
    expect(result.success).toBe(true);
    expect(dbState.cascataCalled).toBe(true);
  });

  it("404 quando o cliente não existe no escritório", async () => {
    lookupState.contatoId = null;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.excluir({ id: 999 }),
    ).rejects.toThrow(/Cliente não encontrado/i);
    expect(dbState.cascataCalled).toBe(false);
  });

  it("bloqueia user sem clientes.excluir", async () => {
    permState.result = { ...permState.result, allowed: false, excluir: false };
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.excluir({ id: 50 }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.cascataCalled).toBe(false);
  });
});
