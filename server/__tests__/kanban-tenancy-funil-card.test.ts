/**
 * Cruzamento entre escritórios no Kanban — deletarFunil, criarCard, editarCard.
 *
 * Os três recebiam ids soltos do client e só parte do caminho conferia o
 * escritório: deletarFunil apagava colunas e cards de funil ALHEIO (só o
 * delete do funil em si era escopado); criarCard/editarCard aceitavam
 * `clienteId`/`responsavelId` de outro escritório — o card exibia contato
 * alheio e a notificação de atribuição ia pro colaborador de lá.
 *
 * O banco falso aqui AVALIA o `where` contra linhas em memória. Um mock que
 * devolve fila fixa não enxerga a diferença entre "buscou por id" e "buscou
 * por id + escritório" — e é exatamente essa diferença que está em teste.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

type Linha = Record<string, any>;

const NOME = Symbol.for("drizzle:Name");
const COLUNAS = Symbol.for("drizzle:Columns");

const banco: Record<string, Linha[]> = {};
let proximoId = 1000;

const capturado = {
  selects: [] as { tabela: string; conds: Cond[] }[],
  inserts: [] as { table: string; values: any }[],
  updates: [] as { table: string; set: any; ids: number[] }[],
  deletes: [] as { table: string; ids: number[] }[],
};

function nomeTabela(t: any): string {
  return (t?.[NOME] as string) || "";
}

type Ref = { tabela: string; chave: string };

function ehColuna(x: any): boolean {
  return !!x && typeof x === "object" && "columnType" in x && x.table !== undefined;
}

function refColuna(col: any): Ref {
  const cols = col.table[COLUNAS] as Record<string, unknown>;
  const chave = Object.keys(cols).find((k) => cols[k] === col) ?? col.name;
  return { tabela: nomeTabela(col.table), chave };
}

type Token = { col: Ref } | { op: string } | { valor: unknown } | { lista: unknown[] };

function tokens(no: any, out: Token[] = []): Token[] {
  if (no === null || no === undefined) return out;
  if (Array.isArray(no)) {
    if (no.length && no.every((p) => p?.constructor?.name === "Param")) {
      out.push({ lista: no.map((p) => p.value) });
      return out;
    }
    for (const n of no) tokens(n, out);
    return out;
  }
  const ctor = no.constructor?.name;
  if (ctor === "SQL") return tokens(no.queryChunks, out);
  if (ctor === "StringChunk") {
    const s = (no.value as string[]).join("").trim();
    if (s && s !== "(" && s !== ")") out.push({ op: s });
    return out;
  }
  if (ctor === "Param") {
    out.push({ valor: no.value });
    return out;
  }
  if (ehColuna(no)) {
    out.push({ col: refColuna(no) });
    return out;
  }
  return out;
}

type Cond = { esq: Ref; op: string; dir: Token };

function condicoes(where: unknown): Cond[] {
  const ts = tokens(where);
  const conds: Cond[] = [];
  for (let i = 0; i + 2 < ts.length; i++) {
    const a = ts[i], b = ts[i + 1], c = ts[i + 2];
    if ("col" in a && "op" in b && !("op" in c)) {
      conds.push({ esq: a.col, op: b.op, dir: c });
      i += 2;
    }
  }
  return conds;
}

type LinhaJ = Record<string, Linha>;

function valorDe(l: LinhaJ, r: Ref): unknown {
  return l[r.tabela]?.[r.chave];
}

function satisfaz(l: LinhaJ, conds: Cond[]): boolean {
  return conds.every((c) => {
    const v = valorDe(l, c.esq);
    if ("col" in c.dir) {
      if (c.op !== "=") throw new Error(`operador não suportado no join: ${c.op}`);
      return v === valorDe(l, c.dir.col);
    }
    if (c.op === "=") return "valor" in c.dir && v === c.dir.valor;
    if (c.op === "in") return "lista" in c.dir && c.dir.lista.includes(v);
    throw new Error(`operador não suportado: ${c.op}`);
  });
}

function linhasDe(tabela: string): Linha[] {
  return banco[tabela] ?? (banco[tabela] = []);
}

function makeDb() {
  function builder(campos: Record<string, any> | undefined): any {
    let origem = "";
    const joins: { tabela: string; conds: Cond[] }[] = [];
    let conds: Cond[] = [];

    function executar(): Linha[] {
      capturado.selects.push({ tabela: origem, conds });
      let atuais: LinhaJ[] = linhasDe(origem).map((l) => ({ [origem]: l }));
      for (const j of joins) {
        const proximas: LinhaJ[] = [];
        for (const a of atuais) {
          for (const l of linhasDe(j.tabela)) {
            const cand = { ...a, [j.tabela]: l };
            if (satisfaz(cand, j.conds)) proximas.push(cand);
          }
        }
        atuais = proximas;
      }
      const filtradas = atuais.filter((l) => satisfaz(l, conds));
      if (!campos) return filtradas.map((l) => ({ ...l[origem] }));
      return filtradas.map((l) => {
        const out: Linha = {};
        for (const [k, col] of Object.entries(campos)) out[k] = valorDe(l, refColuna(col));
        return out;
      });
    }

    const b: any = {
      from: (t: any) => { origem = nomeTabela(t); return b; },
      innerJoin: (t: any, cond: unknown) => { joins.push({ tabela: nomeTabela(t), conds: condicoes(cond) }); return b; },
      leftJoin: (t: any, cond: unknown) => { joins.push({ tabela: nomeTabela(t), conds: condicoes(cond) }); return b; },
      where: (w: unknown) => { conds = condicoes(w); return b; },
      orderBy: () => b,
      groupBy: () => b,
      limit: (n: number) => Promise.resolve().then(() => executar().slice(0, n)),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve().then(executar).then(res, rej),
    };
    return b;
  }

  return {
    select: (campos?: Record<string, any>) => builder(campos),
    insert: (t: any) => ({
      values: (v: Linha) => {
        const tabela = nomeTabela(t);
        const id = proximoId++;
        linhasDe(tabela).push({ id, ...v });
        capturado.inserts.push({ table: tabela, values: v });
        return Promise.resolve([{ insertId: id }]);
      },
    }),
    update: (t: any) => ({
      set: (s: Linha) => ({
        where: (w: unknown) => {
          const tabela = nomeTabela(t);
          const conds = condicoes(w);
          const alvos = linhasDe(tabela).filter((l) => satisfaz({ [tabela]: l }, conds));
          for (const l of alvos) Object.assign(l, s);
          capturado.updates.push({ table: tabela, set: s, ids: alvos.map((l) => l.id) });
          return Promise.resolve([{ affectedRows: alvos.length }]);
        },
      }),
    }),
    delete: (t: any) => ({
      where: (w: unknown) => {
        const tabela = nomeTabela(t);
        const conds = condicoes(w);
        const alvos = linhasDe(tabela).filter((l) => satisfaz({ [tabela]: l }, conds));
        banco[tabela] = linhasDe(tabela).filter((l) => !alvos.includes(l));
        capturado.deletes.push({ table: tabela, ids: alvos.map((l) => l.id) });
        return Promise.resolve([{ affectedRows: alvos.length }]);
      },
    }),
  };
}

const dbInstance = makeDb();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbInstance),
}));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc Teste", fusoHorario: "America/Sao_Paulo" },
    colaborador: { id: 10, cargo: "dono" },
  })),
}));

vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async () => ({
    allowed: true, verTodos: true, verProprios: false,
    criar: true, editar: true, excluir: true,
    colaboradorId: 10, escritorioId: 1, cargo: "dono",
  })),
}));

const notificarMock = vi.fn(async () => {});
vi.mock("../escritorio/notificar-card-kanban", () => ({
  notificarCardAtribuido: (...a: unknown[]) => (notificarMock as any)(...a),
}));

const { appRouter } = await import("../routers");

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

function caller() {
  return appRouter.createCaller(fakeCtx());
}

// Escritório 1 = o do operador. Escritório 2 = alheio.
function semear() {
  for (const k of Object.keys(banco)) delete banco[k];
  banco["kanban_funis"] = [
    { id: 1, escritorioId: 1, nome: "Meu funil", prazoPadraoDias: 15 },
    { id: 2, escritorioId: 2, nome: "Funil alheio", prazoPadraoDias: 15 },
    { id: 3, escritorioId: 1, nome: "Meu funil vazio", prazoPadraoDias: 15 },
  ];
  banco["kanban_colunas"] = [
    { id: 11, funilId: 1, nome: "Entrada", ordem: 1 },
    { id: 12, funilId: 1, nome: "Feito", ordem: 2 },
    { id: 21, funilId: 2, nome: "Entrada alheia", ordem: 1 },
  ];
  banco["kanban_cards"] = [
    { id: 101, escritorioId: 1, colunaId: 11, titulo: "Card A", responsavelId: 10, clienteId: null, tags: null, ordem: 1 },
    { id: 102, escritorioId: 1, colunaId: 12, titulo: "Card B", responsavelId: null, clienteId: null, tags: null, ordem: 1 },
    { id: 201, escritorioId: 2, colunaId: 21, titulo: "Card alheio", responsavelId: 20, clienteId: null, tags: null, ordem: 1 },
    // Card de OUTRO escritório apontando pra coluna minha: é a linha que o
    // filtro de escritório na busca de cards existe pra deixar em paz.
    { id: 999, escritorioId: 2, colunaId: 11, titulo: "Card perdido", responsavelId: 20, clienteId: null, tags: null, ordem: 2 },
  ];
  banco["kanban_movimentacoes"] = [
    { id: 1, cardId: 101 },
    { id: 2, cardId: 201 },
    { id: 3, cardId: 999 },
  ];
  banco["kanban_responsavel_log"] = [
    { id: 1, cardId: 101 },
    { id: 2, cardId: 999 },
  ];
  banco["kanban_comentarios"] = [
    { id: 1, cardId: 102 },
    { id: 2, cardId: 999 },
  ];
  banco["contatos"] = [
    { id: 50, escritorioId: 1, nome: "Cliente meu", tags: null },
    { id: 60, escritorioId: 2, nome: "Cliente alheio", tags: null },
  ];
  banco["colaboradores"] = [
    { id: 10, escritorioId: 1, userId: 100 },
    { id: 11, escritorioId: 1, userId: 101 },
    { id: 20, escritorioId: 2, userId: 200 },
  ];
}

const idsApagados = (tabela: string) =>
  capturado.deletes.filter((d) => d.table === tabela).flatMap((d) => d.ids);

// O middleware do protectedProcedure também lê `colaboradores` (por userId),
// então "não consultou a tabela" precisa olhar a coluna do filtro.
const consultou = (tabela: string, chave: string) =>
  capturado.selects.some(
    (s) => s.tabela === tabela && s.conds.some((c) => c.esq.tabela === tabela && c.esq.chave === chave),
  );

beforeEach(() => {
  semear();
  capturado.selects = [];
  capturado.inserts = [];
  capturado.updates = [];
  capturado.deletes = [];
  notificarMock.mockClear();
});

describe("kanban.deletarFunil", () => {
  it("funil de outro escritório: NOT_FOUND e NENHUM delete", async () => {
    await expect(caller().kanban.deletarFunil({ id: 2 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Funil não encontrado.",
    });
    expect(capturado.deletes).toEqual([]);
    expect(banco["kanban_funis"].map((f) => f.id)).toEqual([1, 2, 3]);
    expect(banco["kanban_colunas"].map((c) => c.id)).toEqual([11, 12, 21]);
    expect(banco["kanban_cards"].map((c) => c.id)).toEqual([101, 102, 201, 999]);
  });

  it("funil inexistente: NOT_FOUND", async () => {
    await expect(caller().kanban.deletarFunil({ id: 777 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(capturado.deletes).toEqual([]);
  });

  it("funil próprio: apaga satélites, cards, colunas e o funil — só do escritório", async () => {
    const r = await caller().kanban.deletarFunil({ id: 1 });

    expect(r).toEqual({ success: true, cardsExcluidos: 2 });
    expect(idsApagados("kanban_cards").sort()).toEqual([101, 102]);
    expect(idsApagados("kanban_movimentacoes")).toEqual([1]);
    expect(idsApagados("kanban_responsavel_log")).toEqual([1]);
    expect(idsApagados("kanban_comentarios")).toEqual([1]);
    expect(idsApagados("kanban_colunas").sort()).toEqual([11, 12]);
    expect(idsApagados("kanban_funis")).toEqual([1]);

    // O card alheio que apontava pra coluna minha fica de pé, com histórico.
    expect(banco["kanban_cards"].map((c) => c.id)).toEqual([201, 999]);
    expect(banco["kanban_movimentacoes"].map((m) => m.id)).toEqual([2, 3]);
    expect(banco["kanban_responsavel_log"].map((m) => m.id)).toEqual([2]);
    expect(banco["kanban_comentarios"].map((m) => m.id)).toEqual([2]);
  });

  it("satélites saem ANTES dos cards, e os cards antes das colunas", () => {
    return caller().kanban.deletarFunil({ id: 1 }).then(() => {
      const ordem = capturado.deletes.map((d) => d.table);
      expect(ordem).toEqual([
        "kanban_movimentacoes",
        "kanban_responsavel_log",
        "kanban_comentarios",
        "kanban_cards",
        "kanban_colunas",
        "kanban_funis",
      ]);
    });
  });

  it("funil sem colunas: só o funil sai, sem consultar cards", async () => {
    const r = await caller().kanban.deletarFunil({ id: 3 });
    expect(r).toEqual({ success: true, cardsExcluidos: 0 });
    expect(consultou("kanban_cards", "colunaId")).toBe(false);
    expect(idsApagados("kanban_funis")).toEqual([3]);
    expect(idsApagados("kanban_cards")).toEqual([]);
  });
});

describe("kanban.criarCard", () => {
  it("coluna de outro escritório: NOT_FOUND e nenhum insert", async () => {
    await expect(
      caller().kanban.criarCard({ colunaId: 21, titulo: "Intruso" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Coluna não encontrada." });
    expect(capturado.inserts).toEqual([]);
    expect(notificarMock).not.toHaveBeenCalled();
  });

  it("coluna inexistente: NOT_FOUND", async () => {
    await expect(
      caller().kanban.criarCard({ colunaId: 555, titulo: "Intruso" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(capturado.inserts).toEqual([]);
  });

  it("clienteId de outro escritório: NOT_FOUND, nenhum insert, nenhuma tag gravada", async () => {
    await expect(
      caller().kanban.criarCard({ colunaId: 11, titulo: "Intruso", clienteId: 60, tags: "vip" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Cliente não encontrado." });
    expect(capturado.inserts).toEqual([]);
    expect(capturado.updates).toEqual([]);
    expect(notificarMock).not.toHaveBeenCalled();
  });

  it("responsavelId de outro escritório: NOT_FOUND e ninguém notificado", async () => {
    await expect(
      caller().kanban.criarCard({ colunaId: 11, titulo: "Intruso", responsavelId: 20 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Responsável não encontrado neste escritório." });
    expect(capturado.inserts).toEqual([]);
    expect(notificarMock).not.toHaveBeenCalled();
  });

  it("caso feliz: cliente e responsável do escritório", async () => {
    const r = await caller().kanban.criarCard({
      colunaId: 11, titulo: "Novo", clienteId: 50, responsavelId: 11,
    });

    expect(r.id).toBeGreaterThan(0);
    const ins = capturado.inserts.filter((i) => i.table === "kanban_cards");
    expect(ins).toHaveLength(1);
    expect(ins[0].values).toMatchObject({
      escritorioId: 1, colunaId: 11, titulo: "Novo", clienteId: 50, responsavelId: 11,
    });
    expect(notificarMock).toHaveBeenCalledWith(expect.objectContaining({
      cardId: r.id, responsavelColaboradorId: 11, acao: "criado",
    }));
  });

  it("sem cliente nem responsável: cai no criador, sem consultar contatos/colaboradores", async () => {
    const r = await caller().kanban.criarCard({ colunaId: 11, titulo: "Só título" });

    expect(r.id).toBeGreaterThan(0);
    const ins = capturado.inserts.filter((i) => i.table === "kanban_cards");
    expect(ins[0].values).toMatchObject({ escritorioId: 1, colunaId: 11, clienteId: null, responsavelId: 10 });
    expect(consultou("contatos", "id")).toBe(false);
    expect(consultou("colaboradores", "id")).toBe(false);
  });
});

describe("kanban.editarCard", () => {
  it("clienteId de outro escritório: NOT_FOUND e nenhum update", async () => {
    await expect(
      caller().kanban.editarCard({ id: 101, clienteId: 60, titulo: "Mudou" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Cliente não encontrado." });
    expect(capturado.updates).toEqual([]);
    expect(banco["kanban_cards"].find((c) => c.id === 101)).toMatchObject({ titulo: "Card A", clienteId: null });
  });

  it("responsavelId de outro escritório: NOT_FOUND, nenhum update, nenhum log, ninguém notificado", async () => {
    await expect(
      caller().kanban.editarCard({ id: 101, responsavelId: 20 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Responsável não encontrado neste escritório." });
    expect(capturado.updates).toEqual([]);
    expect(capturado.inserts).toEqual([]);
    expect(notificarMock).not.toHaveBeenCalled();
    expect(banco["kanban_cards"].find((c) => c.id === 101)?.responsavelId).toBe(10);
  });

  it("responsavelId null continua aceito (remove o responsável)", async () => {
    const r = await caller().kanban.editarCard({ id: 101, responsavelId: null });

    expect(r).toEqual({ success: true });
    const upd = capturado.updates.filter((u) => u.table === "kanban_cards");
    expect(upd).toHaveLength(1);
    expect(upd[0].set).toEqual({ responsavelId: null });
    expect(upd[0].ids).toEqual([101]);
    const log = capturado.inserts.filter((i) => i.table === "kanban_responsavel_log");
    expect(log).toHaveLength(1);
    expect(log[0].values).toMatchObject({ cardId: 101, responsavelAnteriorId: 10, responsavelNovoId: null });
    expect(notificarMock).not.toHaveBeenCalled();
    expect(consultou("colaboradores", "id")).toBe(false);
  });

  it("caso feliz: cliente e responsável do escritório", async () => {
    const r = await caller().kanban.editarCard({ id: 101, clienteId: 50, responsavelId: 11, titulo: "Novo" });

    expect(r).toEqual({ success: true });
    const upd = capturado.updates.filter((u) => u.table === "kanban_cards");
    expect(upd).toHaveLength(1);
    expect(upd[0].set).toEqual({ titulo: "Novo", clienteId: 50, responsavelId: 11 });
    expect(upd[0].ids).toEqual([101]);
    expect(notificarMock).toHaveBeenCalledWith(expect.objectContaining({
      cardId: 101, responsavelColaboradorId: 11, acao: "atribuido", tituloCard: "Novo",
    }));
  });

  it("campo ausente não mexe e não consulta contatos/colaboradores", async () => {
    const r = await caller().kanban.editarCard({ id: 101, titulo: "Só título" });

    expect(r).toEqual({ success: true });
    const upd = capturado.updates.filter((u) => u.table === "kanban_cards");
    expect(upd[0].set).toEqual({ titulo: "Só título" });
    expect(consultou("contatos", "id")).toBe(false);
    expect(consultou("colaboradores", "id")).toBe(false);
    expect(capturado.inserts).toEqual([]);
  });

  it("card de outro escritório não é alterado mesmo com cliente e responsável válidos", async () => {
    const r = await caller().kanban.editarCard({ id: 201, clienteId: 50, responsavelId: 11 });

    expect(r).toEqual({ success: true });
    const upd = capturado.updates.filter((u) => u.table === "kanban_cards");
    expect(upd).toHaveLength(1);
    expect(upd[0].ids).toEqual([]);
    expect(banco["kanban_cards"].find((c) => c.id === 201)).toMatchObject({ clienteId: null, responsavelId: 20 });
    expect(notificarMock).not.toHaveBeenCalled();
  });
});
