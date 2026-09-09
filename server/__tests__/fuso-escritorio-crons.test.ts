/**
 * Continuação de `fuso-escritorio-servidor.test.ts` — os pontos que rodam
 * sem usuário logado: rodízio de leads, scheduler de cobranças do SmartFlow
 * e os crons de notificação de prazo / atraso do Kanban.
 *
 * Mesmo desenho: relógio fixado num instante em que UTC já é amanhã mas
 * Fortaleza (UTC-3) ainda é hoje, e a prova é que a decisão segue o dia (e
 * o expediente) do escritório.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryBuilder } from "drizzle-orm/mysql-core";
import {
  agendamentos,
  asaasClientes,
  asaasCobrancas,
  colaboradores,
  escritorios,
  kanbanCards,
  notificacoes,
  smartflowCenarios,
  tarefas,
} from "../../drizzle/schema";

// ─── Banco falso roteado por tabela ──────────────────────────────────────────

const filas: Record<string, any[]> = {};
const captured = {
  inserts: [] as { table: string; values: any }[],
  updates: [] as { table: string; set: any; where: any }[],
};

function tableName(t: any): string {
  return (t?.[Symbol.for("drizzle:Name")] as string) || "";
}

function makeDb() {
  function builder(): any {
    let table = "";
    const rows = () => filas[table] ?? [];
    const b: any = {
      from: (t: any) => { table = tableName(t); return b; },
      innerJoin: () => b,
      leftJoin: () => b,
      where: () => b,
      orderBy: () => b,
      groupBy: () => b,
      limit: () => Promise.resolve(rows()),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rows()).then(resolve, reject),
    };
    return b;
  }
  return {
    select: () => builder(),
    insert: (t: any) => ({
      values: (v: any) => {
        captured.inserts.push({ table: tableName(t), values: v });
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (t: any) => ({
      set: (s: any) => ({
        where: (cond: any) => {
          captured.updates.push({ table: tableName(t), set: s, where: cond });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve([{ affectedRows: 0 }]) }),
  };
}

const dbInstance = makeDb();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbInstance),
}));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => null),
}));

const dispararPagamentoVencido = vi.fn(async () => ({ cenariosDisparados: 1 }));
const dispararProximoVencimento = vi.fn(async () => ({ cenariosDisparados: 0 }));
vi.mock("../smartflow/dispatcher", () => ({
  dispararPagamentoVencido: (...a: unknown[]) => dispararPagamentoVencido(...(a as [])),
  dispararProximoVencimento: (...a: unknown[]) => dispararProximoVencimento(...(a as [])),
}));
vi.mock("../integracoes/asaas-sync", () => ({
  verificarCobrancaAtivaNoAsaas: vi.fn(async () => "ativa"),
  syncTodosEscritorios: vi.fn(async () => undefined),
  validarConexoesAsaasPendentes: vi.fn(async () => undefined),
}));
vi.mock("../integracoes/asaas-sync-historico", () => ({
  processarSyncHistorico: vi.fn(async () => undefined),
}));
vi.mock("../integracoes/canal-envio", () => ({
  getCanalCloudApi: vi.fn(async () => null),
}));
vi.mock("../integracoes/whatsapp-envio-guard", () => ({
  podeEnviar: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../_core/sentry", () => ({
  captureError: vi.fn(),
}));

const crm = await import("../escritorio/db-crm");
const { rodarCicloCobrancas } = await import("../smartflow/cobrancas-scheduler");
const { notificarPrazos, verificarPrazosKanban } = await import("../_core/cron-jobs");

const FORTALEZA = "America/Fortaleza";
/** 09/09 21:30 em Fortaleza — UTC já virou pra 10/09. */
const NOITE_DE_09 = new Date("2026-09-10T00:30:00Z");
/** 11/09 00:30 em Fortaleza — o dia 10/09 acabou de terminar lá. */
const MADRUGADA_DE_11 = new Date("2026-09-11T03:30:00Z");

/** Datas (ISO) nos parâmetros — o dialeto MySQL entrega "YYYY-MM-DD HH:MM:SS.mmm" em UTC. */
function datasDosParams(cond: any): string[] {
  return new QueryBuilder().select().from(kanbanCards).where(cond).toSQL().params
    .filter((p): p is string => typeof p === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(p))
    .map((p) => new Date(`${p.replace(" ", "T")}Z`).toISOString());
}

