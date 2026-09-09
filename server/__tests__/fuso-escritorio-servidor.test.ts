/**
 * O servidor usava o relógio UTC como se fosse o do escritório.
 *
 * Todos os cenários fixam o relógio num instante em que UTC já é amanhã mas
 * Fortaleza (UTC-3) ainda é hoje — 2026-09-10T00:30Z = 09/09 21:30 — e provam
 * que o cálculo/gravação segue o dia do escritório. Quando o fuso padrão
 * (America/Sao_Paulo) mascararia a regressão, o escritório é de Manaus (UTC-4).
 *
 * Aqui: helpers de data-calendário, prazo do card e filtro "Criado em" do
 * Kanban, hora do compromisso no Dashboard e o `aprovar` das sugestões de prazo.
 * Rodízio, scheduler de cobranças e crons estão em
 * `fuso-escritorio-crons.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { QueryBuilder } from "drizzle-orm/mysql-core";
import { and } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";
import {
  agendamentos,
  escritorios,
  kanbanCards,
  kanbanColunas,
  kanbanFunis,
  kanbanMovimentacoes,
  prazosSugeridos,
} from "../../drizzle/schema";

// ─── Banco falso roteado por tabela ──────────────────────────────────────────

const filas: Record<string, any[]> = {};
const captured = {
  inserts: [] as { table: string; values: any }[],
  updates: [] as { table: string; set: any; where: any }[],
  wheres: [] as { table: string; cond: any }[],
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
      where: (cond: any) => { captured.wheres.push({ table, cond }); return b; },
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
  getEstatisticasUso: vi.fn(),
  getCalculosRecentes: vi.fn(),
  getUserCreditsInfo: vi.fn(),
}));

let fusoEscritorio = "America/Fortaleza";

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc Teste", fusoHorario: fusoEscritorio, ownerId: 100 },
    colaborador: { id: 10, cargo: "dono" },
  })),
}));

vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async () => ({
    allowed: true, verTodos: true, verProprios: false, colaboradorId: 10, escritorioId: 1,
  })),
  checkPermissionAdminOuMatriz: vi.fn(async () => ({
    allowed: true, verTodos: true, verProprios: false, colaboradorId: 10, escritorioId: 1,
  })),
}));

vi.mock("../escritorio/notificar-card-kanban", () => ({
  notificarCardAtribuido: vi.fn(async () => undefined),
}));

const {
  corteVencimentoCalendario,
  dataCalendarioNoFuso,
  diaCalendarioUtc,
  horaEmTz,
  prazoCalendarioVencido,
} = await import("../_core/dates");
const { boundsPrazo, condicoesCards, prazoCardParaGravar } = await import("../escritorio/kanban-filtros");
const { kanbanRouter } = await import("../escritorio/router-kanban");
const { prazosSugeridosRouter } = await import("../routers/router-prazos-sugeridos");
const { dashboardRouter } = await import("../routers/dashboard");

function fakeCtx(): TrpcContext {
  return {
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X", loginMethod: "google",
      role: "user", asaasCustomerId: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

/**
 * Datas (ISO) entre os parâmetros de uma condição drizzle. O dialeto MySQL
 * já entrega o Date como "YYYY-MM-DD HH:MM:SS.mmm" em UTC — reconverte.
 */
function datasDe(cond: any): string[] {
  return new QueryBuilder().select().from(kanbanCards).where(cond).toSQL().params
    .filter((p): p is string => typeof p === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(p))
    .map((p) => new Date(`${p.replace(" ", "T")}Z`).toISOString());
}

const FORTALEZA = "America/Fortaleza";
const MANAUS = "America/Manaus";
/** 09/09 21:30 em Fortaleza — UTC já virou pra 10/09. */
const NOITE_DE_09 = new Date("2026-09-10T00:30:00Z");
/** 11/09 00:30 em Fortaleza — o dia 10/09 acabou de terminar lá. */
const MADRUGADA_DE_11 = new Date("2026-09-11T03:30:00Z");

