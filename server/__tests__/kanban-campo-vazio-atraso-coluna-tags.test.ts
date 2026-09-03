/**
 * Quatro coisas do Kanban que enganavam quem usa:
 *
 *   · kanban-4  — limpar CNJ/descrição/prazo/última tag no painel não salvava,
 *                 mas o toast dizia "atualizado" (o client mandava undefined).
 *   · kanban-6  — a flag `atrasado` só era LIGADA pelo cron; mudar o prazo ou
 *                 concluir o card deixava o "⚠ Atrasado" pra sempre.
 *   · kanban-7  — "Excluir coluna" contava a lista filtrada da tela e
 *                 prometia "nenhum card será afetado" com arquivados na coluna.
 *   · kanban-8  — a lixeira do card apagava na hora, sem pergunta.
 *   · kanban-12 — criar card com tag pra cliente vinculado SOBRESCREVIA as
 *                 tags do cadastro (e de todos os cards dele).
 *
 * O banco falso avalia o `where` contra linhas em memória, como no teste de
 * tenancy do Kanban — é a única forma de ver a diferença entre "atualizou o
 * card certo" e "atualizou algum card".
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { TrpcContext } from "../_core/context";
import { unirTags, listarTags } from "../../shared/kanban-tags";
import { colunaVizinha } from "../escritorio/kanban-filtros";

type Linha = Record<string, any>;

const NOME = Symbol.for("drizzle:Name");
const COLUNAS = Symbol.for("drizzle:Columns");

const banco: Record<string, Linha[]> = {};
let proximoId = 1000;

const capturado = {
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
    escritorio: { id: 1, nome: "Esc Teste", fusoHorario: "America/Fortaleza" },
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

vi.mock("../escritorio/notificar-card-kanban", () => ({
  notificarCardAtribuido: vi.fn(async () => {}),
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

const caller = () => appRouter.createCaller(fakeCtx());

/** 10/09/2026 12:00 em Fortaleza. Prazo de 09/09 venceu; 10/09 ainda é hoje. */
const MEIO_DIA_DE_10 = new Date("2026-09-10T15:00:00Z");
const PRAZO_VENCIDO = new Date("2026-09-01T12:00:00Z");