beforeEach(() => {
  for (const k of Object.keys(filas)) delete filas[k];
  captured.inserts = [];
  captured.updates = [];
  dispararPagamentoVencido.mockClear();
  dispararProximoVencimento.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOITE_DE_09);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── atendimento-4 · rodízio ─────────────────────────────────────────────────

describe("atendimento-4 · rodízio decide 'fora do expediente' no fuso do escritório", () => {
  function escritorio(extra: Record<string, unknown> = {}) {
    filas[tableName(escritorios)] = [{
      id: 1, fusoHorario: FORTALEZA, horarioAbertura: "08:00", horarioFechamento: "18:00",
      diasFuncionamento: JSON.stringify(["seg", "ter", "qua", "qui", "sex"]),
      ...extra,
    }];
  }
  function atendenteOnline() {
    filas[tableName(colaboradores)] = [{
      id: 7, escritorioId: 1, ativo: true, recebeLeadsAutomaticos: true,
      ultimaAtividade: new Date(), maxAtendimentosSimultaneos: null, ultimaDistribuicao: null,
    }];
  }

  it("quinta 15:30 em Fortaleza (18:30Z) distribui — o servidor achava que já eram 18:30", async () => {
    vi.setSystemTime(new Date("2026-09-10T18:30:00Z"));
    escritorio();
    atendenteOnline();
    expect(await crm.distribuirLead(1)).toBe(7);
  });

  it("quinta 06:30 em Fortaleza (09:30Z) NÃO distribui — está fora do expediente do escritório", async () => {
    vi.setSystemTime(new Date("2026-09-10T09:30:00Z"));
    escritorio();
    atendenteOnline();
    expect(await crm.distribuirLead(1)).toBeNull();
  });

  it("sexta 22:30 em Fortaleza (sábado 01:30Z) distribui quando o expediente vai até 23:00", async () => {
    vi.setSystemTime(new Date("2026-09-12T01:30:00Z"));
    escritorio({ horarioFechamento: "23:00" });
    atendenteOnline();
    expect(await crm.distribuirLead(1)).toBe(7);
  });
});

// ─── smartflow-9 · cobrança que vence hoje ───────────────────────────────────

describe("smartflow-9 · cobrança que vence HOJE no fuso não é 'vencida'", () => {
  function cenarioVencidoComCobranca(vencimento: string) {
    filas[tableName(smartflowCenarios)] = [{
      id: 1, escritorioId: 1, gatilho: "pagamento_vencido", configGatilho: "{}", ativo: true,
    }];
    filas[tableName(escritorios)] = [{ id: 1, fusoHorario: FORTALEZA }];
    filas[tableName(asaasCobrancas)] = [{
      vencimento, status: "PENDING", asaasPaymentId: "pay_1", asaasCustomerId: "cus_1",
      valor: "100.00", descricao: "Honorários",
    }];
    filas[tableName(asaasClientes)] = [{ nome: "Fulano", contatoId: 3 }];
  }

  it("às 21:30 de 09/09 a cobrança que vence 09/09 ainda está no prazo", async () => {
    cenarioVencidoComCobranca("2026-09-09");
    const r = await rodarCicloCobrancas({ limite: 1 });
    expect(dispararPagamentoVencido).not.toHaveBeenCalled();
    expect(r.vencidas).toBe(0);
  });

  it("às 00:30 de 10/09 no fuso ela venceu e dispara", async () => {
    vi.setSystemTime(new Date("2026-09-10T03:30:00Z"));
    cenarioVencidoComCobranca("2026-09-09");
    const r = await rodarCicloCobrancas({ limite: 1 });
    expect(dispararPagamentoVencido).toHaveBeenCalledTimes(1);
    expect((dispararPagamentoVencido.mock.calls[0] as any[])[1].vencimento).toBe("2026-09-09");
    expect(r.vencidas).toBe(1);
  });
});

// ─── infra-4 · notificação de prazo ──────────────────────────────────────────

describe("infra-4 · notificarPrazos usa hora e 'hoje' do escritório", () => {
  beforeEach(() => {
    filas[tableName(escritorios)] = [{ id: 1, fusoHorario: FORTALEZA }];
    filas[tableName(colaboradores)] = [{ userId: 5 }];
    filas[tableName(notificacoes)] = [];
    filas[tableName(agendamentos)] = [{
      id: 1, titulo: "Reunião", escritorioId: 1, responsavelId: 7, status: "pendente",
      // 22:00 de 09/09 em Fortaleza — daqui a 30 minutos.
      dataInicio: new Date("2026-09-10T01:00:00Z"),
    }];
    filas[tableName(tarefas)] = [
      // Vence 10/09 12:00 em Fortaleza: pro servidor (UTC) "hoje", pro escritório amanhã.
      { id: 1, titulo: "Amanhã", escritorioId: 1, responsavelId: 7, status: "pendente",
        dataVencimento: new Date("2026-09-10T15:00:00Z") },
      // Venceu 09/09 17:00 em Fortaleza: é hoje — e ainda não está atrasada.
      { id: 2, titulo: "Hoje", escritorioId: 1, responsavelId: 7, status: "pendente",
        dataVencimento: new Date("2026-09-09T20:00:00Z") },
    ];
  });

  const notificacoesCriadas = () =>
    captured.inserts.filter((i) => i.table === tableName(notificacoes)).map((i) => i.values);

  it("a hora do compromisso sai no fuso ('22:00'), não em UTC ('01:00')", async () => {
    await notificarPrazos();
    const emBreve = notificacoesCriadas().find((n) => n.titulo === "Reunião em breve");
    expect(emBreve?.mensagem).toBe("Compromisso às 22:00: Reunião");
  });

  it("'vence hoje' é o hoje do escritório: a tarefa de amanhã fica de fora, a de hoje entra", async () => {
    await notificarPrazos();
    const venceHoje = notificacoesCriadas().filter((n) => n.titulo === "Tarefa vence hoje");
    expect(venceHoje.map((n) => n.mensagem)).toEqual(['"Hoje" vence hoje.']);
  });

  it("nada vira 'atrasado' enquanto o dia não termina no escritório", async () => {
    await notificarPrazos();
    const titulos = notificacoesCriadas().map((n) => n.titulo);
    expect(titulos).not.toContain("Tarefa atrasada");
    expect(titulos).not.toContain("Compromisso atrasado");
  });

  it("no dia seguinte (fuso) a tarefa de 09/09 passa a ser atrasada", async () => {
    vi.setSystemTime(new Date("2026-09-10T03:30:00Z")); // 10/09 00:30 em Fortaleza
    await notificarPrazos();
    const atrasadas = notificacoesCriadas().filter((n) => n.titulo === "Tarefa atrasada");
    expect(atrasadas.map((n) => n.mensagem)).toEqual(['"Hoje" está atrasada.']);
  });
});

// ─── kanban-5 · cron que marca 'atrasado' ────────────────────────────────────

describe("kanban-5 · verificarPrazosKanban só marca quando o dia do prazo terminou no fuso", () => {
  const PRAZO_10_NOVO = new Date("2026-09-10T12:00:00Z");
  const PRAZO_10_ANTIGO = new Date("2026-09-10T00:00:00Z");

  function corteDoUpdate(): Date {
    const up = captured.updates.find((u) => u.table === tableName(kanbanCards));
    expect(up).toBeDefined();
    expect(up!.set).toEqual({ atrasado: true });
    const datas = datasDosParams(up!.where);
    expect(datas).toHaveLength(1);
    return new Date(datas[0]!);
  }

  it("às 21:30 de 09/09 em Fortaleza o prazo de 10/09 (novo ou antigo) NÃO é marcado", async () => {
    filas[tableName(escritorios)] = [{ id: 1, fusoHorario: FORTALEZA }];
    await verificarPrazosKanban();
    const corte = corteDoUpdate();
    expect(corte.toISOString()).toBe("2026-09-09T00:00:00.000Z");
    expect(PRAZO_10_NOVO < corte).toBe(false);
    expect(PRAZO_10_ANTIGO < corte).toBe(false);
  });

  it("às 00:30 de 11/09 em Fortaleza os dois são marcados", async () => {
    vi.setSystemTime(MADRUGADA_DE_11);
    filas[tableName(escritorios)] = [{ id: 1, fusoHorario: FORTALEZA }];
    await verificarPrazosKanban();
    const corte = corteDoUpdate();
    expect(corte.toISOString()).toBe("2026-09-11T00:00:00.000Z");
    expect(PRAZO_10_NOVO < corte).toBe(true);
    expect(PRAZO_10_ANTIGO < corte).toBe(true);
  });

  it("um UPDATE por fuso, escopado aos escritórios daquele fuso", async () => {
    filas[tableName(escritorios)] = [
      { id: 1, fusoHorario: FORTALEZA },
      { id: 2, fusoHorario: FORTALEZA },
      { id: 3, fusoHorario: "America/Manaus" },
    ];
    await verificarPrazosKanban();
    const ups = captured.updates.filter((u) => u.table === tableName(kanbanCards));
    expect(ups).toHaveLength(2);
    const params = ups.map((u) =>
      new QueryBuilder().select().from(kanbanCards).where(u.where).toSQL().params.filter((p) => typeof p === "number"),
    );
    expect(params).toEqual([[1, 2], [3]]);
  });
});
