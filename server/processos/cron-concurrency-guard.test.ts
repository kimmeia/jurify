/**
 * Regressão do fix #4 — guarda de concorrência dos polls do motor.
 *
 * O cron dispara via setInterval(60min) sem lock. Se um ciclo demora mais que
 * o intervalo (plausível com Playwright + muitos monitoramentos), o próximo
 * tick iniciava EM PARALELO → scrape duplicado (carga dobrada no tribunal,
 * risco de ban) + corrida no hashUltimasMovs/ultimaConsultaEm. A guarda
 * em-processo faz o tick sobreposto ser ignorado até o anterior terminar.
 *
 * Provamos a guarda observando getDb: sem ela, a 2ª chamada concorrente
 * também chamaria getDb (2x); com ela, retorna antes (1x).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("../routers/processos", () => ({
  CUSTOS: { monitorar_pessoa_mes: 15, monitorar_processo_mes: 2, consulta_cnj: 1 },
}));
vi.mock("./adapters/pje-tjce", () => ({
  consultarTjce: vi.fn(),
  consultarTjcePorCpf: vi.fn(),
}));
vi.mock("../escritorio/cofre-helpers", () => ({ recuperarSessao: vi.fn() }));
vi.mock("../_core/sse-notifications", () => ({ emitirNotificacao: vi.fn() }));
vi.mock("../db", () => ({ getDb }));

const { pollMonitoramentosMovs, pollMonitoramentosNovasAcoes } = await import(
  "./cron-monitoramento"
);

// DB que devolve 0 pendentes — basta pra exercitar a guarda (a query roda
// depois do getDb, que é o ponto que medimos).
function makeDb() {
  const builder: any = {
    from: () => builder,
    where: () => builder,
    then: (resolve: (v: unknown[]) => unknown) => resolve([]),
  };
  return { select: () => builder };
}

beforeEach(() => {
  getDb.mockReset();
  getDb.mockImplementation(async () => makeDb());
});

describe("cron — guarda de concorrência (anti-sobreposição)", () => {
  it("pollMonitoramentosMovs: tick sobreposto é ignorado (getDb 1x)", async () => {
    const p1 = pollMonitoramentosMovs();
    const p2 = pollMonitoramentosMovs(); // flag já true → retorna antes de getDb
    await Promise.all([p1, p2]);
    expect(getDb).toHaveBeenCalledTimes(1);
  });

  it("após concluir, novo tick volta a rodar (flag liberada no finally)", async () => {
    await pollMonitoramentosMovs();
    await pollMonitoramentosMovs();
    expect(getDb).toHaveBeenCalledTimes(2);
  });

  it("pollMonitoramentosNovasAcoes: tick sobreposto é ignorado (getDb 1x)", async () => {
    const p1 = pollMonitoramentosNovasAcoes();
    const p2 = pollMonitoramentosNovasAcoes();
    await Promise.all([p1, p2]);
    expect(getDb).toHaveBeenCalledTimes(1);
  });

  it("movs e novas_ações têm flags independentes (não bloqueiam um ao outro)", async () => {
    const p1 = pollMonitoramentosMovs();
    const p2 = pollMonitoramentosNovasAcoes(); // flag diferente → roda
    await Promise.all([p1, p2]);
    expect(getDb).toHaveBeenCalledTimes(2);
  });
});
