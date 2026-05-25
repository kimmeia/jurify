/**
 * Regressão: auto-relogin quando a sessão morre NO PONTO DE USO.
 *
 * Sintoma que motivou: "Atualizar todos" dava "Sessão expirada — PDPJ
 * redirecionou" mesmo com a credencial ativa, porque a sessão guardada parecia
 * válida pela estimativa de 90min mas o PDPJ já a tinha derrubado — e o poll
 * só reportava o erro, sem refazer login. Agora, ao ver `categoriaErro:
 * "sessao_expirada"`, o poll força relogin (forcarRelogin) e refaz a consulta.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
const { consultarTjce } = vi.hoisted(() => ({ consultarTjce: vi.fn() }));
const { recuperarSessao } = vi.hoisted(() => ({ recuperarSessao: vi.fn() }));

vi.mock("../routers/processos", () => ({
  CUSTOS: { monitorar_pessoa_mes: 15, monitorar_processo_mes: 2, consulta_cnj: 1 },
}));
vi.mock("./adapters/pje-tjce", () => ({ consultarTjce, consultarTjcePorCpf: vi.fn() }));
vi.mock("../escritorio/cofre-helpers", () => ({ recuperarSessao }));
vi.mock("../_core/sse-notifications", () => ({ emitirNotificacao: vi.fn() }));
vi.mock("../db", () => ({ getDb }));

const { pollarUmMonitoramentoMovs } = await import("./cron-monitoramento");

function makeDb() {
  const selectChain: any = { from: () => selectChain, where: () => Promise.resolve([]) };
  return {
    select: () => selectChain,
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
  };
}

const MON = {
  id: 1,
  credencialId: 10,
  tribunal: "tjce",
  searchKey: "0000000-00.2025.8.06.0001",
  tipoMonitoramento: "movimentacoes",
  hashUltimasMovs: "hash-antigo",
} as any;

beforeEach(() => {
  getDb.mockReset();
  getDb.mockImplementation(async () => makeDb());
  consultarTjce.mockReset();
  recuperarSessao.mockReset();
});

describe("poll movimentações — auto-relogin quando a sessão morre no uso", () => {
  it("categoriaErro 'sessao_expirada' → força relogin e refaz a consulta", async () => {
    recuperarSessao
      .mockResolvedValueOnce("sessao-velha")
      .mockResolvedValueOnce("sessao-nova");
    consultarTjce
      .mockResolvedValueOnce({
        ok: false,
        categoriaErro: "sessao_expirada",
        mensagemErro: "Sessão expirada — PDPJ-cloud redirecionou pra login",
        movimentacoes: [],
      })
      .mockResolvedValueOnce({
        ok: false,
        categoriaErro: "outro",
        mensagemErro: "ainda falhou",
        movimentacoes: [],
      });

    await pollarUmMonitoramentoMovs(MON);

    expect(recuperarSessao).toHaveBeenCalledTimes(2);
    expect(recuperarSessao).toHaveBeenNthCalledWith(2, 10, {
      tentarRelogin: true,
      forcarRelogin: true,
    });
    expect(consultarTjce).toHaveBeenCalledTimes(2);
  });

  it("erro que NÃO é de sessão não dispara relogin forçado", async () => {
    recuperarSessao.mockResolvedValueOnce("sessao-ok");
    consultarTjce.mockResolvedValueOnce({
      ok: false,
      categoriaErro: "cnj_nao_encontrado",
      mensagemErro: "não encontrado",
      movimentacoes: [],
    });

    await pollarUmMonitoramentoMovs(MON);

    expect(recuperarSessao).toHaveBeenCalledTimes(1);
    expect(consultarTjce).toHaveBeenCalledTimes(1);
  });
});
