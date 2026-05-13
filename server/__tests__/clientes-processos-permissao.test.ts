/**
 * Testes — gates de permissão em `clienteProcessos.*`.
 *
 * Antes do fix, vincular/desvincular/atualizar/listarAnotacoes/criarAnotacao
 * checavam só `getEscritorioPorUsuario`. Atendente com verProprios podia
 * vincular processo a qualquer cliente do escritório, mesmo os que não
 * eram dele.
 *
 * Pós-fix:
 *  - todas mutações exigem `clientes.editar`
 *  - listarAnotacoes exige `clientes.ver`
 *  - todas validam `podeVerCliente` (respeita verProprios) via contatoId
 *    do processo
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

// ─── Mocks ──────────────────────────────────────────────────────────────────

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
    allowed: true, verTodos: false, verProprios: true,
    criar: true, editar: true, excluir: false,
    colaboradorId: 10, escritorioId: 1, cargo: "atendente",
  },
};

vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async () => permState.result),
}));

// Estado do banco controlado pelos testes
const dbState = {
  // Contato 50 pertence ao colab 10; contato 60 pertence ao colab 99
  contatos: new Map<number, { id: number; responsavelId: number | null; escritorioId: number }>([
    [50, { id: 50, responsavelId: 10, escritorioId: 1 }],
    [60, { id: 60, responsavelId: 99, escritorioId: 1 }],
  ]),
  // processoId → contatoId
  processos: new Map<number, { id: number; contatoId: number; escritorioId: number }>([
    [70, { id: 70, contatoId: 50, escritorioId: 1 }], // processo do contato 50
    [80, { id: 80, contatoId: 60, escritorioId: 1 }], // processo do contato 60 (alheio)
  ]),
  insertCalled: false,
  updateCalled: false,
  deleteCalled: false,
};

// Drizzle builder mock minimalista. Identifica a tabela pelo método chamado
// e devolve resultados conforme `dbState`.
function makeDb() {
  let currentTable: "contatos" | "processos" | "anotacoes" | "other" = "other";
  let whereContatoId: number | null = null;
  let whereProcessoId: number | null = null;

  function makeBuilder(opts: { rows?: any[] } = {}): any {
    const rows = opts.rows ?? [];
    const builder: any = {
      from: (t: any) => {
        const name = t?.[Symbol.for("drizzle:Name")] || t?._?.name || "";
        if (String(name).includes("contatos")) currentTable = "contatos";
        else if (String(name).includes("cliente_processos") && !String(name).includes("anotac")) currentTable = "processos";
        else if (String(name).includes("anotac")) currentTable = "anotacoes";
        else currentTable = "other";
        return builder;
      },
      leftJoin: () => builder,
      innerJoin: () => builder,
      where: (_w: any) => builder,
      orderBy: () => builder,
      groupBy: () => builder,
      limit: () => {
        // Lookup baseado no estado controlado pelos testes.
        // Como não conseguimos extrair o ID do WHERE facilmente sem
        // depender do internals do drizzle, usamos um "ID em jogo" setado
        // pelos testes via dbState.lookupContatoId / lookupProcessoId.
        if (currentTable === "contatos" && lookupState.contatoId != null) {
          const c = dbState.contatos.get(lookupState.contatoId);
          return Promise.resolve(c ? [c] : []);
        }
        if (currentTable === "processos" && lookupState.processoId != null) {
          const p = dbState.processos.get(lookupState.processoId);
          return Promise.resolve(p ? [p] : []);
        }
        return Promise.resolve(rows);
      },
      then: (resolve: (v: unknown) => unknown) => resolve(rows),
    };
    return builder;
  }

  return {
    select: () => makeBuilder(),
    insert: () => ({
      values: () => { dbState.insertCalled = true; return Promise.resolve([{ insertId: 1 }]); },
    }),
    update: () => ({
      set: () => ({ where: () => { dbState.updateCalled = true; return Promise.resolve([{ affectedRows: 1 }]); } }),
    }),
    delete: () => ({
      where: () => { dbState.deleteCalled = true; return Promise.resolve([{ affectedRows: 1 }]); },
    }),
  };
}

// Estado pra resolver "qual ID está sendo consultado". Os testes setam
// antes de chamar o caller (alternativa seria interceptar o where do
// drizzle, complexo de mais pra ROI dessas regressões).
const lookupState: { contatoId: number | null; processoId: number | null } = {
  contatoId: null, processoId: null,
};

const dbInstance = makeDb();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbInstance),
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
  dbState.insertCalled = false;
  dbState.updateCalled = false;
  dbState.deleteCalled = false;
  lookupState.contatoId = null;
  lookupState.processoId = null;
  permState.result = {
    allowed: true, verTodos: false, verProprios: true,
    criar: true, editar: true, excluir: false,
    colaboradorId: 10, escritorioId: 1, cargo: "atendente",
  };
});

describe("clienteProcessos.vincular — gate + verProprios", () => {
  it("bloqueia atendente sem clientes.editar", async () => {
    permState.result = { ...permState.result, allowed: false, editar: false };
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clienteProcessos.vincular({ contatoId: 50, apelido: "X" }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.insertCalled).toBe(false);
  });

  it("atendente com verProprios bloqueado em cliente alheio", async () => {
    lookupState.contatoId = 60; // contato do colab 99, não do logado (10)
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clienteProcessos.vincular({ contatoId: 60, apelido: "X" }),
    ).rejects.toThrow(/não encontrado/i);
    expect(dbState.insertCalled).toBe(false);
  });

  it("atendente em cliente próprio: permitido", async () => {
    lookupState.contatoId = 50; // do colab 10 (o logado)
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clienteProcessos.vincular({
      contatoId: 50, apelido: "Contrato A",
    });
    expect(result.id).toBe(1);
    expect(dbState.insertCalled).toBe(true);
  });

  it("dono com verTodos: permitido mesmo em cliente alheio", async () => {
    permState.result = { ...permState.result, verTodos: true };
    lookupState.contatoId = 60; // alheio, mas verTodos liga geral
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clienteProcessos.vincular({
      contatoId: 60, apelido: "X",
    });
    expect(result.id).toBe(1);
  });
});

describe("clienteProcessos.desvincular — gate + verProprios", () => {
  it("bloqueia processo de cliente alheio", async () => {
    lookupState.processoId = 80; // processo do contato 60 (alheio)
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clienteProcessos.desvincular({ id: 80 }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.deleteCalled).toBe(false);
  });

  it("permite processo de cliente próprio", async () => {
    lookupState.processoId = 70; // processo do contato 50 (próprio)
    lookupState.contatoId = 50;
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clienteProcessos.desvincular({ id: 70 });
    expect(result).toEqual({ success: true });
    expect(dbState.deleteCalled).toBe(true);
  });
});

describe("clienteProcessos.atualizar — gate + verProprios", () => {
  it("bloqueia processo de cliente alheio", async () => {
    lookupState.processoId = 80;
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clienteProcessos.atualizar({ id: 80, apelido: "novo" }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.updateCalled).toBe(false);
  });
});

describe("clienteProcessos.criarAnotacao — gate + verProprios", () => {
  it("bloqueia em processo de cliente alheio", async () => {
    lookupState.processoId = 80;
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clienteProcessos.criarAnotacao({ processoId: 80, conteudo: "teste" }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.insertCalled).toBe(false);
  });
});

describe("clienteProcessos.listarAnotacoes — gate + verProprios", () => {
  it("retorna [] em processo de cliente alheio (verProprios)", async () => {
    lookupState.processoId = 80;
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clienteProcessos.listarAnotacoes({ processoId: 80 });
    expect(result).toEqual([]);
  });

  it("retorna [] quando user não tem clientes.ver", async () => {
    permState.result = { ...permState.result, allowed: false, verTodos: false, verProprios: false };
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clienteProcessos.listarAnotacoes({ processoId: 70 });
    expect(result).toEqual([]);
  });
});