// Escritório 1 = o do operador. Escritório 2 = alheio.
function semear() {
  for (const k of Object.keys(banco)) delete banco[k];
  banco["escritorios"] = [{ id: 1, fusoHorario: "America/Fortaleza" }];
  banco["kanban_funis"] = [
    { id: 1, escritorioId: 1, nome: "Meu funil", prazoPadraoDias: 15 },
    { id: 2, escritorioId: 2, nome: "Funil alheio", prazoPadraoDias: 15 },
    { id: 3, escritorioId: 1, nome: "Funil de coluna única", prazoPadraoDias: 15 },
  ];
  banco["kanban_colunas"] = [
    { id: 11, funilId: 1, nome: "Entrada", ordem: 1, tipo: "normal" },
    { id: 12, funilId: 1, nome: "Em negociação", ordem: 2, tipo: "normal" },
    { id: 13, funilId: 1, nome: "Concluído", ordem: 3, tipo: "conclusao" },
    { id: 21, funilId: 2, nome: "Entrada alheia", ordem: 1, tipo: "normal" },
    { id: 31, funilId: 3, nome: "Única", ordem: 1, tipo: "normal" },
  ];
  banco["kanban_cards"] = [
    { id: 101, escritorioId: 1, colunaId: 11, titulo: "Card A", responsavelId: 10, clienteId: null, tags: "antiga", prazo: null, atrasado: false, arquivado: false, ordem: 1 },
    { id: 102, escritorioId: 1, colunaId: 12, titulo: "Card B", responsavelId: 10, clienteId: null, tags: null, prazo: PRAZO_VENCIDO, atrasado: true, arquivado: false, ordem: 1 },
    { id: 103, escritorioId: 1, colunaId: 12, titulo: "Card C (arquivado)", responsavelId: 10, clienteId: null, tags: null, prazo: null, atrasado: false, arquivado: true, ordem: 2 },
    { id: 104, escritorioId: 1, colunaId: 12, titulo: "Card D (arquivado)", responsavelId: 10, clienteId: null, tags: null, prazo: null, atrasado: false, arquivado: true, ordem: 3 },
    { id: 105, escritorioId: 1, colunaId: 13, titulo: "Card E (concluído)", responsavelId: 10, clienteId: null, tags: null, prazo: PRAZO_VENCIDO, atrasado: false, arquivado: false, ordem: 1 },
    { id: 106, escritorioId: 1, colunaId: 31, titulo: "Card F (funil único)", responsavelId: 10, clienteId: null, tags: null, prazo: null, atrasado: false, arquivado: false, ordem: 1 },
    { id: 201, escritorioId: 2, colunaId: 21, titulo: "Card alheio", responsavelId: 20, clienteId: null, tags: null, prazo: null, atrasado: false, arquivado: false, ordem: 1 },
    // Card de OUTRO escritório apontando pra coluna minha: a contagem e a
    // exclusão não podem tocar nele.
    { id: 999, escritorioId: 2, colunaId: 12, titulo: "Card perdido", responsavelId: 20, clienteId: null, tags: null, prazo: null, atrasado: false, arquivado: false, ordem: 9 },
  ];
  banco["kanban_movimentacoes"] = [];
  banco["kanban_responsavel_log"] = [];
  banco["kanban_comentarios"] = [];
  banco["contatos"] = [
    { id: 50, escritorioId: 1, nome: "Ana Beatriz", tags: "Trabalhista, VIP" },
    { id: 51, escritorioId: 1, nome: "Sem tag", tags: null },
  ];
  banco["colaboradores"] = [
    { id: 10, escritorioId: 1, userId: 100 },
    { id: 20, escritorioId: 2, userId: 200 },
  ];
}

const card = (id: number) => banco["kanban_cards"].find((c) => c.id === id)!;
const updatesDe = (tabela: string) => capturado.updates.filter((u) => u.table === tabela);
const idsApagados = (tabela: string) =>
  capturado.deletes.filter((d) => d.table === tabela).flatMap((d) => d.ids);

beforeEach(() => {
  semear();
  capturado.inserts = [];
  capturado.updates = [];
  capturado.deletes = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MEIO_DIA_DE_10);
});

afterEach(() => {
  vi.useRealTimers();
});

const raiz = join(__dirname, "..", "..");
const tela = readFileSync(join(raiz, "client/src/pages/Kanban.tsx"), "utf8");
const cron = readFileSync(join(raiz, "server/_core/cron-jobs.ts"), "utf8");

// ─── kanban-4 · limpar campo grava vazio ─────────────────────────────────────

describe("kanban-4 · esvaziar um campo no painel grava vazio", () => {
  it("CNJ vazio vira null (antes o servidor ignorava e o toast dizia 'atualizado')", async () => {
    await caller().kanban.editarCard({ id: 101, cnj: "" });
    expect(updatesDe("kanban_cards")).toEqual([{ table: "kanban_cards", set: { cnj: null }, ids: [101] }]);
  });

  it("descrição vazia vira null", async () => {
    await caller().kanban.editarCard({ id: 101, descricao: "" });
    expect(updatesDe("kanban_cards")[0].set).toEqual({ descricao: null });
  });

  it("tirar a última tag de card sem cliente grava null", async () => {
    await caller().kanban.editarCard({ id: 101, tags: "" });
    expect(updatesDe("kanban_cards")[0].set).toEqual({ tags: null });
    expect(card(101).tags).toBeNull();
  });

  it("prazo null é aceito e limpa o prazo e o atraso", async () => {
    await caller().kanban.editarCard({ id: 102, prazo: null });
    expect(updatesDe("kanban_cards")[0].set).toEqual({ prazo: null, atrasado: false });
  });

  it("a tela manda o valor cru, não `|| undefined`", () => {
    const painel = tela.slice(tela.indexOf('<p className="text-[10px] font-semibold text-muted-foreground">EDITAR</p>'));
    expect(painel).toContain("editarCardMut.mutate({ id: cardDetalhe.id, cnj: e.target.value })");
    expect(painel).toContain("editarCardMut.mutate({ id: cardDetalhe.id, descricao: e.target.value })");
    expect(painel).toContain("editarCardMut.mutate({ id: cardDetalhe.id, prazo: e.target.value || null })");
    expect(painel).toContain('editarCardMut.mutate({ id: cardDetalhe.id, tags: novas.join(", ") })');
    expect(painel).not.toContain("cnj: e.target.value || undefined");
    expect(painel).not.toContain("prazo: e.target.value || undefined");
    expect(painel).not.toContain('tags: novas.join(", ") || undefined');
    expect(painel).not.toContain("descricao: e.target.value || undefined");
  });
});