beforeEach(() => {
  for (const k of Object.keys(filas)) delete filas[k];
  captured.inserts = [];
  captured.updates = [];
  captured.wheres = [];
  fusoEscritorio = FORTALEZA;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOITE_DE_09);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Helpers puros ────────────────────────────────────────────────────────────

describe("helpers de data-calendário (server/_core/dates.ts)", () => {
  it("horaEmTz formata no fuso do escritório, nunca em UTC", () => {
    const instante = new Date("2026-09-10T17:00:00Z");
    expect(horaEmTz(instante, FORTALEZA)).toBe("14:00");
    expect(horaEmTz(instante, MANAUS)).toBe("13:00");
    // Depois da virada UTC ainda é a noite do dia anterior no escritório.
    expect(horaEmTz(new Date("2026-09-10T02:30:00Z"), FORTALEZA)).toBe("23:30");
    // Meia-noite sai "00:00", não "24:00".
    expect(horaEmTz(new Date("2026-09-10T03:00:00Z"), FORTALEZA)).toBe("00:00");
  });

  it("diaCalendarioUtc lê o dia gravado — vale pra meia-noite (antigo) e meio-dia (novo)", () => {
    expect(diaCalendarioUtc(new Date("2026-09-10T00:00:00Z"))).toBe("2026-09-10");
    expect(diaCalendarioUtc(new Date("2026-09-10T12:00:00Z"))).toBe("2026-09-10");
  });

  it("corteVencimentoCalendario é a meia-noite UTC do dia civil de hoje no fuso", () => {
    expect(corteVencimentoCalendario(NOITE_DE_09, FORTALEZA).toISOString()).toBe("2026-09-09T00:00:00.000Z");
    expect(corteVencimentoCalendario(MADRUGADA_DE_11, FORTALEZA).toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("prazo 10/09 só vence quando o dia 10 termina no fuso do escritório", () => {
    for (const prazo of [new Date("2026-09-10T12:00:00Z"), new Date("2026-09-10T00:00:00Z")]) {
      expect(prazoCalendarioVencido(prazo, NOITE_DE_09, FORTALEZA)).toBe(false);
      // 10/09 23:59 em Fortaleza (11/09 02:59Z): ainda é o dia do prazo.
      expect(prazoCalendarioVencido(prazo, new Date("2026-09-11T02:59:00Z"), FORTALEZA)).toBe(false);
      expect(prazoCalendarioVencido(prazo, MADRUGADA_DE_11, FORTALEZA)).toBe(true);
    }
  });

  it("dataCalendarioNoFuso reinterpreta o relógio UTC como relógio do escritório", () => {
    expect(dataCalendarioNoFuso(new Date("2026-09-10T00:00:00Z"), FORTALEZA).toISOString())
      .toBe("2026-09-10T03:00:00.000Z");
    expect(dataCalendarioNoFuso(new Date("2026-09-10T00:00:00Z"), MANAUS).toISOString())
      .toBe("2026-09-10T04:00:00.000Z");
    // Audiência "às 14:00" gravada como 14:00Z vira 14:00 no escritório.
    expect(dataCalendarioNoFuso(new Date("2026-09-10T14:00:00Z"), FORTALEZA).toISOString())
      .toBe("2026-09-10T17:00:00.000Z");
  });
});

// ─── kanban-5 · prazo do card ─────────────────────────────────────────────────

describe("kanban-5 · prazo do card é data-calendário", () => {
  it("data-só é gravada ao meio-dia UTC; ISO com hora segue como instante", () => {
    expect(prazoCardParaGravar("2026-09-10").toISOString()).toBe("2026-09-10T12:00:00.000Z");
    expect(prazoCardParaGravar("2026-09-10T15:00:00.000Z").toISOString()).toBe("2026-09-10T15:00:00.000Z");
  });

  it("criarCard grava prazo 10/09 como 2026-09-10T12:00Z", async () => {
    filas[tableName(kanbanColunas)] = [{ id: 1, funilId: 1 }];
    await kanbanRouter.createCaller(fakeCtx()).criarCard({
      colunaId: 1, titulo: "Contestação", prazo: "2026-09-10",
    });
    const ins = captured.inserts.find((i) => i.table === tableName(kanbanCards));
    expect(ins?.values.prazo.toISOString()).toBe("2026-09-10T12:00:00.000Z");
  });

  it("editarCard grava prazo 10/09 como 2026-09-10T12:00Z", async () => {
    await kanbanRouter.createCaller(fakeCtx()).editarCard({ id: 1, prazo: "2026-09-10" });
    const up = captured.updates.find((u) => u.table === tableName(kanbanCards));
    expect(up?.set.prazo.toISOString()).toBe("2026-09-10T12:00:00.000Z");
  });

  it("às 21:30 de 09/09 em Fortaleza o filtro 'vencidos' NÃO alcança o prazo de 10/09", () => {
    const { hoje, fimHoje, fim7 } = boundsPrazo(NOITE_DE_09, FORTALEZA);
    expect(hoje.toISOString()).toBe("2026-09-09T00:00:00.000Z");
    expect(fimHoje.toISOString()).toBe("2026-09-09T23:59:59.999Z");
    expect(fim7.toISOString()).toBe("2026-09-16T23:59:59.999Z");
    const prazo10 = prazoCardParaGravar("2026-09-10");
    expect(prazo10.getTime() < hoje.getTime()).toBe(false); // não é "vencido"
    expect(prazo10.getTime() > fimHoje.getTime()).toBe(true); // nem é "hoje"

    const conds = condicoesCards({ escritorioId: 1, filtros: { prazoFiltro: "vencidos" }, fusoHorario: FORTALEZA });
    expect(datasDe(and(...conds))).toContain("2026-09-09T00:00:00.000Z");
  });

  it("às 00:30 de 11/09 em Fortaleza o prazo de 10/09 passa a ser 'vencido'", () => {
    const { hoje } = boundsPrazo(MADRUGADA_DE_11, FORTALEZA);
    expect(hoje.toISOString()).toBe("2026-09-11T00:00:00.000Z");
    expect(prazoCardParaGravar("2026-09-10").getTime() < hoje.getTime()).toBe(true);
  });

  async function historicoComConclusaoEm(prazo: Date, concluidoEm: Date) {
    filas[tableName(kanbanCards)] = [{
      id: 1, titulo: "Card", colunaId: 2, prazo, createdAt: new Date("2026-09-01T12:00:00Z"), responsavelId: null,
    }];
    filas[tableName(kanbanColunas)] = [
      { id: 1, nome: "Fazendo", tipo: "normal", funilId: 1 },
      { id: 2, nome: "Concluído", tipo: "conclusao", funilId: 1 },
    ];
    filas[tableName(kanbanMovimentacoes)] = [{
      id: 1, cardId: 1, colunaOrigemId: 1, colunaDestinoId: 2, createdAt: concluidoEm, movidoPorId: null,
    }];
    return kanbanRouter.createCaller(fakeCtx()).historicoCard({ cardId: 1 });
  }

  it("concluir às 15h do dia do prazo não é 'concluído em atraso'", async () => {
    const r = await historicoComConclusaoEm(prazoCardParaGravar("2026-09-10"), new Date("2026-09-10T18:00:00Z"));
    expect(r.concluidoEmAtraso).toBe(false);
    const mov = r.eventos.find((e) => e.tipo === "movimentacao") as any;
    expect(mov.concluidoEmAtraso).toBe(false);
  });

  it("card antigo (prazo à meia-noite UTC) concluído às 20h do dia do prazo também não", async () => {
    const r = await historicoComConclusaoEm(new Date("2026-09-10T00:00:00Z"), new Date("2026-09-10T23:00:00Z"));
    expect(r.concluidoEmAtraso).toBe(false);
  });

  it("concluir às 00:30 do dia seguinte é atraso", async () => {
    const r = await historicoComConclusaoEm(prazoCardParaGravar("2026-09-10"), MADRUGADA_DE_11);
    expect(r.concluidoEmAtraso).toBe(true);
    const mov = r.eventos.find((e) => e.tipo === "movimentacao") as any;
    expect(mov.concluidoEmAtraso).toBe(true);
  });
});

// ─── kanban-18 · filtro "Criado em" ───────────────────────────────────────────

describe("kanban-18 · 'Criado em' começa e termina no dia do escritório", () => {
  it("condicoesCards usa a meia-noite do escritório (Manaus = 04:00Z), não a do servidor", () => {
    const conds = condicoesCards({
      escritorioId: 1,
      filtros: { dataInicio: "2026-08-15", dataFim: "2026-08-15" },
      fusoHorario: MANAUS,
    });
    const datas = datasDe(and(...conds));
    expect(datas).toContain("2026-08-15T04:00:00.000Z");
    expect(datas).toContain("2026-08-16T03:59:59.999Z");
    expect(datas).not.toContain("2026-08-15T00:00:00.000Z");
  });

  it("obterFunil resolve o fuso do escritório e passa pro filtro", async () => {
    filas[tableName(escritorios)] = [{ fusoHorario: MANAUS }];
    filas[tableName(kanbanFunis)] = [{ id: 1, escritorioId: 1, nome: "Funil" }];
    filas[tableName(kanbanColunas)] = [{ id: 1, funilId: 1, nome: "A", ordem: 1 }];
    await kanbanRouter.createCaller(fakeCtx()).obterFunil({ funilId: 1, dataInicio: "2026-08-15" });
    const whereCards = captured.wheres.filter((w) => w.table === tableName(kanbanCards));
    expect(whereCards.length).toBeGreaterThan(0);
    const datas = whereCards.flatMap((w) => datasDe(w.cond));
    expect(datas).toContain("2026-08-15T04:00:00.000Z");
  });

  it("o PDF filtra com o mesmo fuso (amarra de fonte)", () => {
    const fonte = readFileSync(path.resolve(__dirname, "../escritorio/router-kanban.ts"), "utf-8");
    const inicio = fonte.indexOf("exportarCardsPdf: protectedProcedure");
    expect(inicio).toBeGreaterThan(-1);
    const corpo = fonte.slice(inicio, inicio + 4000);
    expect(corpo).toContain("fusoHorario: esc.escritorio.fusoHorario,");
  });
});

// ─── relatorios-3 · hora do compromisso no Dashboard ─────────────────────────

describe("relatorios-3 · hora do compromisso sai no fuso do escritório", () => {
  const reuniaoAs14hFortaleza = {
    id: 1, titulo: "Reunião", dataInicio: new Date("2026-09-10T17:00:00Z"), tipo: "reuniao", corHex: null,
  };

  it("resumoEscritorio: 14:00 em Fortaleza sai '14:00' (não '17:00')", async () => {
    filas[tableName(agendamentos)] = [reuniaoAs14hFortaleza];
    const r = await dashboardRouter.createCaller(fakeCtx()).resumoEscritorio();
    expect(r).not.toBeNull();
    expect(r!.agenda.compromissosHoje[0]?.hora).toBe("14:00");
  });

  it("resumoEscritorio: o mesmo instante em Manaus sai '13:00'", async () => {
    fusoEscritorio = MANAUS;
    filas[tableName(agendamentos)] = [reuniaoAs14hFortaleza];
    const r = await dashboardRouter.createCaller(fakeCtx()).resumoEscritorio();
    expect(r!.agenda.compromissosHoje[0]?.hora).toBe("13:00");
  });

  it("agendaDoDia: 14:00 em Fortaleza sai '14:00'", async () => {
    filas[tableName(agendamentos)] = [reuniaoAs14hFortaleza];
    const r = await dashboardRouter.createCaller(fakeCtx()).agendaDoDia({ data: "2026-09-10" });
    expect(r.compromissos[0]?.hora).toBe("14:00");
  });
});

// ─── processos-1 · aprovar sugestão de prazo ─────────────────────────────────

describe("processos-1 · aprovar grava dataInicio no dia sugerido, no fuso do escritório", () => {
  function sugestao(extra: Record<string, unknown>) {
    filas[tableName(prazosSugeridos)] = [{
      id: 5, escritorioId: 1, status: "pendente", tipo: "prazo_processual",
      titulo: "Prazo de contestação", motivo: "15 dias", cnjAfetado: null, trechoOrigem: null,
      dataSugerida: new Date("2026-09-10T00:00:00Z"),
      ...extra,
    }];
  }
  const dataInicioGravada = () =>
    captured.inserts.find((i) => i.table === tableName(agendamentos))?.values.dataInicio.toISOString();

  it("prazo 10/09 (00:00Z) vira 00:00 de 10/09 em Fortaleza, não 21:00 de 09/09", async () => {
    sugestao({});
    const r = await prazosSugeridosRouter.createCaller(fakeCtx()).aprovar({ id: 5 });
    expect(r).toEqual({ agendamentoId: 1 });
    expect(dataInicioGravada()).toBe("2026-09-10T03:00:00.000Z");
  });

  it("em Manaus o mesmo prazo nasce às 04:00Z", async () => {
    fusoEscritorio = MANAUS;
    sugestao({});
    await prazosSugeridosRouter.createCaller(fakeCtx()).aprovar({ id: 5 });
    expect(dataInicioGravada()).toBe("2026-09-10T04:00:00.000Z");
  });

  it("audiência às 14:00 (gravada 14:00Z) vira 14:00 no escritório", async () => {
    sugestao({ tipo: "audiencia", dataSugerida: new Date("2026-09-10T14:00:00Z") });
    await prazosSugeridosRouter.createCaller(fakeCtx()).aprovar({ id: 5 });
    expect(dataInicioGravada()).toBe("2026-09-10T17:00:00.000Z");
  });

  it("ajuste com data-só segue a mesma regra; ajuste com hora é instante e não muda", async () => {
    sugestao({});
    const caller = prazosSugeridosRouter.createCaller(fakeCtx());
    await caller.aprovar({ id: 5, ajustes: { dataInicio: "2026-09-11" } });
    expect(dataInicioGravada()).toBe("2026-09-11T03:00:00.000Z");

    captured.inserts = [];
    sugestao({});
    await caller.aprovar({ id: 5, ajustes: { dataInicio: "2026-09-11T13:00:00.000Z" } });
    expect(dataInicioGravada()).toBe("2026-09-11T13:00:00.000Z");
  });
});
