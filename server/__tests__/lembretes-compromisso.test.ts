/**
 * Lembrete de compromisso: nasce com hora de disparo e chega em TODOS os
 * destinatários.
 *
 * Duas falhas somavam no mesmo silêncio:
 *
 *  1. o diálogo "Novo compromisso" (Atendimento, ficha do cliente, drawer de
 *     movimentação) grava por `criarAgendamento`, que inseria o lembrete sem
 *     `dispararEm` — e o cron só lê linha com `dispararEm` preenchido. O
 *     usuário escolhia "30 min antes" e nunca era avisado. Agora a regra é a
 *     mesma de `agenda.salvarLembretes`: dispararEm = dataInicio − minutos,
 *     destinatário padrão = responsável, canal = o tipo escolhido.
 *  2. no cron, "Quem avisar: todos" comparava `colaboradores.id` (o que o
 *     lembrete guarda) com `users.id` (o que a query devolvia) — ids de
 *     tabelas distintas, quase ninguém coincidia. O filtro passou a ser
 *     `inArray(colaboradores.id, …)` na própria query.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

type Op = "select" | "insert" | "update";
type Captured = { op: Op; table: string; values?: any; where?: unknown };

let captured: Captured[] = [];
let pendentesDoCron: any[] = [];
type ColabRow = { colaboradorId: number; userId: number; nome: string | null; email: string | null };
let colaboradoresDoEscritorio: ColabRow[] = [];
let nextInsertId = 1;

const dialeto = new MySqlDialect();

function tableName(t: unknown): string {
  const anyT = t as any;
  return anyT?._?.name || anyT?.[Symbol.for("drizzle:Name")] || "unknown";
}

function render(where: unknown): { sql: string; params: unknown[] } {
  const q = dialeto.sqlToQuery(where as SQL);
  return { sql: q.sql, params: q.params };
}

/**
 * Faz o papel do banco pra `colaboradores`: honra um `IN (…)` sobre a coluna
 * que a query pediu — se for `colaboradores.id`, filtra por id; se for outra
 * coluna (o bug), filtra por ela; sem IN, devolve o escritório inteiro.
 */
function filtrarColaboradores(where: unknown): ColabRow[] {
  const { sql, params } = render(where);
  const m = sql.match(/`colaboradores`\.`(\w+)` in \(([?, ]+)\)/);
  if (!m || m.index === undefined) return colaboradoresDoEscritorio;
  const coluna = m[1] === "id" ? "colaboradorId" : m[1];
  const n = m[2].split("?").length - 1;
  const antes = sql.slice(0, m.index).split("?").length - 1;
  const ids = params.slice(antes, antes + n);
  return colaboradoresDoEscritorio.filter((r) => ids.includes((r as any)[coluna]));
}

function resolver(op: Op, table: string, where: unknown): unknown {
  if (op === "update") return [{ affectedRows: 1 }];
  if (table === "agendamento_lembretes") return pendentesDoCron;
  if (table === "colaboradores") return filtrarColaboradores(where);
  return [];
}

function builder(op: Op, table: string) {
  let where: unknown;
  const b: any = {
    from: () => b,
    innerJoin: () => b,
    leftJoin: () => b,
    set: () => b,
    where: (w: unknown) => {
      where = w;
      captured.push({ op, table, where });
      return b;
    },
    limit: () => Promise.resolve(resolver(op, table, where)),
    then: (res: any, rej: any) => Promise.resolve().then(() => resolver(op, table, where)).then(res, rej),
  };
  return b;
}

