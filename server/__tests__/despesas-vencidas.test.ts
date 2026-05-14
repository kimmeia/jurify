/**
 * Testes de regressão do worker `atualizarStatusDespesasVencidas`.
 *
 * Antes desse worker, nenhum código setava despesas.status='vencido'.
 * O KPI "Vencido" em router-despesas.kpis somava só linhas com esse
 * status — e portanto sempre mostrava R$ 0,00 mesmo com despesas em
 * atraso. O bug era invisível: o card existia, o sistema só nunca
 * preenchia o estado correto.
 *
 * Esses testes travam:
 *  - Forward: pendente/parcial com vencimento passado → vencido
 *  - Reverse pra pendente: vencido + vencimento futuro + sem pagamento
 *  - Reverse pra parcial: vencido + vencimento futuro + com pagamento parcial
 *  - "pago" nunca é tocado (contas quitadas não voltam)
 *  - DB indisponível → retorna zeros sem crashar
 *
 * Como o worker faz 3 UPDATEs separados, capturamos cada operação no
 * mock e validamos: tipos de status setados, ordem das chamadas, e os
 * contadores retornados.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

interface UpdateCall {
  set: { status?: string };
  affectedRows: number;
}

let updateQueue: number[] = [];
let captured: UpdateCall[] = [];

function buildUpdateBuilder() {
  let nextSet: { status?: string } = {};
  const builder: any = {
    set: (data: any) => {
      nextSet = data;
      return builder;
    },
    where: () => {
      const affected = updateQueue.shift() ?? 0;
      captured.push({ set: nextSet, affectedRows: affected });
      return Promise.resolve([{ affectedRows: affected }]);
    },
  };
  return builder;
}

const mockDb = {
  update: vi.fn(() => buildUpdateBuilder()),
};

let dbAvailable = true;

vi.mock("../db", () => ({
  getDb: vi.fn(async () => (dbAvailable ? mockDb : null)),
}));

const { atualizarStatusDespesasVencidas } = await import(
  "../escritorio/despesas-vencidas"
);

beforeEach(() => {
  updateQueue = [];
  captured = [];
  dbAvailable = true;
  vi.clearAllMocks();
});

describe("atualizarStatusDespesasVencidas", () => {
  it("forward: marca pendentes/parciais vencidas como 'vencido'", async () => {
    updateQueue = [5, 0, 0]; // 5 forward, 0 reverse pendente, 0 reverse parcial

    const r = await atualizarStatusDespesasVencidas();

    expect(r).toEqual({
      marcadasVencidas: 5,
      desmarcadasParaPendente: 0,
      desmarcadasParaParcial: 0,
    });
    expect(captured[0].set.status).toBe("vencido");
  });

  it("reverse pra 'pendente': vencido com vencimento prorrogado e sem pagamento", async () => {
    updateQueue = [0, 3, 0]; // forward=0, reverse pendente=3, reverse parcial=0

    const r = await atualizarStatusDespesasVencidas();

    expect(r).toEqual({
      marcadasVencidas: 0,
      desmarcadasParaPendente: 3,
      desmarcadasParaParcial: 0,
    });
    expect(captured[1].set.status).toBe("pendente");
  });

  it("reverse pra 'parcial': vencido com vencimento prorrogado e pagamento parcial", async () => {
    updateQueue = [0, 0, 2];

    const r = await atualizarStatusDespesasVencidas();

    expect(r).toEqual({
      marcadasVencidas: 0,
      desmarcadasParaPendente: 0,
      desmarcadasParaParcial: 2,
    });
    expect(captured[2].set.status).toBe("parcial");
  });

  it("executa SEMPRE as 3 queries na ordem (forward → reverse pendente → reverse parcial)", async () => {
    updateQueue = [10, 4, 1];

    await atualizarStatusDespesasVencidas();

    expect(captured).toHaveLength(3);
    expect(captured[0].set.status).toBe("vencido");
    expect(captured[1].set.status).toBe("pendente");
    expect(captured[2].set.status).toBe("parcial");
  });

  it("status 'pago' nunca é tocado — nenhum SET status='pago' aparece", async () => {
    updateQueue = [7, 2, 3];

    await atualizarStatusDespesasVencidas();

    // Trava arquitetural: o worker não pode JAMAIS desfazer um pagamento.
    // Se alguém adicionar um 4º update com status='pago', esse teste quebra.
    const setouParaPago = captured.some((c) => c.set.status === "pago");
    expect(setouParaPago).toBe(false);
  });

  it("DB indisponível: retorna zeros sem crashar e SEM chamar update", async () => {
    dbAvailable = false;

    const r = await atualizarStatusDespesasVencidas();

    expect(r).toEqual({
      marcadasVencidas: 0,
      desmarcadasParaPendente: 0,
      desmarcadasParaParcial: 0,
    });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("idempotente: rodar 2x com nada pra fazer não muda nada", async () => {
    updateQueue = [0, 0, 0, 0, 0, 0]; // 3 + 3 zeros

    const r1 = await atualizarStatusDespesasVencidas();
    const r2 = await atualizarStatusDespesasVencidas();

    expect(r1).toEqual(r2);
    expect(r1).toEqual({
      marcadasVencidas: 0,
      desmarcadasParaPendente: 0,
      desmarcadasParaParcial: 0,
    });
  });
});
