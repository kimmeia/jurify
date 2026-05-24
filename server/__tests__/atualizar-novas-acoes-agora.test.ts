/**
 * Regressão do fix #2 — `processos.atualizarNovasAcoesAgora` (botão
 * "Atualizar agora" por cliente monitorado).
 *
 * Antes, esta procedure tinha lógica inline DUPLICADA e inferior à do cron:
 * marcava TODA ação nova como não-lida (lido:false) e somava todas em
 * totalNovasAcoes, SEM os filtros de relevância (polo ativo, ajuizado antes
 * do cadastro, CNJ muito antigo). Resultado: clicar "Atualizar agora"
 * reintroduzia os falsos-positivos que o cron silenciava.
 *
 * Agora delega pra `pollarUmMonitoramentoNovasAcoes` (a MESMA função testada
 * do cron, com todos os filtros) e só mapeia o resultado pro contrato que o
 * frontend espera. Estes testes garantem a delegação + mapeamento e que NÃO
 * há mais INSERT direto de eventos aqui.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

// Mock do cron-monitoramento: controla pollarUmMonitoramentoNovasAcoes e
// fornece resolverDedupMovimentacao (importado estaticamente pelo router).
const pollarUmMonitoramentoNovasAcoes = vi.fn();
vi.mock("../processos/cron-monitoramento", () => ({
  pollarUmMonitoramentoNovasAcoes,
  resolverDedupMovimentacao: vi.fn(async () => ({ dedup: "x", jaConhecida: false })),
}));

// DB mock determinístico: 1º SELECT = monitoramento, 2º SELECT = re-leitura
// de cnjsConhecidos (pra cnjsTotal). Contador de INSERTs prova que a
// procedure NÃO insere eventos diretamente (responsabilidade do cron agora).
const dbState: { mon: Record<string, unknown> | undefined; cnjsConhecidos: string } = {
  mon: undefined,
  cnjsConhecidos: "[]",
};
let insertCount = 0;
function makeDb() {
  let selN = 0;
  const builder: any = {
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: async () => {
      selN++;
      if (selN === 1) return dbState.mon ? [dbState.mon] : [];
      return [{ cnjsConhecidos: dbState.cnjsConhecidos }];
    },
  };
  return {
    select: () => builder,
    insert: () => ({ values: () => { insertCount++; return Promise.resolve([{ insertId: 1 }]); } }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }) }),
  };
}
vi.mock("../db", () => ({ getDb: vi.fn(async () => makeDb()) }));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc Teste" },
    colaborador: { id: 10, cargo: "dono" },
  })),
}));

const { appRouter } = await import("../routers");

function fakeCtx(): TrpcContext {
  return {
    user: { id: 100, openId: "x", email: "x@y.z", name: "X" } as any,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

const MON = {
  id: 7,
  escritorioId: 1,
  criadoPor: 100,
  tipoMonitoramento: "novas_acoes",
  searchType: "cpf",
  searchKey: "12345678901",
  tribunal: "tjce",
  credencialId: 9,
  cnjsConhecidos: "[]",
  totalNovasAcoes: 0,
};

beforeEach(() => {
  dbState.mon = undefined;
  dbState.cnjsConhecidos = "[]";
  insertCount = 0;
  pollarUmMonitoramentoNovasAcoes.mockReset();
});

describe("processos.atualizarNovasAcoesAgora — delega pro cron (fix FP)", () => {
  it("mapeia detecções relevantes e NÃO insere eventos diretamente", async () => {
    dbState.mon = MON;
    dbState.cnjsConhecidos = JSON.stringify(["c1", "c2", "c3"]);
    pollarUmMonitoramentoNovasAcoes.mockResolvedValue({ ok: true, detectadas: 2, baseline: false });

    const caller = appRouter.createCaller(fakeCtx());
    const r: any = await caller.processos.atualizarNovasAcoesAgora({ monitoramentoId: 7 });

    // Delegou pra função do cron passando o monitoramento
    expect(pollarUmMonitoramentoNovasAcoes).toHaveBeenCalledTimes(1);
    expect(pollarUmMonitoramentoNovasAcoes.mock.calls[0][0]).toMatchObject({ id: 7 });

    // cnjsNovos reflete só as RELEVANTES (detectadas), não todas as novas
    expect(r).toMatchObject({ ok: true, cnjsNovos: 2, baseline: false, cnjsTotal: 3 });
    expect(typeof r.latenciaMs).toBe("number");

    // A procedure não insere eventos — isso é responsabilidade do cron agora
    expect(insertCount).toBe(0);
  });

  it("baseline (primeira execução) → cnjsNovos=0 e baseline=true", async () => {
    dbState.mon = MON;
    dbState.cnjsConhecidos = JSON.stringify(["c1", "c2"]);
    pollarUmMonitoramentoNovasAcoes.mockResolvedValue({ ok: true, detectadas: 0, baseline: true });

    const caller = appRouter.createCaller(fakeCtx());
    const r: any = await caller.processos.atualizarNovasAcoesAgora({ monitoramentoId: 7 });

    expect(r).toMatchObject({ ok: true, cnjsNovos: 0, baseline: true, cnjsTotal: 2 });
    expect(insertCount).toBe(0);
  });

  it("erro do cron (sessão/credencial) → { ok:false, mensagem }", async () => {
    dbState.mon = MON; // retorna antes de reler cnjsTotal
    pollarUmMonitoramentoNovasAcoes.mockResolvedValue({ ok: false, erro: "Sessão expirada" });

    const caller = appRouter.createCaller(fakeCtx());
    const r: any = await caller.processos.atualizarNovasAcoesAgora({ monitoramentoId: 7 });

    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/sess[aã]o expirada/i);
    expect(insertCount).toBe(0);
  });

  it("monitoramento inexistente → NOT_FOUND (não chama o cron)", async () => {
    dbState.mon = undefined; // SELECT do mon vazio
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.processos.atualizarNovasAcoesAgora({ monitoramentoId: 999 }),
    ).rejects.toThrow(/não encontrado/i);
    expect(pollarUmMonitoramentoNovasAcoes).not.toHaveBeenCalled();
  });
});
