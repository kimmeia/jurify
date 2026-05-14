/**
 * Testes — autoria de anotações de cliente (`excluirAnotacao`).
 *
 * Regra do CLAUDE.md: cliente_anotacoes podem ser excluídas só pelo
 * autor OU por quem tem `verTodos` (dono/gestor). Antes do fix,
 * `router-clientes.ts:excluirAnotacao` checava só `escritorioId`,
 * permitindo qualquer colaborador apagar anotação alheia.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";
import { TRPCError } from "@trpc/server";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockPerm = {
  result: {
    allowed: true,
    verTodos: false,
    verProprios: true,
    criar: true,
    editar: true,
    excluir: false,
    colaboradorId: 10,
    escritorioId: 1,
    cargo: "atendente",
  },
};

vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async () => mockPerm.result),
}));

// getDb retorna um stub configurável por teste
const dbState = {
  selectRow: null as { criadoPor: number } | null,
  deleteCalled: false,
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(dbState.selectRow ? [dbState.selectRow] : []),
        }),
      }),
    }),
    delete: () => ({
      where: () => {
        dbState.deleteCalled = true;
        return Promise.resolve([{ affectedRows: 1 }]);
      },
    }),
  })),
}));

// Outras dependências usadas por routers irmãos no appRouter
vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Escritorio Teste" },
    colaborador: { id: 10, cargo: "atendente" },
  })),
}));

// Import APÓS mocks
const { appRouter } = await import("../routers");

function fakeCtx(userId = 100): TrpcContext {
  return {
    user: {
      id: userId,
      openId: "openid-teste",
      email: "user@test.com",
      name: "User Teste",
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
  dbState.selectRow = null;
  dbState.deleteCalled = false;
  mockPerm.result = {
    allowed: true,
    verTodos: false,
    verProprios: true,
    criar: true,
    editar: true,
    excluir: false,
    colaboradorId: 10,
    escritorioId: 1,
    cargo: "atendente",
  };
});

describe("clientes.excluirAnotacao — controle de autoria", () => {
  it("autor pode excluir a própria anotação (criadoPor === colaboradorId)", async () => {
    // Anotação criada pelo colaborador 10 (mesmo da permissão)
    dbState.selectRow = { criadoPor: 10 };

    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.excluirAnotacao({ id: 42 });
    expect(result).toEqual({ success: true });
    expect(dbState.deleteCalled).toBe(true);
  });

  it("dono/gestor (verTodos) pode excluir anotação de outro colaborador", async () => {
    dbState.selectRow = { criadoPor: 99 }; // criada por outro
    mockPerm.result = { ...mockPerm.result, verTodos: true };

    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.excluirAnotacao({ id: 42 });
    expect(result).toEqual({ success: true });
    expect(dbState.deleteCalled).toBe(true);
  });

  it("atendente não-autor é bloqueado com FORBIDDEN", async () => {
    dbState.selectRow = { criadoPor: 99 }; // criada por outro colaborador
    // mockPerm.result já tem verTodos=false

    const caller = appRouter.createCaller(fakeCtx());
    await expect(caller.clientes.excluirAnotacao({ id: 42 })).rejects.toThrow(
      /só pode excluir anotações que você criou/i,
    );
    expect(dbState.deleteCalled).toBe(false);
  });

  it("retorna NOT_FOUND quando a anotação não pertence ao escritório", async () => {
    dbState.selectRow = null; // simulação de "não encontrada"

    const caller = appRouter.createCaller(fakeCtx());
    await expect(caller.clientes.excluirAnotacao({ id: 42 })).rejects.toThrow(
      TRPCError,
    );
    expect(dbState.deleteCalled).toBe(false);
  });

  it("bloqueia user sem permissão de editar clientes", async () => {
    mockPerm.result = { ...mockPerm.result, allowed: false, editar: false };

    const caller = appRouter.createCaller(fakeCtx());
    await expect(caller.clientes.excluirAnotacao({ id: 42 })).rejects.toThrow(
      /sem permissão/i,
    );
    expect(dbState.deleteCalled).toBe(false);
  });
});
