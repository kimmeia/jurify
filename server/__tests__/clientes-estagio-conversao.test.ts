/**
 * Testes — conversão e filtro de estágio (Lead × Cliente) no router clientes.
 *
 * Cobre:
 *  - registrarFechamento: fechar contrato PROMOVE o contato a 'cliente'
 *    (gatilho de conversão aprovado) e cria o lead fechado_ganho.
 *  - definirEstagio: troca manual reversível, com gates de permissão
 *    (editar + verProprios).
 *  - listar: aceita o filtro `estagio` sem quebrar (smoke do contrato).
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
    verTodos: true,
    verProprios: false,
    criar: true,
    editar: true,
    excluir: true,
    colaboradorId: 10,
    escritorioId: 1,
    cargo: "dono",
  },
};

vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async () => permState.result),
  checkPermissionAdminOuMatriz: vi.fn(async () => permState.result),
}));

const captured = { updates: [] as { table: string; set: any }[], leadInserts: [] as any[] };
// Linhas devolvidas nos lookups por ID:
//  - contatoRow: registrarFechamento / podeVerCliente (select em contatos)
//  - leadRow: crm.atualizarLead resolve o contatoId do lead (select em leads)
const lookupState: { contatoRow: any; leadRow: any } = {
  contatoRow: { id: 50, responsavelId: 10 },
  leadRow: { contatoId: 50 },
};

function tableName(t: any): string {
  return (t?.[Symbol.for("drizzle:Name")] as string) || "";
}

function makeDb() {
  let table = "";
  function builder(): any {
    const b: any = {
      from: (t: any) => { table = tableName(t); return b; },
      innerJoin: () => b,
      leftJoin: () => b,
      where: () => b,
      orderBy: () => b,
      groupBy: () => b,
      offset: () => Promise.resolve([]),
      // limit() é terminal nos lookups por ID (`.limit(1)` awaitado direto)
      // MAS encadeia com `.offset()` na listagem. Devolvemos um híbrido:
      // thenable (resolve as linhas do lookup) + método offset (listagem).
      limit: () => {
        const rows = table.includes("leads")
          ? (lookupState.leadRow ? [lookupState.leadRow] : [])
          : table.includes("contatos")
            ? (lookupState.contatoRow ? [lookupState.contatoRow] : [])
            : table.includes("colaboradores")
              ? [{ id: 7 }]
              : [];
        return {
          then: (resolve: (v: unknown) => unknown) => resolve(rows),
          offset: () => Promise.resolve([]),
        };
      },
      then: (resolve: (v: unknown) => unknown) => resolve([]),
    };
    return b;
  }
  return {
    select: () => builder(),
    insert: (t: any) => ({
      values: (v: any) => {
        if (tableName(t).includes("leads")) captured.leadInserts.push(v);
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (t: any) => ({
      set: (s: any) => ({
        where: () => {
          captured.updates.push({ table: tableName(t), set: s });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
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
    colaborador: { id: 10, cargo: "dono" },
  })),
}));

const { appRouter } = await import("../routers");

function fakeCtx(): TrpcContext {
  return {
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X", loginMethod: "google",
      role: "user", asaasCustomerId: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

function contatoUpdates() {
  return captured.updates.filter((u) => u.table.includes("contatos"));
}

beforeEach(() => {
  captured.updates = [];
  captured.leadInserts = [];
  lookupState.contatoRow = { id: 50, responsavelId: 10 };
  lookupState.leadRow = { contatoId: 50 };
  permState.result = {
    allowed: true, verTodos: true, verProprios: false,
    criar: true, editar: true, excluir: true,
    colaboradorId: 10, escritorioId: 1, cargo: "dono",
  };
});

describe("clientes.registrarFechamento — promove a Cliente", () => {
  it("cria lead fechado_ganho E marca o contato como 'cliente'", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    const r = await caller.clientes.registrarFechamento({
      contatoId: 50,
      valorFechamento: "5000",
    });
    expect(r.leadId).toBeDefined();
    // criou o lead já ganho
    expect(captured.leadInserts).toHaveLength(1);
    expect(captured.leadInserts[0].etapaFunil).toBe("fechado_ganho");
    // promoveu o contato
    const ups = contatoUpdates();
    expect(ups.length).toBeGreaterThanOrEqual(1);
    expect(ups.some((u) => u.set.estagio === "cliente")).toBe(true);
  });

  it("bloqueia sem permissão de editar", async () => {
    permState.result = { ...permState.result, allowed: false, editar: false };
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.registrarFechamento({ contatoId: 50 }),
    ).rejects.toThrow(/Sem permissão/i);
    expect(contatoUpdates()).toHaveLength(0);
  });
});

describe("crm.atualizarLead — fechado_ganho promove a Cliente", () => {
  it("mover lead para fechado_ganho marca o contato como 'cliente'", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    await caller.crm.atualizarLead({ id: 1, etapaFunil: "fechado_ganho" });
    expect(contatoUpdates().some((u) => u.set.estagio === "cliente")).toBe(true);
  });

  it("mudar para etapa que NÃO é fechado_ganho não promove o contato", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    await caller.crm.atualizarLead({ id: 1, etapaFunil: "negociacao" });
    expect(contatoUpdates().some((u) => u.set.estagio === "cliente")).toBe(false);
  });
});

describe("clientes.definirEstagio — troca manual reversível", () => {
  it("marca como cliente (estágio explícito)", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    const r = await caller.clientes.definirEstagio({ contatoId: 50, estagio: "cliente" });
    expect(r.success).toBe(true);
    expect(r.estagio).toBe("cliente");
    const ups = contatoUpdates();
    expect(ups.some((u) => u.set.estagio === "cliente")).toBe(true);
  });

  it("volta para lead (conversão é reversível)", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    const r = await caller.clientes.definirEstagio({ contatoId: 50, estagio: "lead" });
    expect(r.estagio).toBe("lead");
    expect(contatoUpdates().some((u) => u.set.estagio === "lead")).toBe(true);
  });

  it("bloqueia user verProprios em cliente alheio", async () => {
    permState.result = { ...permState.result, verTodos: false, verProprios: true };
    lookupState.contatoRow = { id: 60, responsavelId: 99 }; // não é do colab 10
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.definirEstagio({ contatoId: 60, estagio: "cliente" }),
    ).rejects.toThrow(/não encontrado|permissão/i);
    expect(contatoUpdates()).toHaveLength(0);
  });

  it("permite user verProprios no próprio cliente", async () => {
    permState.result = { ...permState.result, verTodos: false, verProprios: true };
    lookupState.contatoRow = { id: 50, responsavelId: 10 }; // é do colab 10
    const caller = appRouter.createCaller(fakeCtx());
    const r = await caller.clientes.definirEstagio({ contatoId: 50, estagio: "cliente" });
    expect(r.success).toBe(true);
  });

  it("bloqueia sem permissão de editar", async () => {
    permState.result = { ...permState.result, allowed: false, editar: false };
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.definirEstagio({ contatoId: 50, estagio: "cliente" }),
    ).rejects.toThrow(/Sem permissão/i);
  });
});

describe("clientes.listar — filtro de estágio", () => {
  it("aceita estagio='lead' sem quebrar", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    const r = await caller.clientes.listar({ estagio: "lead" });
    expect(Array.isArray(r.clientes)).toBe(true);
  });

  it("aceita estagio='cliente' sem quebrar", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    const r = await caller.clientes.listar({ estagio: "cliente" });
    expect(Array.isArray(r.clientes)).toBe(true);
  });

  it("funciona sem estagio (backcompat: todos)", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    const r = await caller.clientes.listar({});
    expect(Array.isArray(r.clientes)).toBe(true);
  });
});