const mockDb = {
  select: () => ({ from: (t: unknown) => builder("select", tableName(t)) }),
  update: (t: unknown) => builder("update", tableName(t)),
  insert: (table: unknown) => ({
    values(values: unknown) {
      captured.push({ op: "insert", table: tableName(table), values });
      const id = nextInsertId++;
      return { then: (r: any) => r([{ insertId: id, affectedRows: 1 }]) };
    },
  }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

const criarNotificacao = vi.fn(async (_p: any) => {});
vi.mock("../processos/router-notificacoes", () => ({
  criarNotificacao: (p: any) => criarNotificacao(p),
}));

const { criarAgendamento } = await import("../escritorio/db-agendamento");
const { dispararLembretesAgenda } = await import("../escritorio/cron-disparar-lembretes");

beforeEach(() => {
  captured = [];
  pendentesDoCron = [];
  colaboradoresDoEscritorio = [];
  nextInsertId = 1;
  criarNotificacao.mockClear();
});

const insertsDeLembrete = () =>
  captured.filter((c) => c.op === "insert" && c.table === "agendamento_lembretes").map((c) => c.values);

describe("criarAgendamento (diálogo Novo compromisso) grava lembrete que o cron enxerga", () => {
  it("lembrete de 30 min pra 14:00 dispara às 13:30, pro responsável, no canal escolhido", async () => {
    const id = await criarAgendamento({
      escritorioId: 1,
      criadoPorId: 7,
      responsavelId: 7,
      tipo: "reuniao_comercial",
      titulo: "Reunião com Fulano",
      dataInicio: "2026-09-10T14:00:00.000Z",
      lembretes: [{ tipo: "notificacao_app", minutosAntes: 30 }],
    });

    const [lem] = insertsDeLembrete();
    expect(lem).toBeDefined();
    expect(lem.agendamentoId).toBe(id);
    expect(lem.minutosAntes).toBe(30);
    expect(lem.dispararEm).toBeInstanceOf(Date);
    expect(lem.dispararEm.toISOString()).toBe("2026-09-10T13:30:00.000Z");
    expect(lem.destinatarioIds).toEqual([7]);
    expect(lem.canais).toEqual(["notificacao_app"]);
    expect(lem.enviado).toBe(false);
  });

  it("o destinatário é o responsável do compromisso, não quem criou", async () => {
    await criarAgendamento({
      escritorioId: 1,
      criadoPorId: 7,
      responsavelId: 9,
      tipo: "audiencia",
      titulo: "Audiência",
      dataInicio: "2026-09-10T14:00:00.000Z",
      lembretes: [{ tipo: "notificacao_app", minutosAntes: 60 }],
    });
    const [lem] = insertsDeLembrete();
    expect(lem.destinatarioIds).toEqual([9]);
    expect(lem.dispararEm.toISOString()).toBe("2026-09-10T13:00:00.000Z");
  });

  it("cada lembrete ganha o seu próprio dispararEm", async () => {
    await criarAgendamento({
      escritorioId: 1,
      criadoPorId: 7,
      responsavelId: 7,
      tipo: "reuniao_comercial",
      titulo: "Reunião",
      dataInicio: "2026-09-10T14:00:00.000Z",
      lembretes: [
        { tipo: "notificacao_app", minutosAntes: 30 },
        { tipo: "notificacao_app", minutosAntes: 1440 },
      ],
    });
    const horarios = insertsDeLembrete().map((l) => l.dispararEm.toISOString());
    expect(horarios).toEqual(["2026-09-10T13:30:00.000Z", "2026-09-09T14:00:00.000Z"]);
  });

  it("sem lembretes não insere nada em agendamento_lembretes", async () => {
    await criarAgendamento({
      escritorioId: 1,
      criadoPorId: 7,
      responsavelId: 7,
      tipo: "tarefa",
      titulo: "Tarefa",
      dataInicio: "2026-09-10T14:00:00.000Z",
    });
    expect(insertsDeLembrete()).toHaveLength(0);
  });

  it("a regra do dispararEm é a mesma de agenda.salvarLembretes", () => {
    // Duas escritas, uma fórmula. Se uma mudar, a outra tem que ir junto.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const ler = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf-8");
    expect(ler("server/escritorio/router-agenda.ts")).toContain("dispararEm: new Date(inicio - l.minutosAntes * 60_000)");
    expect(ler("server/escritorio/db-agendamento.ts")).toContain("dispararEm: new Date(inicio - lem.minutosAntes * 60_000)");
  });
});

describe("cron dispararLembretesAgenda com mais de um destinatário", () => {
  const lembreteBase = {
    lembreteId: 1,
    agendamentoId: 5,
    tipo: "notificacao_app",
    minutosAntes: 30,
    titulo: "Reunião de equipe",
    dataInicio: new Date("2026-09-10T14:00:00.000Z"),
    local: null,
    responsavelId: 10,
    escritorioId: 1,
  };

  beforeEach(() => {
    colaboradoresDoEscritorio = [
      { colaboradorId: 10, userId: 100, nome: "Ana", email: "ana@x" },
      { colaboradorId: 11, userId: 101, nome: "Bruno", email: "bruno@x" },
      { colaboradorId: 12, userId: 102, nome: "Carla", email: "carla@x" },
    ];
  });

  it("'todos' (colaboradores 10 e 11) notifica os DOIS users (100 e 101) e mais ninguém", async () => {
    pendentesDoCron = [{ ...lembreteBase, destinatarioIds: [10, 11], canais: ["notificacao_app"] }];

    const r = await dispararLembretesAgenda();

    expect(r).toEqual({ total: 1, enviados: 2, erros: 0 });
    const users = criarNotificacao.mock.calls.map((c) => c[0].userId).sort();
    expect(users).toEqual([100, 101]);
  });

  it("a query filtra por colaboradores.id (o que o lembrete guarda), nunca por users.id", async () => {
    pendentesDoCron = [{ ...lembreteBase, destinatarioIds: [10, 11], canais: ["notificacao_app"] }];

    await dispararLembretesAgenda();

    const sel = captured.find((c) => c.op === "select" && c.table === "colaboradores");
    expect(sel, "esperava um select em colaboradores").toBeDefined();
    const { sql, params } = render(sel!.where);
    expect(sql).toMatch(/`colaboradores`\.`id` in \(\?, \?\)/);
    expect(sql).not.toMatch(/`colaboradores`\.`userId` in/);
    expect(params).toEqual([1, 10, 11]);
  });

  it("um destinatário só continua chegando", async () => {
    pendentesDoCron = [{ ...lembreteBase, destinatarioIds: [11], canais: ["notificacao_app"] }];

    const r = await dispararLembretesAgenda();

    expect(r.enviados).toBe(1);
    expect(criarNotificacao.mock.calls.map((c) => c[0].userId)).toEqual([101]);
  });

  it("linha legada (sem destinatarioIds/canais) cai no responsável pelo tipo", async () => {
    pendentesDoCron = [{ ...lembreteBase, destinatarioIds: null, canais: null }];

    const r = await dispararLembretesAgenda();

    expect(r.enviados).toBe(1);
    expect(criarNotificacao.mock.calls.map((c) => c[0].userId)).toEqual([100]);
  });

  it("marca enviado ANTES de despachar e a mensagem leva o título", async () => {
    pendentesDoCron = [{ ...lembreteBase, destinatarioIds: [10, 11], canais: ["notificacao_app"] }];

    await dispararLembretesAgenda();

    const iUpdate = captured.findIndex((c) => c.op === "update" && c.table === "agendamento_lembretes");
    const iColab = captured.findIndex((c) => c.op === "select" && c.table === "colaboradores");
    expect(iUpdate).toBeGreaterThanOrEqual(0);
    expect(iUpdate).toBeLessThan(iColab);
    expect(criarNotificacao.mock.calls[0][0].titulo).toContain("Reunião de equipe");
  });

  it("só lê lembrete com dispararEm preenchido — é por isso que o (1) importa", async () => {
    await dispararLembretesAgenda();
    const sel = captured.find((c) => c.op === "select" && c.table === "agendamento_lembretes");
    expect(sel).toBeDefined();
    expect(render(sel!.where).sql).toMatch(/`agendamento_lembretes`\.`dispararEm` is not null/);
  });
});