// ─── kanban-6 · atraso acompanha prazo e conclusão ───────────────────────────

describe("kanban-6 · 'atrasado' acompanha o prazo e a conclusão", () => {
  it("estender o prazo pro futuro desliga a flag que o cron ligou", async () => {
    await caller().kanban.editarCard({ id: 102, prazo: "2026-09-11" });
    const set = updatesDe("kanban_cards")[0].set;
    expect(set.atrasado).toBe(false);
    expect(set.prazo.toISOString()).toBe("2026-09-11T12:00:00.000Z");
    expect(card(102).atrasado).toBe(false);
  });

  it("prazo de hoje ainda não é atraso (o dia inteiro é do usuário)", async () => {
    await caller().kanban.editarCard({ id: 102, prazo: "2026-09-10" });
    expect(updatesDe("kanban_cards")[0].set.atrasado).toBe(false);
  });

  it("prazo de ontem liga a flag na hora, sem esperar o cron", async () => {
    await caller().kanban.editarCard({ id: 101, prazo: "2026-09-09" });
    expect(updatesDe("kanban_cards")[0].set.atrasado).toBe(true);
  });

  it("card em coluna de conclusão não atrasa, mesmo com prazo vencido", async () => {
    await caller().kanban.editarCard({ id: 105, prazo: "2026-09-01" });
    expect(updatesDe("kanban_cards")[0].set.atrasado).toBe(false);
  });

  it("mover pra coluna de conclusão limpa o atraso", async () => {
    await caller().kanban.moverCard({ cardId: 102, colunaDestinoId: 13 });
    const up = updatesDe("kanban_cards")[0];
    expect(up.ids).toEqual([102]);
    expect(up.set).toMatchObject({ colunaId: 13, atrasado: false });
    expect(card(102).atrasado).toBe(false);
  });

  it("voltar da conclusão pra coluna normal recalcula pelo prazo", async () => {
    await caller().kanban.moverCard({ cardId: 105, colunaDestinoId: 12 });
    expect(updatesDe("kanban_cards")[0].set).toMatchObject({ colunaId: 12, atrasado: true });
  });

  it("coluna de destino de outro escritório: NOT_FOUND e nada muda", async () => {
    await expect(caller().kanban.moverCard({ cardId: 101, colunaDestinoId: 21 }))
      .rejects.toMatchObject({ code: "NOT_FOUND", message: "Coluna não encontrada." });
    expect(capturado.updates).toEqual([]);
    expect(card(101).colunaId).toBe(11);
  });

  it("o cron deixa as colunas de conclusão de fora", () => {
    const i = cron.indexOf("export async function verificarPrazosKanban");
    const corpo = cron.slice(i, cron.indexOf("\n}\n", i));
    expect(corpo).toContain("NOT IN (SELECT ${kanbanColunas.id} FROM ${kanbanColunas} WHERE ${kanbanColunas.tipo} = 'conclusao')");
  });

  it("o quadro não pinta de atrasado o card que está na coluna de conclusão", () => {
    expect(tela).toContain('const isAtrasado = col.tipo !== "conclusao"');
  });
});

