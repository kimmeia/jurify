/**
 * Testes do parâmetro `diasHistorico` em `syncCobrancasDeCliente`.
 *
 * Contexto: o cron `syncAsaas` em `cron-jobs.ts` mudou de 10min × 90 dias
 * para 24h × 1 dia. Como webhook é a fonte primária de eventos novos,
 * este cron passou a ser só catch-up de coisa que o webhook perdeu.
 *
 * O parâmetro `diasHistorico` controla a janela:
 *   - `1` (cron diário, novo padrão): usa `listarCobrancasPorJanela`
 *     com `dateCreatedGe` = ontem
 *   - `90` (default, compat): mesma chamada com janela maior
 *   - `null` (sync inicial/histórico completo): usa `listarCobrancas`
 *     SEM filtro de data
 *
 * Esses testes travam a propagação correta do parâmetro pelo client
 * Asaas. Sem isso, uma regressão futura faria o cron diário voltar a
 * varrer 90 dias e consumir cota desnecessariamente.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock leve do getDb (zero rows pra desabilitar cleanup de órfãs) ────────
const mockDb = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve([]),
    }),
  }),
  insert: () => ({
    values: () => ({
      onDuplicateKeyUpdate: () => Promise.resolve([{ affectedRows: 1 }]),
    }),
  }),
  update: () => ({
    set: () => ({ where: () => Promise.resolve() }),
  }),
  delete: () => ({ where: () => Promise.resolve() }),
};
vi.mock("../db", () => ({ getDb: vi.fn(async () => mockDb) }));

// Mock leve do inferirAtendentePorCobranca pra não bater no DB
vi.mock("../escritorio/db-financeiro", () => ({
  inferirAtendentePorCobranca: vi.fn(async () => null),
}));

const { syncCobrancasDeCliente } = await import("../integracoes/asaas-sync");

// ─── Fake client ────────────────────────────────────────────────────────────

interface FakeClient {
  listarCobrancas: ReturnType<typeof vi.fn>;
  listarCobrancasPorJanela: ReturnType<typeof vi.fn>;
}

function fakeClient(): FakeClient {
  const emptyPage = {
    data: [],
    hasMore: false,
    limit: 100,
    offset: 0,
  };
  return {
    listarCobrancas: vi.fn(async () => emptyPage),
    listarCobrancasPorJanela: vi.fn(async () => emptyPage),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Hoje fixo: 2026-05-13T12:00:00Z
  vi.setSystemTime(new Date("2026-05-13T12:00:00Z"));
});

describe("syncCobrancasDeCliente — propagação de diasHistorico", () => {
  it("diasHistorico=1 (cron diário): chama listarCobrancasPorJanela com dateCreatedGe=ontem", async () => {
    const client = fakeClient();

    await syncCobrancasDeCliente(client as any, 1, 10, "cus_X", {
      diasHistorico: 1,
    });

    expect(client.listarCobrancasPorJanela).toHaveBeenCalledTimes(1);
    expect(client.listarCobrancas).not.toHaveBeenCalled();
    const args = client.listarCobrancasPorJanela.mock.calls[0][0];
    expect(args.dateCreatedGe).toBe("2026-05-12"); // hoje-1 dia
    expect(args.customer).toBe("cus_X");
  });

  it("diasHistorico=90 (default): janela de 90 dias atrás", async () => {
    const client = fakeClient();

    await syncCobrancasDeCliente(client as any, 1, 10, "cus_X");

    expect(client.listarCobrancasPorJanela).toHaveBeenCalledTimes(1);
    expect(client.listarCobrancas).not.toHaveBeenCalled();
    const args = client.listarCobrancasPorJanela.mock.calls[0][0];
    // 2026-05-13 - 90 dias = 2026-02-12
    expect(args.dateCreatedGe).toBe("2026-02-12");
  });

  it("diasHistorico=null (importar tudo): usa listarCobrancas SEM filtro de data", async () => {
    const client = fakeClient();

    await syncCobrancasDeCliente(client as any, 1, 10, "cus_X", {
      diasHistorico: null,
    });

    expect(client.listarCobrancas).toHaveBeenCalledTimes(1);
    expect(client.listarCobrancasPorJanela).not.toHaveBeenCalled();
    const args = client.listarCobrancas.mock.calls[0][0];
    expect(args.customer).toBe("cus_X");
    expect(args.dateCreatedGe).toBeUndefined();
  });

  it("diasHistorico=30 (caso intermediário): janela de 30 dias", async () => {
    const client = fakeClient();

    await syncCobrancasDeCliente(client as any, 1, 10, "cus_X", {
      diasHistorico: 30,
    });

    const args = client.listarCobrancasPorJanela.mock.calls[0][0];
    // 2026-05-13 - 30 dias = 2026-04-13
    expect(args.dateCreatedGe).toBe("2026-04-13");
  });
});
