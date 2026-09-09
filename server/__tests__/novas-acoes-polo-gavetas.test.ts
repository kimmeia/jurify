/**
 * Novas Ações separadas por polo (pedido do dono, 04/09).
 *
 * O print dele: uma ação que o PRÓPRIO escritório ajuizou apareceu como
 * "Novo" e "Polo não identificado". O robô já calava quando confirmava o
 * autor — mas o TJCE escreveu a parte como "NOME - CPF: 810.665.623-34
 * (AUTOR)", tudo numa célula, e o matcher só olhava o campo de documento.
 * Sem confirmar, fez o combinado pra "não sei": alertou.
 *
 * Três coisas mudam, e cada uma tem amarra aqui:
 *   · o polo do cliente vira coluna própria e três gavetas na aba
 *     (passivo = alerta; ativo = só consulta; desconhecido = alguém decide);
 *   · o matcher passa a achar o documento escrito dentro do texto da parte;
 *   · a pessoa diz "Réu / Autor / Terceiro" com um clique, e o card muda
 *     de gaveta — só aquele card.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";
import {
  GAVETAS,
  POLOS_DA_GAVETA,
  contaComoAlerta,
  documentosNoTexto,
  gavetaDoPolo,
  normalizarOab,
  textoMencionaOab,
} from "../../shared/nova-acao-polo";
import { identificarPoloDoCliente } from "../processos/polo-matcher";
import { lerCapaNovaAcao, montarCapaNovaAcao } from "../../shared/nova-acao-capa";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

// ─── Banco falso que avalia o where (mesmo desenho dos testes de tenancy) ────

type Linha = Record<string, any>;
const NOME = Symbol.for("drizzle:Name");
const COLUNAS = Symbol.for("drizzle:Columns");
const banco: Record<string, Linha[]> = {};
const capturado = { updates: [] as { table: string; set: any; ids: number[] }[] };

function nomeTabela(t: any): string { return (t?.[NOME] as string) || ""; }
type Ref = { tabela: string; chave: string };
function ehColuna(x: any): boolean { return !!x && typeof x === "object" && "columnType" in x && x.table !== undefined; }
function refColuna(col: any): Ref {
  const cols = col.table[COLUNAS] as Record<string, unknown>;
  const chave = Object.keys(cols).find((k) => cols[k] === col) ?? col.name;
  return { tabela: nomeTabela(col.table), chave };
}
type Token = { col: Ref } | { op: string } | { valor: unknown } | { lista: unknown[] };
function tokens(no: any, out: Token[] = []): Token[] {
  if (no === null || no === undefined) return out;
  if (Array.isArray(no)) {
    if (no.length && no.every((p) => p?.constructor?.name === "Param")) { out.push({ lista: no.map((p) => p.value) }); return out; }
    for (const n of no) tokens(n, out);
    return out;
  }
  const ctor = no.constructor?.name;
  if (ctor === "SQL") return tokens(no.queryChunks, out);
  if (ctor === "StringChunk") { const s = (no.value as string[]).join("").trim(); if (s && s !== "(" && s !== ")") out.push({ op: s }); return out; }
  if (ctor === "Param") { out.push({ valor: no.value }); return out; }
  if (ehColuna(no)) { out.push({ col: refColuna(no) }); return out; }
  return out;
}
type Cond = { esq: Ref; op: string; dir: Token };
function condicoes(where: unknown): Cond[] {
  const ts = tokens(where); const conds: Cond[] = [];
  for (let i = 0; i + 2 < ts.length; i++) {
    const a = ts[i], b = ts[i + 1], c = ts[i + 2];
    if ("col" in a && "op" in b && !("op" in c)) { conds.push({ esq: a.col, op: b.op, dir: c }); i += 2; }
  }
  return conds;
}
function satisfaz(l: Record<string, Linha>, conds: Cond[]): boolean {
  return conds.every((c) => {
    const v = l[c.esq.tabela]?.[c.esq.chave];
    if ("col" in c.dir) return v === l[c.dir.col.tabela]?.[c.dir.col.chave];
    if (c.op === "=") return "valor" in c.dir && v === c.dir.valor;
    if (c.op === "in") return "lista" in c.dir && c.dir.lista.includes(v);
    throw new Error(`operador não suportado: ${c.op}`);
  });
}
function linhasDe(t: string): Linha[] { return banco[t] ?? (banco[t] = []); }
function makeDb() {
  function builder(campos: Record<string, any> | undefined): any {
    let origem = ""; const joins: { tabela: string; conds: Cond[] }[] = []; let conds: Cond[] = [];
    function executar(): Linha[] {
      let atuais = linhasDe(origem).map((l) => ({ [origem]: l }));
      for (const j of joins) {
        const prox: Record<string, Linha>[] = [];
        for (const a of atuais) for (const l of linhasDe(j.tabela)) { const cand = { ...a, [j.tabela]: l }; if (satisfaz(cand, j.conds)) prox.push(cand); }
        atuais = prox;
      }
      const f = atuais.filter((l) => satisfaz(l, conds));
      if (!campos) return f.map((l) => ({ ...l[origem] }));
      return f.map((l) => { const o: Linha = {}; for (const [k, col] of Object.entries(campos)) { const r = refColuna(col); o[k] = l[r.tabela]?.[r.chave]; } return o; });
    }
    const b: any = {
      from: (t: any) => { origem = nomeTabela(t); return b; },
      innerJoin: (t: any, c: unknown) => { joins.push({ tabela: nomeTabela(t), conds: condicoes(c) }); return b; },
      leftJoin: (t: any, c: unknown) => { joins.push({ tabela: nomeTabela(t), conds: condicoes(c) }); return b; },
      where: (w: unknown) => { conds = condicoes(w); return b; },
      orderBy: () => b, groupBy: () => b, offset: () => b,
      limit: (n: number) => Promise.resolve().then(() => executar().slice(0, n)),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(executar).then(res, rej),
    };
    return b;
  }
  return {
    select: (campos?: Record<string, any>) => builder(campos),
    insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
    update: (t: any) => ({ set: (s: Linha) => ({ where: (w: unknown) => {
      const tabela = nomeTabela(t); const cs = condicoes(w);
      const alvos = linhasDe(tabela).filter((l) => satisfaz({ [tabela]: l }, cs));
      for (const l of alvos) Object.assign(l, s);
      capturado.updates.push({ table: tabela, set: s, ids: alvos.map((l) => l.id) });
      return Promise.resolve([{ affectedRows: alvos.length }]);
    } }) }),
    delete: () => ({ where: () => Promise.resolve([{ affectedRows: 0 }]) }),
  };
}
const dbInstance = makeDb();
vi.mock("../db", () => ({ getDb: vi.fn(async () => dbInstance) }));
vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc Teste", fusoHorario: "America/Fortaleza" },
    colaborador: { id: 10, cargo: "dono" },
  })),
}));
vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async () => ({
    allowed: true, verTodos: true, verProprios: false, criar: true, editar: true, excluir: true,
    colaboradorId: 10, escritorioId: 1, cargo: "dono",
  })),
}));

const { appRouter } = await import("../routers");
function caller() {
  const ctx: TrpcContext = {
    user: { id: 100, openId: "x", email: "x@y.z", name: "X", loginMethod: "google", role: "user", asaasCustomerId: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as any,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
  return appRouter.createCaller(ctx);
}

beforeEach(() => {
  for (const k of Object.keys(banco)) delete banco[k];
  capturado.updates = [];
  banco["colaboradores"] = [{ id: 10, escritorioId: 1, userId: 100 }];
  banco["eventos_processo"] = [
    { id: 1, escritorioId: 1, tipo: "nova_acao", poloCliente: "desconhecido", lido: false, resolucao: "pendente",
      conteudoJson: JSON.stringify({ cnj: "0834120-77.2026.8.15.2001", poloDoCliente: "desconhecido", capa: { classe: "JEC", partes: [], poloDoCliente: "desconhecido" } }) },
    { id: 2, escritorioId: 2, tipo: "nova_acao", poloCliente: "desconhecido", lido: false, resolucao: "pendente", conteudoJson: "{}" },
    { id: 3, escritorioId: 1, tipo: "movimentacao", poloCliente: "desconhecido", lido: false, resolucao: "pendente", conteudoJson: "{}" },
    { id: 4, escritorioId: 1, tipo: "nova_acao", poloCliente: "desconhecido", lido: false, resolucao: "pendente", conteudoJson: "{quebrado" },
  ];
});

// ─── gavetas ─────────────────────────────────────────────────────────────────

describe("gaveta pelo polo", () => {
  it("réu e terceiro ficam juntos no alerta; autor tem gaveta própria; 'não sei' também", () => {
    expect(gavetaDoPolo("passivo")).toBe("passivo");
    expect(gavetaDoPolo("terceiro")).toBe("passivo");
    expect(gavetaDoPolo("ativo")).toBe("ativo");
    expect(gavetaDoPolo("desconhecido")).toBe("desconhecido");
    expect(POLOS_DA_GAVETA.passivo).toEqual(["passivo", "terceiro"]);
    expect(POLOS_DA_GAVETA.ativo).toEqual(["ativo"]);
    expect(POLOS_DA_GAVETA.desconhecido).toEqual(["desconhecido"]);
  });

  it("só o autor confirmado fica fora do alerta — 'não sei' alerta de propósito", () => {
    expect(contaComoAlerta("ativo")).toBe(false);
    expect(contaComoAlerta("passivo")).toBe(true);
    expect(contaComoAlerta("terceiro")).toBe(true);
    expect(contaComoAlerta("desconhecido")).toBe(true);
  });

  it("a aba abre no polo passivo e as três gavetas existem, nessa ordem", () => {
    expect(GAVETAS.map((g) => g.id)).toEqual(["passivo", "ativo", "desconhecido"]);
    const tela = ler("client/src/pages/Processos.tsx");
    expect(tela).toContain('useState<GavetaPolo>("passivo")');
    expect(tela).toContain("{ filtro, polo, limite: LIMITE_PAGINA, cursor }");
    expect(tela).toContain("}, [filtro, polo]);");
    expect(tela).toContain("data?.contagemPorPolo?.[g.id]");
  });
});

// ─── matcher ─────────────────────────────────────────────────────────────────

describe("o robô acha o CPF escrito dentro do nome da parte", () => {
  const partes = [
    { nome: "ALEXSANDRO DE SOUSA LIMA - CPF: 810.665.623-34 (AUTOR)", polo: "ativo" as const, documento: null },
    { nome: "BANCO HONDA S/A. - CNPJ: 03.634.220/0001-65 (REU)", polo: "passivo" as const, documento: null },
  ];

  it("documentosNoTexto lê CPF e CNPJ com ou sem pontuação, e ignora OAB", () => {
    expect(documentosNoTexto("X - CPF: 810.665.623-34 (AUTOR)")).toEqual(["81066562334"]);
    expect(documentosNoTexto("Y - CNPJ: 03.634.220/0001-65 (REU)")).toEqual(["03634220000165"]);
    expect(documentosNoTexto("Z - CPF 81066562334")).toEqual(["81066562334"]);
    expect(documentosNoTexto("ADV - OAB CE38828")).toEqual([]);
    expect(documentosNoTexto(null)).toEqual([]);
  });

  it("o caso do print vira 'ativo' pelo documento, mesmo sem apelido", () => {
    expect(identificarPoloDoCliente(null, "81066562334", partes)).toBe("ativo");
  });

  it("o CNPJ do réu também bate pelo texto", () => {
    expect(identificarPoloDoCliente(null, "03634220000165", partes)).toBe("passivo");
  });

  it("CPF que não está no texto continua 'desconhecido' — nada de chute", () => {
    expect(identificarPoloDoCliente(null, "00000000191", partes)).toBe("desconhecido");
  });

  it("um CPF dentro de um CNPJ não casa (padrão de documento, não substring)", () => {
    // 03634220000165 contém "34220000165"; um CPF com esses dígitos não pode
    // ser confundido com a parte.
    expect(identificarPoloDoCliente(null, "34220000165", partes)).toBe("desconhecido");
  });
});

// ─── advogado do escritório ──────────────────────────────────────────────────

describe("OAB do escritório entre as partes", () => {
  it("normaliza as grafias que circulam", () => {
    expect(normalizarOab("OAB/CE 38.828")).toBe("CE38828");
    expect(normalizarOab("ce 38828")).toBe("CE38828");
    expect(normalizarOab("OAB CE038828")).toBe("CE38828");
    expect(normalizarOab("38828")).toBe("");
    expect(normalizarOab(null)).toBe("");
  });

  it("reconhece a OAB no texto da parte como o tribunal escreve", () => {
    const txt = "BRUNO SOBREIRA registrado(a) civilmente como BRUNO SOBREIRA - OAB CE38828 - CPF: 062.8";
    expect(textoMencionaOab(txt, "OAB/CE 38.828")).toBe(true);
    expect(textoMencionaOab(txt, "CE 12345")).toBe(false);
    expect(textoMencionaOab(txt, null)).toBe(false);
    expect(textoMencionaOab("sem oab", "CE 38828")).toBe(false);
  });

  it("a capa guarda a bandeira e a leitura devolve — e ela NÃO decide o polo", () => {
    const bruta = {
      classe: "Procedimento Comum Cível",
      partes: [
        { nome: "CLIENTE X - CPF: 810.665.623-34 (AUTOR)", polo: "ativo" },
        { nome: "ADV Y - OAB CE38828 - CPF: 062.8", polo: "ativo" },
      ],
    };
    const capa = montarCapaNovaAcao(bruta, "desconhecido", "2026-09-04T12:00:00Z", { oabEscritorio: "CE 38828" });
    expect(capa.advogadoDoEscritorio).toBe(true);
    expect(capa.poloDoCliente).toBe("desconhecido");
    expect(lerCapaNovaAcao(JSON.stringify({ capa }))?.advogadoDoEscritorio).toBe(true);
    const sem = montarCapaNovaAcao(bruta, "desconhecido", "2026-09-04T12:00:00Z");
    expect(sem.advogadoDoEscritorio).toBe(false);
    expect(lerCapaNovaAcao(JSON.stringify({ capa: { classe: "x", partes: [] } }))?.advogadoDoEscritorio).toBe(false);
  });

  it("o cron busca a OAB do escritório e manda pra capa", () => {
    const cron = ler("server/processos/cron-monitoramento.ts");
    expect(cron).toContain("select({ oab: escritorios.oab })");
    expect(cron).toContain("{ oabEscritorio },");
  });
});

// ─── cron e coluna ───────────────────────────────────────────────────────────

describe("coluna própria e o que o cron grava", () => {
  it("schema e migration têm a coluna, com backfill do JSON e índice", () => {
    const schema = ler("drizzle/schema.ts");
    expect(schema).toContain('poloCliente: mysqlEnum("poloClienteEvento", ["ativo", "passivo", "terceiro", "desconhecido"]).default("desconhecido").notNull()');
    const mig = ler("drizzle/0214_eventos_polo_cliente.sql");
    expect(mig).toContain("ADD COLUMN poloClienteEvento ENUM('ativo','passivo','terceiro','desconhecido') NOT NULL DEFAULT 'desconhecido'");
    expect(mig).toContain("JSON_EXTRACT(conteudoJson, '$.poloDoCliente')");
    expect(mig).toContain("CREATE INDEX idx_eventos_proc_escr_tipo_polo");
    // O autor silenciado volta a aparecer na gaveta dele; baseline e
    // pré-cadastro continuam quietos.
    expect(mig).toContain("JSON_EXTRACT(conteudoJson, '$.motivoSilencio')");
    expect(mig).toContain("= 'polo_ativo'");
  });

  it("a detecção grava o polo na coluna e não silencia o autor por lido", () => {
    const cron = ler("server/processos/cron-monitoramento.ts");
    expect(cron).toContain("poloCliente: poloDoCliente,");
    expect(cron).toContain('lido: !isRelevante && motivoSilencio !== "polo_ativo",');
    // O sino continua só pro relevante — autor confirmado segue sem notificação.
    expect(cron).toContain('if (poloDoCliente === "ativo") {\n          isRelevante = false;');
  });
});

// ─── listagem ────────────────────────────────────────────────────────────────

describe("listarNovasAcoes filtra e conta por gaveta", () => {
  const router = ler("server/routers/processos.ts");
  const corpo = (() => {
    const i = router.indexOf("listarNovasAcoes: protectedProcedure");
    const fim = router.indexOf("definirPoloNovaAcao: protectedProcedure", i);
    expect(i).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(i);
    return router.slice(i, fim);
  })();

  it("aceita a gaveta e traduz pros polos dela", () => {
    expect(corpo).toContain('polo: z.enum(["passivo", "ativo", "desconhecido"]).optional()');
    expect(corpo).toContain("inArray(eventosProcesso.poloCliente, POLOS_DA_GAVETA[input.polo])");
    expect(corpo).toContain("poloCliente: eventosProcesso.poloCliente,");
  });

  it("o badge de pendentes deixa o autor de fora", () => {
    const i = corpo.indexOf("const [contagem] = await db");
    expect(corpo.slice(i, i + 600)).toContain('ne(eventosProcesso.poloCliente, "ativo")');
  });

  it("conta cada gaveta com as condições da caixa, sem a gaveta", () => {
    expect(corpo).toContain(".where(and(...condicoesCaixa))");
    expect(corpo).toContain(".groupBy(eventosProcesso.poloCliente)");
    expect(corpo).toContain("contagemPorPolo[gavetaDoPolo(lerPolo(linha.polo))] += Number(linha.total ?? 0)");
    expect(corpo).toContain("contagemPorPolo,\n      };");
  });
});

// ─── Réu / Autor / Terceiro com um clique ────────────────────────────────────

describe("processos.definirPoloNovaAcao", () => {
  it("grava a coluna e o JSON (capa inclusa), com quem e quando", async () => {
    const r = await caller().processos.definirPoloNovaAcao({ id: 1, polo: "ativo" });
    expect(r).toEqual({ ok: true, polo: "ativo", gaveta: "ativo" });
    const up = capturado.updates.find((u) => u.table === "eventos_processo")!;
    expect(up.ids).toEqual([1]);
    expect(up.set.poloCliente).toBe("ativo");
    const json = JSON.parse(up.set.conteudoJson);
    expect(json.poloDoCliente).toBe("ativo");
    expect(json.capa.poloDoCliente).toBe("ativo");
    expect(json.poloManual).toMatchObject({ userId: 100 });
    expect(typeof json.poloManual.em).toBe("string");
    // O resto do JSON (cnj, classe) fica como estava.
    expect(json.cnj).toBe("0834120-77.2026.8.15.2001");
    expect(json.capa.classe).toBe("JEC");
  });

  it("terceiro cai na gaveta do passivo (continua alerta)", async () => {
    const r = await caller().processos.definirPoloNovaAcao({ id: 1, polo: "terceiro" });
    expect(r.gaveta).toBe("passivo");
  });

  it("card de outro escritório: NOT_FOUND e nenhum update", async () => {
    await expect(caller().processos.definirPoloNovaAcao({ id: 2, polo: "passivo" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(capturado.updates).toEqual([]);
  });

  it("evento que não é nova ação: NOT_FOUND", async () => {
    await expect(caller().processos.definirPoloNovaAcao({ id: 3, polo: "passivo" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(capturado.updates).toEqual([]);
  });

  it("JSON quebrado não derruba o clique — regrava só o que sabe", async () => {
    const r = await caller().processos.definirPoloNovaAcao({ id: 4, polo: "passivo" });
    expect(r.ok).toBe(true);
    const up = capturado.updates.find((u) => u.table === "eventos_processo")!;
    expect(JSON.parse(up.set.conteudoJson)).toMatchObject({ poloDoCliente: "passivo", poloManual: { userId: 100 } });
  });
});

// ─── a tela ──────────────────────────────────────────────────────────────────

describe("a tela", () => {
  const tela = ler("client/src/pages/Processos.tsx");

  it("o polo gravado manda; capa e dedução só quando ele não sabe", () => {
    expect(tela).toContain('const poloGravado: string = a.poloCliente ?? "desconhecido";');
    expect(tela).toContain('poloGravado !== "desconhecido"\n                ? poloGravado');
  });

  it("autor nunca é alerta: sem 'Novo', sem borda vermelha", () => {
    expect(tela).toContain('const gavetaAtivo = poloGravado === "ativo";');
    expect(tela).toContain("const ehAlerta = !a.lido && !gavetaAtivo;");
    expect(tela).toContain("{!resolvido && ehAlerta && (");
    expect(tela).not.toContain("{!resolvido && !a.lido && (");
  });

  it("o card sem polo oferece Réu / Autor / Terceiro, e só ele", () => {
    expect(tela).toContain('const pedePolo = !resolvido && poloGravado === "desconhecido";');
    expect(tela).toContain("Este cliente é:");
    expect(tela).toContain("definirPoloMut.mutate({ id: a.id, polo: valor })");
    expect(tela).toContain("o card muda de gaveta na hora; vale só pra este processo");
  });

  it("o clique tira o card da gaveta na hora e avisa pra onde foi", () => {
    const i = tela.indexOf("trpc.processos.definirPoloNovaAcao.useMutation");
    const corpo = tela.slice(i, i + 900);
    expect(corpo).toContain("setAcoesAcumuladas((prev) => prev.filter((a) => a.id !== id))");
    expect(corpo).toContain("Card movido para ${destino}");
    expect(corpo).toContain("Deixa de contar como alerta — o cliente é o autor.");
  });

  it("diz quando foi o escritório que ajuizou", () => {
    expect(tela).toContain("{a.capa?.advogadoDoEscritorio && (");
    expect(tela).toContain("Ajuizada pelo escritório");
  });

  it("cada gaveta explica o que é", () => {
    expect(tela).toContain("não viram \"Novo\", não tocam o sino");
    expect(tela).toContain("conta como alerta</b> (melhor um aviso a mais do que um processo");
  });
});
