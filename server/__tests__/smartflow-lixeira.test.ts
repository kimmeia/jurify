/**
 * Lixeira do SmartFlow.
 *
 * O `deletar` fazia DELETE em smartflow_passos + smartflow_cenarios. A
 * lixeira do topo do editor tem o MESMO ícone da lixeira que remove um bloco,
 * dois cliques de distância — e quem errou o alvo perdeu o fluxo inteiro, sem
 * volta.
 *
 * As três propriedades que precisam continuar valendo:
 *  1. excluir não apaga linha nenhuma — marca `deletadoEm`;
 *  2. excluir DESLIGA o cenário. É isso, e não um filtro novo em cada query,
 *     que impede o motor de disparar um cenário na lixeira (todo carregador
 *     já filtra por `ativo`);
 *  3. o único DELETE que sobrou exige que o cenário já esteja na lixeira.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";

const getDbMock = vi.fn();
const checkPermissionMock = vi.fn();

vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  return { ...real, getDb: (...a: unknown[]) => (getDbMock as any)(...a) };
});

vi.mock("../escritorio/check-permission", () => ({
  checkPermission: (...a: unknown[]) => (checkPermissionMock as any)(...a),
}));

const { smartflowRouter } = await import("../smartflow/router-smartflow");

const PERM_TOTAL = {
  allowed: true,
  escritorioId: 3,
  colaboradorId: 9,
  verTodos: true,
  verProprios: false,
};

/** DB de mentira: registra updates/deletes e devolve a linha configurada. */
function fakeDb(linha: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = [];
  const deletes: string[] = [];
  const selectChain: any = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    orderBy: () => selectChain,
    where: () => ({
      limit: async () => (linha ? [linha] : []),
      orderBy: () => ({ limit: async () => (linha ? [linha] : []) }),
      then: (r: any) => Promise.resolve(linha ? [linha] : []).then(r),
    }),
  };
  const db = {
    select: () => selectChain,
    update: () => ({
      set: (valores: Record<string, unknown>) => ({
        where: async () => { updates.push(valores); },
      }),
    }),
    delete: (tabela: any) => ({
      where: async () => { deletes.push(String(tabela?._?.name ?? "?")); },
    }),
  };
  return { db, updates, deletes };
}

function ctx(): TrpcContext {
  return {
    user: { id: 5, openId: "u", role: "user" } as any,
    req: { protocol: "https", headers: {}, ip: "127.0.0.1" } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  checkPermissionMock.mockResolvedValue(PERM_TOTAL);
});

describe("smartflow.deletar — manda pra lixeira", () => {
  it("não roda DELETE: marca deletadoEm e desliga o cenário", async () => {
    const { db, updates, deletes } = fakeDb({ criadoPor: 5, deletadoEm: null });
    getDbMock.mockResolvedValue(db);

    const r = await smartflowRouter.createCaller(ctx()).deletar({ id: 12 });

    expect(r).toEqual({ success: true });
    expect(deletes).toEqual([]);
    expect(updates).toHaveLength(1);
    // Desligar é o que tira o cenário do alcance do motor.
    expect(updates[0]!.ativo).toBe(false);
    expect(updates[0]!.deletadoEm).toBeInstanceOf(Date);
  });
});

describe("cenário na lixeira não se edita nem se executa", () => {
  it("deletar de novo devolve NOT_FOUND", async () => {
    const { db } = fakeDb({ criadoPor: 5, deletadoEm: new Date() });
    getDbMock.mockResolvedValue(db);

    await expect(
      smartflowRouter.createCaller(ctx()).deletar({ id: 12 }),
    ).rejects.toThrow(/lixeira/i);
  });

  it("toggleAtivo não religa um cenário excluído", async () => {
    const { db, updates } = fakeDb({ criadoPor: 5, deletadoEm: new Date() });
    getDbMock.mockResolvedValue(db);

    await expect(
      smartflowRouter.createCaller(ctx()).toggleAtivo({ id: 12, ativo: true }),
    ).rejects.toThrow(TRPCError);
    expect(updates).toEqual([]);
  });
});

describe("smartflow.restaurar", () => {
  it("limpa deletadoEm e deixa o cenário DESLIGADO", async () => {
    const { db, updates } = fakeDb({ criadoPor: 5, deletadoEm: new Date() });
    getDbMock.mockResolvedValue(db);

    await smartflowRouter.createCaller(ctx()).restaurar({ id: 12 });

    expect(updates).toHaveLength(1);
    expect(updates[0]!.deletadoEm).toBeNull();
    // Religar é decisão consciente — restaurar não pode voltar disparando.
    expect(updates[0]!.ativo).toBeUndefined();
  });
});

describe("smartflow.excluirDefinitivo", () => {
  it("recusa cenário que ainda está na lista", async () => {
    const { db, deletes } = fakeDb({ criadoPor: 5, deletadoEm: null });
    getDbMock.mockResolvedValue(db);

    await expect(
      smartflowRouter.createCaller(ctx()).excluirDefinitivo({ id: 12 }),
    ).rejects.toThrow(/lixeira/i);
    expect(deletes).toEqual([]);
  });

  it("a partir da lixeira, apaga cenário e passos", async () => {
    const { db, deletes } = fakeDb({ criadoPor: 5, deletadoEm: new Date() });
    getDbMock.mockResolvedValue(db);

    await smartflowRouter.createCaller(ctx()).excluirDefinitivo({ id: 12 });

    expect(deletes).toHaveLength(2);
  });
});
