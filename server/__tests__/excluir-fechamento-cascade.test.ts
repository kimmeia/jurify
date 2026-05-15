/**
 * Teste de regressão: cascade do `excluirFechamento` agora cobre despesa
 * vencida sem pagamento (antes só apagava 'pendente').
 *
 * Cenário: usuário fecha comissão → sistema cria despesa pendente
 * automática (vencimento ~5 dias depois). Usuário não paga, vencimento
 * passa, cron `atualizarStatusDespesasVencidas` transiciona pra 'vencido'.
 * Usuário decide excluir o fechamento.
 *
 * Antes: cascade exigia status='pendente' → despesa vencida ficava
 * órfã no caixa do escritório (fechamento já apagado, despesa não).
 *
 * Agora: cascade usa `valorPago = 0` — captura pendente E vencido sem
 * pagamento. Despesa parcial/paga continua preservada (já tem efeito
 * real no caixa).
 *
 * Validação direta da SQL via inspeção das chamadas mockadas.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const deleteCalls: Array<{ table: string }> = [];

function tableName(t: unknown): string {
  const anyT = t as any;
  return (
    anyT?._?.name ||
    anyT?.[Symbol.for("drizzle:Name")] ||
    "unknown"
  );
}

// Captura ordem das chamadas de delete pra validar cascade
const mockDb: any = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([
          { escritorioId: 1, despesaId: 99 },
        ]),
      }),
    }),
  }),
  delete: (table: any) => ({
    where: () => {
      deleteCalls.push({ table: tableName(table) });
      return Promise.resolve();
    },
  }),
};

vi.mock("../db", () => ({ getDb: vi.fn(async () => mockDb) }));
vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1 },
    colaborador: { id: 10, cargo: "dono" },
  })),
}));
vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async () => ({
    allowed: true,
    verTodos: true,
    verProprios: true,
    criar: true,
    editar: true,
    excluir: true,
    colaboradorId: 10,
    escritorioId: 1,
    cargo: "dono",
  })),
}));
vi.mock("../escritorio/db-comissoes", () => ({
  diagnosticarComissao: vi.fn(),
  fecharComissao: vi.fn(),
  FechamentoJaExisteError: class extends Error {},
  simularComissao: vi.fn(),
}));

const { comissoesRouter } = await import("../escritorio/router-comissoes");

beforeEach(() => {
  deleteCalls.length = 0;
});

describe("excluirFechamento — cascade de despesa", () => {
  it("dispara DELETE em despesas, comissoes_fechadas_itens e comissoes_fechadas (3 deletes)", async () => {
    const caller = comissoesRouter.createCaller({
      user: { id: 100 } as any,
      req: {} as any,
      res: {} as any,
    });

    await caller.excluirFechamento({ id: 42 });

    // 3 deletes esperados, em ordem:
    // 1. despesas (cascade da despesa automática quando valorPago=0)
    // 2. comissoes_fechadas_itens
    // 3. comissoes_fechadas
    expect(deleteCalls).toHaveLength(3);
    expect(deleteCalls[0].table).toBe("despesas");
    expect(deleteCalls[1].table).toBe("comissoes_fechadas_itens");
    expect(deleteCalls[2].table).toBe("comissoes_fechadas");
  });

  it("não dispara DELETE em despesas quando comissaoFechada.despesaId é null", async () => {
    // Substitui o mock SELECT pra retornar despesaId=null
    mockDb.select = () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ escritorioId: 1, despesaId: null }]),
        }),
      }),
    });

    const caller = comissoesRouter.createCaller({
      user: { id: 100 } as any,
      req: {} as any,
      res: {} as any,
    });

    await caller.excluirFechamento({ id: 42 });

    // Sem despesaId vinculado → só os 2 deletes do fechamento próprio
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls.map((c) => c.table)).toEqual([
      "comissoes_fechadas_itens",
      "comissoes_fechadas",
    ]);
  });
});