// ─── kanban-7 · contagem real ao excluir coluna ──────────────────────────────

describe("kanban-7 · excluir coluna conta no servidor, sem filtro", () => {
  it("conta todos os cards da coluna, arquivados inclusive — e só os do escritório", async () => {
    const r = await caller().kanban.previaExcluirColuna({ id: 12 });
    expect(r).toEqual({ total: 3, noQuadro: 1, arquivados: 2, destino: { id: 11, nome: "Entrada" } });
  });

  it("a coluna vizinha é a anterior; sem anterior, a seguinte", async () => {
    expect((await caller().kanban.previaExcluirColuna({ id: 11 })).destino).toEqual({ id: 12, nome: "Em negociação" });
    expect((await caller().kanban.previaExcluirColuna({ id: 13 })).destino).toEqual({ id: 12, nome: "Em negociação" });
  });

  it("funil de coluna única não tem onde guardar os arquivados", async () => {
    const r = await caller().kanban.previaExcluirColuna({ id: 31 });
    expect(r).toEqual({ total: 1, noQuadro: 1, arquivados: 0, destino: null });
  });

  it("coluna de outro escritório: NOT_FOUND", async () => {
    await expect(caller().kanban.previaExcluirColuna({ id: 21 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("modo 'arquivar': arquiva os que estavam no quadro, move todos pra vizinha, apaga só a coluna", async () => {
    const r = await caller().kanban.deletarColuna({ id: 12, modo: "arquivar" });

    expect(r).toEqual({ success: true, cardsExcluidos: 0, cardsArquivados: 3, movidosPara: "Entrada", coluna: "Em negociação" });
    expect(idsApagados("kanban_cards")).toEqual([]);
    expect(idsApagados("kanban_colunas")).toEqual([12]);

    const ups = updatesDe("kanban_cards");
    expect(ups[0].set).toMatchObject({ arquivado: true });
    expect(ups[0].ids).toEqual([102]);
    expect(ups[1].set).toEqual({ colunaId: 11 });
    expect(ups[1].ids.sort()).toEqual([102, 103, 104]);

    for (const id of [102, 103, 104]) expect(card(id)).toMatchObject({ arquivado: true, colunaId: 11 });
    // O card alheio que apontava pra coluna fica como estava.
    expect(card(999)).toMatchObject({ arquivado: false, colunaId: 12 });
  });

  it("modo 'arquivar' sem vizinha: PRECONDITION_FAILED e nada muda", async () => {
    await expect(caller().kanban.deletarColuna({ id: 31, modo: "arquivar" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(capturado.updates).toEqual([]);
    expect(capturado.deletes).toEqual([]);
  });

  it("modo padrão continua excluindo os cards — e diz quantos", async () => {
    const r = await caller().kanban.deletarColuna({ id: 12 });
    expect(r).toEqual({ success: true, cardsExcluidos: 3, cardsArquivados: 0, movidosPara: null, coluna: "Em negociação" });
    expect(idsApagados("kanban_cards").sort()).toEqual([102, 103, 104]);
    expect(card(999)).toBeDefined();
  });

  it("a tela não conta mais pela lista filtrada", () => {
    expect(tela).toContain("setColunaParaExcluir({ id: col.id, nome: col.nome })");
    expect(tela).not.toContain("cards: col.cards?.length");
    expect(tela).toContain("kanban.previaExcluirColuna.useQuery");
  });

  describe("colunaVizinha", () => {
    const cols = [
      { id: 3, ordem: 3 },
      { id: 1, ordem: 1 },
      { id: 2, ordem: 2 },
    ];
    it("anterior por ordem", () => expect(colunaVizinha(cols, 2)?.id).toBe(1));
    it("primeira: a seguinte", () => expect(colunaVizinha(cols, 1)?.id).toBe(2));
    it("última: a anterior", () => expect(colunaVizinha(cols, 3)?.id).toBe(2));
    it("única: null", () => expect(colunaVizinha([{ id: 9, ordem: 1 }], 9)).toBeNull());
    it("desconhecida: null", () => expect(colunaVizinha(cols, 77)).toBeNull());
  });
});

// ─── kanban-8 · lixeira do card pergunta antes ───────────────────────────────

describe("kanban-8 · a lixeira do card pergunta antes", () => {
  const trecho = (() => {
    const i = tela.indexOf('title="Excluir card"');
    expect(i, "o botão da lixeira do card sumiu").toBeGreaterThan(0);
    return tela.slice(i, i + 400);
  })();

  it("o clique abre o diálogo em vez de apagar", () => {
    expect(trecho).toContain("setCardParaExcluir({ id: card.id, titulo: card.titulo");
    expect(trecho).not.toContain("deletarCardMut.mutate");
  });

  it("o diálogo oferece Cancelar, Arquivar e Excluir", () => {
    const i = tela.indexOf("open={cardParaExcluir != null}");
    expect(i).toBeGreaterThan(0);
    const dialogo = tela.slice(i, tela.indexOf("</AlertDialog>", i));
    expect(dialogo).toContain("<AlertDialogCancel>Cancelar</AlertDialogCancel>");
    expect(dialogo).toContain("arquivarCardMut.mutate({ id: cardParaExcluir.id })");
    expect(dialogo).toContain("deletarCardMut.mutate({ id: cardParaExcluir.id })");
    expect(dialogo).toContain("O histórico e os comentários do card vão junto");
  });

  it("excluir avisa que excluiu", () => {
    const i = tela.indexOf("kanban.deletarCard.useMutation");
    expect(tela.slice(i, i + 200)).toContain('toast.success("Card excluído")');
  });
});

// ─── kanban-12 · tags do cliente são somadas, não substituídas ───────────────

describe("kanban-12 · criar card soma às tags do cadastro do cliente", () => {
  it("marcar 'Urgente' mantém 'Trabalhista, VIP' do cadastro", async () => {
    await caller().kanban.criarCard({ colunaId: 11, titulo: "Contestação", clienteId: 50, tags: "Urgente" });
    const up = updatesDe("contatos");
    expect(up).toHaveLength(1);
    expect(up[0].ids).toEqual([50]);
    expect(up[0].set).toEqual({ tags: "Trabalhista, VIP, Urgente" });
    const ins = capturado.inserts.find((i) => i.table === "kanban_cards")!;
    expect(ins.values.tags).toBeNull();
  });

  it("tag que o cliente já tem não duplica", async () => {
    await caller().kanban.criarCard({ colunaId: 11, titulo: "X", clienteId: 50, tags: "VIP" });
    expect(updatesDe("contatos")[0].set).toEqual({ tags: "Trabalhista, VIP" });
  });

  it("cliente sem tag recebe só as marcadas", async () => {
    await caller().kanban.criarCard({ colunaId: 11, titulo: "X", clienteId: 51, tags: "Urgente" });
    expect(updatesDe("contatos")[0].set).toEqual({ tags: "Urgente" });
  });

  it("o form já vem com as tags do cliente escolhido", () => {
    expect(tela).toContain("setCardForm({ ...cardForm, tags: unirTags(cardForm.tags, c.tags) ?? \"\" })");
  });

  describe("unirTags", () => {
    it("gravadas primeiro, novas depois, sem repetir", () => {
      expect(unirTags("Trabalhista, VIP", "Urgente, VIP")).toBe("Trabalhista, VIP, Urgente");
    });
    it("espaços e vazios são ignorados", () => {
      expect(unirTags(" A ,, B ", "")).toBe("A, B");
      expect(listarTags(" A ,, B ")).toEqual(["A", "B"]);
    });
    it("nada em nenhum dos lados: null", () => {
      expect(unirTags(null, undefined)).toBeNull();
      expect(unirTags("", " , ")).toBeNull();
    });
  });
});
