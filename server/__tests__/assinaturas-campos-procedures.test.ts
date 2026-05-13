/**
 * Testes — procedures de campos posicionais de assinatura (Fase 1 MVP).
 *
 * Cobre o gate (assinatura precisa ser do escritório) + replace-on-save
 * + bloqueio quando assinatura já foi finalizada (assinado/expirado/recusado).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

// Estado controlado pelos testes
const dbState = {
  // assinaturaId → { escritorioId, status }
  assinaturas: new Map<number, { id: number; escritorioId: number; status: string }>([
    [1, { id: 1, escritorioId: 10, status: "pendente" }],
    [2, { id: 2, escritorioId: 10, status: "assinado" }],
    [3, { id: 3, escritorioId: 999, status: "pendente" }], // outro escritório
  ]),
  // assinaturaId → campos[]
  campos: new Map<number, any[]>(),
  insertCount: 0,
  deleteCount: 0,
};

let currentTable: "assinaturas" | "campos" | "other" = "other";
let currentWhereAssinaturaId: number | null = null;
let currentEscritorioId = 10;

function makeQueryBuilder(): any {
  const builder: any = {
    from: (t: any) => {
      const name = (t?.[Symbol.for("drizzle:Name")] as string) || "";
      if (name === "assinaturas_digitais") currentTable = "assinaturas";
      else if (name === "assinatura_campos") currentTable = "campos";
      else currentTable = "other";
      return builder;
    },
    where: () => builder,
    orderBy: () => Promise.resolve(
      currentTable === "campos" && currentWhereAssinaturaId != null
        ? dbState.campos.get(currentWhereAssinaturaId) ?? []
        : [],
    ),
    limit: () => {
      if (currentTable === "assinaturas") {
        // Heurística: o teste seta currentWhereAssinaturaId antes.
        // Filtra pelo escritorioId que o getEscritorioPorUsuario retorna pra
        // simular o where(eq(id, X) AND eq(escritorioId, Y)) do backend.
        const a = currentWhereAssinaturaId != null ? dbState.assinaturas.get(currentWhereAssinaturaId) : null;
        if (a && a.escritorioId === currentEscritorioId) return Promise.resolve([a]);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    },
    then: (r: any) => r([]),
  };
  return builder;
}

function makeDb(): any {
  return {
    select: () => makeQueryBuilder(),
    insert: () => ({
      values: (vals: any) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        for (const v of arr) {
          if (v.assinaturaId != null) {
            const list = dbState.campos.get(v.assinaturaId) ?? [];
            list.push({ ...v, id: dbState.insertCount + 1 });
            dbState.campos.set(v.assinaturaId, list);
            dbState.insertCount++;
          }
        }
        return Promise.resolve([{ insertId: dbState.insertCount }]);
      },
    }),
    delete: () => ({
      where: () => {
        dbState.deleteCount++;
        // Limpa campos da assinatura "em jogo"
        if (currentWhereAssinaturaId != null) {
          dbState.campos.set(currentWhereAssinaturaId, []);
        }
        return Promise.resolve([{ affectedRows: 1 }]);
      },
    }),
    transaction: async (fn: any) => {
      // Stub simples — re-usa o mesmo db (sem isolation no mock)
      const tx = makeDb();
      return fn(tx);
    },
  };
}

const dbInstance = makeDb();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbInstance),
}));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async (userId: number) => ({
    escritorio: { id: userId === 100 ? currentEscritorioId : 999, nome: "Teste" },
    colaborador: { id: 1, cargo: "dono" },
  })),
}));

const { appRouter } = await import("../routers");

function fakeCtx(userId = 100): TrpcContext {
  return {
    user: {
      id: userId, openId: "x", email: "x@y.z", name: "X",
      loginMethod: "google", role: "user", asaasCustomerId: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

beforeEach(() => {
  dbState.campos.clear();
  dbState.insertCount = 0;
  dbState.deleteCount = 0;
  currentWhereAssinaturaId = null;
});

describe("assinaturas.salvarCampos — autorização", () => {
  it("rejeita salvar em assinatura de outro escritório", async () => {
    currentWhereAssinaturaId = 3; // pertence ao escritório 999
    const caller = appRouter.createCaller(fakeCtx(100)); // escritório 10
    await expect(
      caller.assinaturas.salvarCampos({
        assinaturaId: 3,
        campos: [{
          tipo: "ASSINATURA", pagina: 1, x: 100, y: 200,
          largura: 150, altura: 50, obrigatorio: true, signatarioIndex: 0,
        }],
      }),
    ).rejects.toThrow(/não encontrada|outro escrit/i);
    expect(dbState.insertCount).toBe(0);
  });

  it("rejeita salvar em assinatura já finalizada (status: assinado)", async () => {
    currentWhereAssinaturaId = 2; // status: assinado
    const caller = appRouter.createCaller(fakeCtx(100));
    await expect(
      caller.assinaturas.salvarCampos({
        assinaturaId: 2,
        campos: [{
          tipo: "ASSINATURA", pagina: 1, x: 100, y: 200,
          largura: 150, altura: 50, obrigatorio: true, signatarioIndex: 0,
        }],
      }),
    ).rejects.toThrow(/não é possível alterar|assinad/i);
    expect(dbState.insertCount).toBe(0);
  });

  it("aceita salvar em assinatura pendente do próprio escritório", async () => {
    currentWhereAssinaturaId = 1;
    const caller = appRouter.createCaller(fakeCtx(100));
    const result = await caller.assinaturas.salvarCampos({
      assinaturaId: 1,
      campos: [
        { tipo: "ASSINATURA", pagina: 1, x: 100, y: 200, largura: 150, altura: 50, obrigatorio: true, signatarioIndex: 0 },
        { tipo: "DATA", pagina: 1, x: 300, y: 200, largura: 100, altura: 20, obrigatorio: false, signatarioIndex: 0 },
      ],
    });
    expect(result).toEqual({ success: true, total: 2 });
    expect(dbState.insertCount).toBe(2);
    // Delete antes do insert (replace-on-save)
    expect(dbState.deleteCount).toBeGreaterThan(0);
  });

  it("aceita lista vazia (limpa todos os campos)", async () => {
    currentWhereAssinaturaId = 1;
    dbState.campos.set(1, [{ tipo: "ASSINATURA" }]); // simula existente
    const caller = appRouter.createCaller(fakeCtx(100));
    const result = await caller.assinaturas.salvarCampos({
      assinaturaId: 1,
      campos: [],
    });
    expect(result.total).toBe(0);
    expect(dbState.insertCount).toBe(0);
    expect(dbState.deleteCount).toBeGreaterThan(0);
  });
});

describe("assinaturas.listarCampos — gate de escritório", () => {
  it("retorna [] quando assinatura é de outro escritório", async () => {
    currentWhereAssinaturaId = 3;
    const caller = appRouter.createCaller(fakeCtx(100));
    const result = await caller.assinaturas.listarCampos({ assinaturaId: 3 });
    expect(result).toEqual([]);
  });

  it("retorna campos quando assinatura é do próprio escritório", async () => {
    currentWhereAssinaturaId = 1;
    dbState.campos.set(1, [
      { id: 1, tipo: "ASSINATURA", pagina: 1 } as any,
    ]);
    const caller = appRouter.createCaller(fakeCtx(100));
    const result = await caller.assinaturas.listarCampos({ assinaturaId: 1 });
    expect(result.length).toBe(1);
  });
});

describe("assinaturas.listarCamposPorToken — rota pública", () => {
  it("retorna [] quando token não bate", async () => {
    // Mock retorna [] quando consulta por token desconhecido
    currentWhereAssinaturaId = null;
    const caller = appRouter.createCaller(fakeCtx(100));
    const result = await caller.assinaturas.listarCamposPorToken({ token: "token-invalido-x".padEnd(20, "x") });
    expect(result).toEqual([]);
  });
});
