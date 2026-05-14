/**
 * Testes — gates de permissão em `camposCliente.*`.
 *
 * Antes do fix, todas as procedures de `router-campos-cliente.ts`
 * (criar/editar/excluir/reordenar/listar) chamavam só `getEscritorioPorUsuario`.
 * Qualquer atendente conseguia mudar o schema de campos personalizados do
 * escritório (operação administrativa).
 *
 * Regra pós-fix:
 *  - `listar` exige `clientes.ver` (atendente/estagiário precisam ver os
 *    campos quando editam um cliente)
 *  - mutações (`criar`, `editar`, `excluir`, `reordenar`) exigem
 *    `configuracoes.editar` (admin = dono/gestor com flag)
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

const permState: { byModule: Record<string, PermResult> } = { byModule: {} };

function setPerm(modulo: string, acao: string, allowed: boolean) {
  permState.byModule[`${modulo}:${acao}`] = {
    allowed,
    verTodos: allowed,
    verProprios: allowed,
    criar: allowed,
    editar: allowed,
    excluir: allowed,
    colaboradorId: 10,
    escritorioId: 1,
    cargo: "atendente",
  };
}

vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async (_userId: number, modulo: string, acao: string) => {
    return (
      permState.byModule[`${modulo}:${acao}`] ?? {
        allowed: false,
        verTodos: false,
        verProprios: false,
        criar: false,
        editar: false,
        excluir: false,
        colaboradorId: 10,
        escritorioId: 1,
        cargo: "atendente",
      }
    );
  }),
}));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc Teste" },
    colaborador: { id: 10, cargo: "atendente" },
  })),
}));

// Stub mínimo do db — suficiente para os caminhos não-bloqueados não falharem.
// O builder do drizzle é thenable (await query funciona). Replicamos isso
// com `then` no objeto retornado pelas operações terminais (where/orderBy).
function makeSelectBuilder(): any {
  const builder: any = {
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => Promise.resolve([]),
    then: (resolve: (v: unknown) => unknown) => resolve([]),
  };
  return builder;
}
const dbStub = {
  select: () => makeSelectBuilder(),
  insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
  update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }) }),
  delete: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbStub),
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
  permState.byModule = {};
});

describe("camposCliente.listar — gate clientes.ver", () => {
  it("retorna [] quando colaborador não tem clientes.ver", async () => {
    setPerm("clientes", "ver", false);
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.camposCliente.listar();
    expect(result).toEqual([]);
  });

  it("permite quando colaborador tem clientes.ver (atendente vê os campos no formulário)", async () => {
    setPerm("clientes", "ver", true);
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.camposCliente.listar();
    expect(result).toEqual([]); // db retorna vazio, mas não deu throw
  });
});

describe("camposCliente.criar — gate configuracoes.editar", () => {
  it("bloqueia atendente sem configuracoes.editar", async () => {
    setPerm("configuracoes", "editar", false);
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.camposCliente.criar({
        chave: "x", label: "X", tipo: "texto",
        obrigatorio: false, mostrarCadastro: true, ordem: 0,
      }),
    ).rejects.toThrow(/Apenas dono\/gestor/i);
  });

  it("permite admin com configuracoes.editar", async () => {
    setPerm("configuracoes", "editar", true);
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.camposCliente.criar({
      chave: "novo", label: "Novo", tipo: "texto",
      obrigatorio: false, mostrarCadastro: true, ordem: 0,
    });
    expect(result).toHaveProperty("id");
  });
});

describe("camposCliente.editar — gate configuracoes.editar", () => {
  it("bloqueia atendente", async () => {
    setPerm("configuracoes", "editar", false);
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.camposCliente.editar({ id: 1, label: "X" }),
    ).rejects.toThrow(/Apenas dono\/gestor/i);
  });
});

describe("camposCliente.excluir — gate configuracoes.editar", () => {
  it("bloqueia atendente", async () => {
    setPerm("configuracoes", "editar", false);
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.camposCliente.excluir({ id: 1 }),
    ).rejects.toThrow(/Apenas dono\/gestor/i);
  });
});

describe("camposCliente.reordenar — gate configuracoes.editar", () => {
  it("bloqueia atendente", async () => {
    setPerm("configuracoes", "editar", false);
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.camposCliente.reordenar({ ids: [1, 2, 3] }),
    ).rejects.toThrow(/Apenas dono\/gestor/i);
  });
});
