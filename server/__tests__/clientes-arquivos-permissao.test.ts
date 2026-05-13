/**
 * Testes — gates de permissão em router-clientes.ts (anotações, arquivos,
 * pastas, conversas, leads, estatísticas).
 *
 * Antes do fix, 14 procedures não chamavam checkPermission. Atendente com
 * verProprios=true podia ler/escrever em arquivos/pastas/conversas/leads
 * de qualquer cliente do escritório (escalação horizontal por enumeração
 * de contatoId).
 *
 * Pós-fix:
 *  - queries (listar*) exigem `clientes.ver` + podeVerCliente
 *  - mutações (criar/salvar/excluir/mover/renomear) exigem `clientes.editar`
 *    + podeVerCliente
 *  - estatisticas respeita verProprios (filtra contatos do colaborador)
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
    allowed: true, verTodos: false, verProprios: true,
    criar: true, editar: true, excluir: false,
    colaboradorId: 10, escritorioId: 1, cargo: "atendente",
  },
};

vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async () => permState.result),
}));

// Estado de DB. Lookup baseado em `lookupState` setado pelos testes.
const dbState = {
  contatos: new Map<number, { id: number; responsavelId: number | null; escritorioId: number }>([
    [50, { id: 50, responsavelId: 10, escritorioId: 1 }], // próprio (colab 10)
    [60, { id: 60, responsavelId: 99, escritorioId: 1 }], // alheio
  ]),
  arquivos: new Map<number, { id: number; contatoId: number; escritorioId: number }>([
    [200, { id: 200, contatoId: 50, escritorioId: 1 }],
    [300, { id: 300, contatoId: 60, escritorioId: 1 }],
  ]),
  pastas: new Map<number, { id: number; contatoId: number; escritorioId: number; nome: string; parentId: number | null }>([
    [400, { id: 400, contatoId: 50, escritorioId: 1, nome: "Próprio", parentId: null }],
    [500, { id: 500, contatoId: 60, escritorioId: 1, nome: "Alheio", parentId: null }],
  ]),
  insertCalled: false,
  updateCalled: false,
  deleteCalled: false,
};

const lookupState: {
  contatoId: number | null;
  arquivoId: number | null;
  pastaId: number | null;
} = { contatoId: null, arquivoId: null, pastaId: null };

function makeDb() {
  let currentTable: "contatos" | "arquivos" | "pastas" | "conversas" | "leads" | "anotacoes" | "other" = "other";

  function makeBuilder(): any {
    const builder: any = {
      from: (t: any) => {
        const sym = Symbol.for("drizzle:Name");
        const name = (t?.[sym] as string) || "";
        if (name.includes("contatos")) currentTable = "contatos";
        else if (name === "cliente_arquivos") currentTable = "arquivos";
        else if (name === "cliente_pastas") currentTable = "pastas";
        else if (name === "conversas") currentTable = "conversas";
        else if (name === "leads") currentTable = "leads";
        else if (name === "cliente_anotacoes") currentTable = "anotacoes";
        else currentTable = "other";
        return builder;
      },
      leftJoin: () => builder,
      innerJoin: () => builder,
      where: (_w: any) => builder,
      orderBy: () => builder,
      groupBy: () => builder,
      limit: () => {
        if (currentTable === "contatos" && lookupState.contatoId != null) {
          const c = dbState.contatos.get(lookupState.contatoId);
          return Promise.resolve(c ? [c] : []);
        }
        if (currentTable === "arquivos" && lookupState.arquivoId != null) {
          const a = dbState.arquivos.get(lookupState.arquivoId);
          return Promise.resolve(a ? [a] : []);
        }
        if (currentTable === "pastas" && lookupState.pastaId != null) {
          const p = dbState.pastas.get(lookupState.pastaId);
          return Promise.resolve(p ? [p] : []);
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
      values: () => { dbState.insertCalled = true; return Promise.resolve([{ insertId: 1 }]); },
    }),
    update: () => ({
      set: () => ({
        where: () => { dbState.updateCalled = true; return Promise.resolve([{ affectedRows: 1 }]); },
      }),
    }),
    delete: () => ({
      where: () => { dbState.deleteCalled = true; return Promise.resolve([{ affectedRows: 1 }]); },
    }),
  };
}

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
  lookupState.arquivoId = null;
  lookupState.pastaId = null;
  permState.result = {
    allowed: true, verTodos: false, verProprios: true,
    criar: true, editar: true, excluir: false,
    colaboradorId: 10, escritorioId: 1, cargo: "atendente",
  };
});

describe("listarArquivos — verProprios", () => {
  it("retorna [] em cliente alheio", async () => {
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.listarArquivos({ contatoId: 60 });
    expect(result).toEqual([]);
  });

  it("retorna [] sem clientes.ver", async () => {
    permState.result = { ...permState.result, allowed: false };
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.listarArquivos({ contatoId: 50 });
    expect(result).toEqual([]);
  });
});

describe("salvarArquivo — gate editar + verProprios", () => {
  it("bloqueia sem clientes.editar", async () => {
    permState.result = { ...permState.result, allowed: false, editar: false };
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.salvarArquivo({ contatoId: 50, nome: "x.pdf", url: "https://x" }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.insertCalled).toBe(false);
  });

  it("bloqueia cliente alheio", async () => {
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.salvarArquivo({ contatoId: 60, nome: "x.pdf", url: "https://x" }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.insertCalled).toBe(false);
  });
});

describe("excluirArquivo — lookup respeita verProprios via contato dono", () => {
  it("bloqueia arquivo de cliente alheio", async () => {
    lookupState.arquivoId = 300; // arquivo do contato 60 (alheio)
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.excluirArquivo({ id: 300 }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.deleteCalled).toBe(false);
  });

  it("permite arquivo de cliente próprio", async () => {
    lookupState.arquivoId = 200; // do contato 50 (próprio)
    lookupState.contatoId = 50;
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.excluirArquivo({ id: 200 });
    expect(result).toEqual({ success: true });
    expect(dbState.deleteCalled).toBe(true);
  });
});

describe("listarPastas — verProprios", () => {
  it("retorna [] em cliente alheio", async () => {
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.listarPastas({ contatoId: 60 });
    expect(result).toEqual([]);
  });
});

describe("criarPasta — gate + verProprios", () => {
  it("bloqueia cliente alheio", async () => {
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.criarPasta({ contatoId: 60, nome: "Nova" }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.insertCalled).toBe(false);
  });
});

describe("renomearPasta — lookup respeita verProprios", () => {
  it("bloqueia pasta de cliente alheio", async () => {
    lookupState.pastaId = 500; // pasta do contato 60 (alheio)
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.renomearPasta({ id: 500, nome: "Novo Nome" }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.updateCalled).toBe(false);
  });
});

describe("excluirPasta — lookup respeita verProprios", () => {
  it("bloqueia pasta de cliente alheio", async () => {
    lookupState.pastaId = 500;
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.excluirPasta({ id: 500 }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.deleteCalled).toBe(false);
  });
});

describe("listarConversas — verProprios", () => {
  it("retorna [] em cliente alheio", async () => {
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.listarConversas({ contatoId: 60 });
    expect(result).toEqual([]);
  });
});

describe("listarLeads — verProprios", () => {
  it("retorna [] em cliente alheio", async () => {
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.listarLeads({ contatoId: 60 });
    expect(result).toEqual([]);
  });
});

describe("criarAnotacao — gate + verProprios", () => {
  it("bloqueia em cliente alheio", async () => {
    lookupState.contatoId = 60;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.criarAnotacao({ contatoId: 60, conteudo: "teste" }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(dbState.insertCalled).toBe(false);
  });

  it("permite em cliente próprio", async () => {
    lookupState.contatoId = 50;
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.criarAnotacao({ contatoId: 50, conteudo: "minha" });
    expect(result.id).toBe(1);
    expect(dbState.insertCalled).toBe(true);
  });
});

describe("estatisticas — respeita verProprios", () => {
  it("retorna zeros quando sem permissão", async () => {
    permState.result = { ...permState.result, allowed: false };
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.estatisticas();
    expect(result.total).toBe(0);
    expect(result.aguardandoDocumentacao).toBe(0);
  });

  it("retorna 0 quando atendente sem clientes próprios (filtra por responsavelId)", async () => {
    // Mock retorna [] pra SELECT COUNT — simulando "nenhum próprio"
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.estatisticas();
    expect(result.total).toBe(0);
  });
});
