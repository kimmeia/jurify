/**
 * Testes — atomicidade do `excluirClienteEmCascata`.
 *
 * Antes do fix, cada step (asaas cobranças locais → conversas → leads →
 * tarefas → ...) tinha try/catch independente. Falha no meio deixava
 * dados parciais — cobranças deletadas + leads ainda existindo, por
 * exemplo. Sem rastreabilidade pra reverter.
 *
 * Pós-fix, steps 2-11 (cascade local) estão dentro de db.transaction.
 * Qualquer falha → rollback completo → função lança erro. Asaas (step 1,
 * externa) continua fora da transação por restrição prática.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Estado controlado pelos testes
const txState = {
  callbackInvoked: false,
  shouldThrow: false as false | { atStep: number },
  stepsExecutados: 0,
};

function makeStub() {
  let stepCounter = 0;

  const queryBuilder: any = {
    from: () => queryBuilder,
    where: () => queryBuilder,
    limit: () => Promise.resolve([{ id: 1, nome: "Cliente Teste" }]),
    then: (resolve: (v: unknown) => unknown) => resolve([{ id: 1, nome: "Cliente Teste" }]),
  };

  // Operações executadas dentro da transação contam steps
  const txOps = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
    delete: () => ({
      where: () => {
        stepCounter++;
        if (txState.shouldThrow && stepCounter === txState.shouldThrow.atStep) {
          return Promise.reject(new Error(`Falha simulada no step ${stepCounter}`));
        }
        txState.stepsExecutados = Math.max(txState.stepsExecutados, stepCounter);
        return Promise.resolve([{ affectedRows: 1 }]);
      },
    }),
  };

  const db = {
    select: () => queryBuilder,
    delete: () => ({
      where: () => Promise.resolve([{ affectedRows: 0 }]),
    }),
    transaction: async (fn: (tx: any) => Promise<any>) => {
      txState.callbackInvoked = true;
      stepCounter = 0;
      // Drizzle MySQL: throw dentro do callback dispara rollback e
      // re-lança o erro pra fora do db.transaction.
      return fn(txOps);
    },
  };

  return db;
}

const dbInstance = makeStub();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbInstance),
}));

// Asaas import dinâmico — devolve client null pra não tentar API externa
vi.mock("../integracoes/router-asaas", () => ({
  getAsaasClient: vi.fn(async () => null),
}));

const { excluirClienteEmCascata } = await import("../escritorio/excluir-cliente");

beforeEach(() => {
  txState.callbackInvoked = false;
  txState.shouldThrow = false;
  txState.stepsExecutados = 0;
});

describe("excluirClienteEmCascata — atomicidade", () => {
  it("envolve cascade local em db.transaction", async () => {
    const resultado = await excluirClienteEmCascata(1, 1);
    expect(txState.callbackInvoked).toBe(true);
    expect(resultado.success).toBe(true);
  });

  it("falha numa etapa da cascade re-lança e marca como rolled back", async () => {
    // Falha no step 3 (delete asaasClientes, depois da deleção de cobrancas)
    txState.shouldThrow = { atStep: 3 };

    await expect(excluirClienteEmCascata(1, 1)).rejects.toThrow(
      /Não foi possível excluir o cliente/i,
    );
    // Steps subsequentes não foram executados (rollback simbólico nesse
    // mock; drizzle real reverteria as queries 1-2 também).
    expect(txState.stepsExecutados).toBeLessThan(10);
  });

  it("lança erro quando cliente não pertence ao escritório", async () => {
    // Mocka select pra retornar [] (cliente não encontrado)
    const failDb = {
      ...dbInstance,
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
            then: (r: any) => r([]),
          }),
        }),
      }),
    };
    const mod = await import("../db");
    vi.mocked(mod.getDb).mockResolvedValueOnce(failDb as any);

    await expect(excluirClienteEmCascata(999, 1)).rejects.toThrow(
      /não encontrado/i,
    );
    expect(txState.callbackInvoked).toBe(false);
  });
});
