/**
 * Primeiros passos do dono — Central de ajuda, fatia 2 (mockup
 * `mockup-central-de-ajuda.html`, aba 4; "pode fazer" de 12/09/2026).
 *
 * O que fica travado aqui:
 *  - quem NÃO é o dono recebe `souDono=false` e lista vazia — e o servidor
 *    não consulta tabela nenhuma pra ele (não é "sem permissão", é "nada");
 *  - cada passo é detectado por consulta amarrada ao escritório da sessão
 *    (o WHERE é renderizado e tem que carregar o `escritorioId` — mutação
 *    que tira a amarra fica invisível pro banco falso, visível aqui);
 *  - o passo 4 (Vigiar) fica com cadeado até o 3 (Cofre) existir;
 *  - passo de módulo não contratado sai da lista, do total e das consultas;
 *  - o Dashboard do dono monta o bloco; a variante processual não (o
 *    GuiaProcessual já faz esse papel lá); as rotas dos passos existem no
 *    App.tsx e os deep-links `?novo=1` abrem o fluxo real.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";
import {
  PRIMEIROS_PASSOS,
  montarPrimeirosPassos,
  numeroDoPasso,
  passoAtual,
  passosDoContrato,
} from "../../shared/primeiros-passos";
import { MODULO_POR_NAMESPACE } from "../../shared/modulos-contratacao";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");
const ESCRITORIO_ID = 77;
const D = (s: string) => new Date(`${s}T12:00:00.000Z`);

// ─── Banco falso: filas por tabela + WHERE renderizado ──────────────────────
const NOME = Symbol.for("drizzle:Name");
function nomeTabela(t: any): string { return (t?.[NOME] as string) || ""; }
const dialeto = new MySqlDialect();
type WhereCapturado = { table: string; join: boolean; sql: string; params: unknown[] };
const filas: Record<string, any[][]> = {};
const wheres: WhereCapturado[] = [];
const proxima = (t: string) => (filas[t]?.length ? filas[t].shift()! : []);

function makeDb() {
  function sel(): any {
    let table = "";
    let join = false;
    // O `requireUser` do protectedProcedure confere suspensão com um JOIN
    // colaboradores×escritorios — responde "vínculo ativo, não suspenso"
    // sem mexer nas filas do router.
    const resolver = (n?: number) =>
      Promise.resolve(join ? [{ suspenso: false, motivo: null }] : (n == null ? proxima(table) : proxima(table).slice(0, n)));
    const b: any = {
      from: (t: any) => { table = nomeTabela(t); return b; },
      innerJoin: () => { join = true; return b; },
      where: (w: SQL | undefined) => {
        const q = w ? dialeto.sqlToQuery(w) : { sql: "", params: [] };
        wheres.push({ table, join, sql: q.sql, params: q.params });
        return b;
      },
      orderBy: () => b,
      limit: (n: number) => resolver(n),
      then: (res: any, rej?: any) => resolver().then(res, rej),
    };
    return b;
  }
  return { select: () => sel() };
}
const dbInstance = makeDb();

vi.mock("../db", () => ({ getDb: vi.fn(async () => dbInstance) }));

const vinculoMock = vi.fn(async (_userId: number): Promise<any> => ({
  escritorio: { id: ESCRITORIO_ID, nome: "Escritório do Dono" },
  colaborador: { id: 10, cargo: "dono" },
}));
vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: (...a: unknown[]) => (vinculoMock as any)(...a),
}));

const modulosMock = vi.fn(async (_userId: number): Promise<string[] | null> => null);
vi.mock("../_core/gate-modulos", () => ({
  modulosContratadosDoUsuario: (...a: unknown[]) => (modulosMock as any)(...a),
  conferirModuloDoPath: vi.fn(async () => {}),
  invalidarCacheGateModulos: vi.fn(),
}));

const { appRouter } = await import("../routers");

function caller(user: Partial<TrpcContext["user"]> = {}) {
  const ctx = {
    user: {
      id: 100, openId: "x", email: "dono@escritorio.adv.br", name: "Dono", loginMethod: "email", role: "user",
      asaasCustomerId: null, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
      ...user,
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as unknown as TrpcContext;
  return appRouter.createCaller(ctx);
}

/** Só os WHERE das consultas do router (o JOIN do requireUser fica de fora). */
const wheresDoRouter = () => wheres.filter((w) => !w.join);
const tabelasConsultadas = () => [...new Set(wheresDoRouter().map((w) => w.table))].sort();

function tudoFeito() {
  filas.canais_integrados = [[{ createdAt: D("2026-09-01") }]];
  filas.contatos = [[{ createdAt: D("2026-09-02") }]];
  filas.cofre_credenciais = [[{ createdAt: D("2026-09-03") }]];
  filas.motor_monitoramentos = [[{ createdAt: D("2026-09-04") }]];
  filas.colaboradores = [[{ createdAt: D("2026-08-30") }, { createdAt: D("2026-09-06") }]];
  filas.convites_colaborador = [[{ createdAt: D("2026-09-05") }]];
}

beforeEach(() => {
  for (const k of Object.keys(filas)) delete filas[k];
  wheres.length = 0;
  vinculoMock.mockReset();
  vinculoMock.mockResolvedValue({
    escritorio: { id: ESCRITORIO_ID, nome: "Escritório do Dono" },
    colaborador: { id: 10, cargo: "dono" },
  });
  modulosMock.mockReset();
  modulosMock.mockResolvedValue(null);
});

// ─── Regras puras ───────────────────────────────────────────────────────────
describe("catálogo e montagem (puro)", () => {
  it("os 5 passos, na ordem combinada com o dono (decisão 4)", () => {
    expect(PRIMEIROS_PASSOS.map((p) => p.id)).toEqual(["whatsapp", "cliente", "cofre", "processo", "equipe"]);
    expect(PRIMEIROS_PASSOS.map((p) => p.titulo)).toEqual([
      "Conectar o WhatsApp",
      "Cadastrar o 1º cliente",
      "Guardar o acesso ao tribunal",
      "Vigiar um processo",
      "Convidar a equipe",
    ]);
  });

  it("módulos: WhatsApp pede atendimento, Cofre e Vigiar pedem processos, equipe é core", () => {
    const porId = Object.fromEntries(PRIMEIROS_PASSOS.map((p) => [p.id, p.modulos]));
    expect(porId.whatsapp).toEqual(["atendimento"]);
    expect(porId.cofre).toEqual(["processos"]);
    expect(porId.processo).toEqual(["processos"]);
    expect(porId.equipe).toEqual([]);
    // O mesmo contrato da rota /clientes: completo OU pacote processual.
    expect(porId.cliente).toEqual(["clientes", "processos"]);
  });

  it("contrato indeterminado (null/vazio) libera tudo; plano sem processos tira Cofre e Vigiar", () => {
    expect(passosDoContrato(null).map((p) => p.id)).toHaveLength(5);
    expect(passosDoContrato([]).map((p) => p.id)).toHaveLength(5);
    expect(passosDoContrato(["atendimento", "clientes"]).map((p) => p.id)).toEqual(["whatsapp", "cliente", "equipe"]);
    expect(passosDoContrato(["processos"]).map((p) => p.id)).toEqual(["cliente", "cofre", "processo", "equipe"]);
  });

  it("montar: feitoEm vira ISO, o cadeado do 4 olha o 3, feitos/total contam só os listados", () => {
    const r = montarPrimeirosPassos({ whatsapp: D("2026-09-01"), cliente: "2026-09-02T12:00:00.000Z" }, null);
    expect(r.souDono).toBe(true);
    expect(r.total).toBe(5);
    expect(r.feitos).toBe(2);
    expect(r.passos[0]).toMatchObject({ id: "whatsapp", feito: true, feitoEm: "2026-09-01T12:00:00.000Z", travadoPor: null, modulo: "atendimento" });
    expect(r.passos[1]).toMatchObject({ id: "cliente", feito: true, feitoEm: "2026-09-02T12:00:00.000Z" });
    expect(r.passos[2]).toMatchObject({ id: "cofre", feito: false, feitoEm: null, travadoPor: null });
    expect(r.passos[3]).toMatchObject({ id: "processo", feito: false, travadoPor: "cofre" });
    expect(r.passos[4]).toMatchObject({ id: "equipe", feito: false, travadoPor: null, modulo: null });
    expect(passoAtual(r.passos)).toBe("cofre");
    expect(numeroDoPasso(r.passos, "cofre")).toBe(3);
  });

  it("montar: com o Cofre feito o 4 destrava; passo feito nunca fica travado", () => {
    const r = montarPrimeirosPassos({ cofre: D("2026-09-03") }, null);
    expect(r.passos.find((p) => p.id === "processo")!.travadoPor).toBeNull();
    const r2 = montarPrimeirosPassos({ processo: D("2026-09-04") }, null);
    expect(r2.passos.find((p) => p.id === "processo")).toMatchObject({ feito: true, travadoPor: null });
    // Data inválida não conta como feito.
    expect(montarPrimeirosPassos({ cliente: "não é data" }, null).feitos).toBe(0);
  });

  it("montar: módulo não contratado sai da lista E do total; o número do cadeado acompanha", () => {
    const r = montarPrimeirosPassos({}, ["processos"]);
    expect(r.passos.map((p) => p.id)).toEqual(["cliente", "cofre", "processo", "equipe"]);
    expect(r.total).toBe(4);
    expect(numeroDoPasso(r.passos, "cofre")).toBe(2);
    expect(passoAtual(r.passos)).toBe("cliente");
  });
});

// ─── Procedure por caller ───────────────────────────────────────────────────
describe("ajuda.primeirosPassos — quem vê", () => {
  it("gestor: souDono=false, lista vazia, e NENHUMA consulta de passo", async () => {
    vinculoMock.mockResolvedValue({ escritorio: { id: ESCRITORIO_ID }, colaborador: { id: 11, cargo: "gestor" } });
    tudoFeito();
    const r = await caller().ajuda.primeirosPassos();
    expect(r).toEqual({ souDono: false, passos: [], feitos: 0, total: 0 });
    expect(wheresDoRouter()).toEqual([]);
  });

  it("sem vínculo (onboarding, admin da plataforma): a mesma resposta vazia", async () => {
    vinculoMock.mockResolvedValue(null);
    tudoFeito();
    const r = await caller({ role: "admin" } as any).ajuda.primeirosPassos();
    expect(r).toEqual({ souDono: false, passos: [], feitos: 0, total: 0 });
    expect(wheresDoRouter()).toEqual([]);
  });

  it("dono: souDono=true com os 5 passos", async () => {
    const r = await caller().ajuda.primeirosPassos();
    expect(r.souDono).toBe(true);
    expect(r.passos.map((p) => p.id)).toEqual(["whatsapp", "cliente", "cofre", "processo", "equipe"]);
    expect(r.total).toBe(5);
  });
});

describe("ajuda.primeirosPassos — detecção", () => {
  it("nada feito: 0 de 5, o 4 travado pelo 3, o atual é o WhatsApp", async () => {
    const r = await caller().ajuda.primeirosPassos();
    expect(r.feitos).toBe(0);
    expect(r.passos.every((p) => !p.feito && p.feitoEm === null)).toBe(true);
    expect(r.passos.find((p) => p.id === "processo")!.travadoPor).toBe("cofre");
    expect(passoAtual(r.passos)).toBe("whatsapp");
  });

  it("tudo feito: 5 de 5, cada feitoEm é o registro mais antigo que satisfaz o passo", async () => {
    tudoFeito();
    const r = await caller().ajuda.primeirosPassos();
    expect(r.feitos).toBe(5);
    expect(r.total).toBe(5);
    const em = Object.fromEntries(r.passos.map((p) => [p.id, p.feitoEm]));
    expect(em).toEqual({
      whatsapp: "2026-09-01T12:00:00.000Z",
      cliente: "2026-09-02T12:00:00.000Z",
      cofre: "2026-09-03T12:00:00.000Z",
      processo: "2026-09-04T12:00:00.000Z",
      // Equipe: o mais antigo entre o 2º colaborador ativo (06/09) e o
      // convite (05/09) — o 1º colaborador é o próprio dono e não conta.
      equipe: "2026-09-05T12:00:00.000Z",
    });
  });

  it("cofre feito → o 4 destrava e vira o atual", async () => {
    filas.cofre_credenciais = [[{ createdAt: D("2026-09-03") }]];
    const r = await caller().ajuda.primeirosPassos();
    expect(r.passos.find((p) => p.id === "cofre")).toMatchObject({ feito: true, feitoEm: "2026-09-03T12:00:00.000Z" });
    expect(r.passos.find((p) => p.id === "processo")!.travadoPor).toBeNull();
    expect(passoAtual(r.passos)).toBe("whatsapp");
  });

  it.each([
    ["whatsapp", "canais_integrados"],
    ["cliente", "contatos"],
    ["processo", "motor_monitoramentos"],
  ] as const)("passo %s: feito quando existe registro em %s, não feito sem", async (id, tabela) => {
    filas[tabela] = [[{ createdAt: D("2026-09-08") }]];
    const feito = await caller().ajuda.primeirosPassos();
    expect(feito.passos.find((p) => p.id === id)).toMatchObject({ feito: true, feitoEm: "2026-09-08T12:00:00.000Z" });
    expect(feito.feitos).toBe(1);

    for (const k of Object.keys(filas)) delete filas[k];
    const semNada = await caller().ajuda.primeirosPassos();
    expect(semNada.passos.find((p) => p.id === id)).toMatchObject({ feito: false, feitoEm: null });
  });

  it("equipe: só o dono ativo e sem convite = não feito; um convite basta; um 2º colaborador basta", async () => {
    filas.colaboradores = [[{ createdAt: D("2026-08-30") }]];
    let r = await caller().ajuda.primeirosPassos();
    expect(r.passos.find((p) => p.id === "equipe")).toMatchObject({ feito: false, feitoEm: null });

    filas.colaboradores = [[{ createdAt: D("2026-08-30") }]];
    filas.convites_colaborador = [[{ createdAt: D("2026-09-05") }]];
    r = await caller().ajuda.primeirosPassos();
    expect(r.passos.find((p) => p.id === "equipe")).toMatchObject({ feito: true, feitoEm: "2026-09-05T12:00:00.000Z" });

    filas.colaboradores = [[{ createdAt: D("2026-08-30") }, { createdAt: D("2026-09-06") }]];
    r = await caller().ajuda.primeirosPassos();
    expect(r.passos.find((p) => p.id === "equipe")).toMatchObject({ feito: true, feitoEm: "2026-09-06T12:00:00.000Z" });
  });
});

describe("ajuda.primeirosPassos — contrato de módulos", () => {
  it("plano sem atendimento nem processos: só cliente e equipe, total 2, e as outras tabelas NÃO são consultadas", async () => {
    modulosMock.mockResolvedValue(["clientes", "agenda"]);
    tudoFeito();
    const r = await caller().ajuda.primeirosPassos();
    expect(r.passos.map((p) => p.id)).toEqual(["cliente", "equipe"]);
    expect(r.total).toBe(2);
    expect(r.feitos).toBe(2);
    expect(tabelasConsultadas()).toEqual(["colaboradores", "contatos", "convites_colaborador"]);
  });

  it("pacote só processos: sem WhatsApp; Cofre e Vigiar ficam (com o cadeado)", async () => {
    modulosMock.mockResolvedValue(["processos"]);
    const r = await caller().ajuda.primeirosPassos();
    expect(r.passos.map((p) => p.id)).toEqual(["cliente", "cofre", "processo", "equipe"]);
    expect(r.passos.find((p) => p.id === "processo")!.travadoPor).toBe("cofre");
    expect(tabelasConsultadas()).not.toContain("canais_integrados");
  });

  it("o contrato vem do MESMO resolvedor do porteiro, pelo usuário da sessão; admin/impersonação veem tudo", async () => {
    modulosMock.mockResolvedValue(["clientes"]);
    await caller().ajuda.primeirosPassos();
    expect(modulosMock).toHaveBeenCalledWith(100);

    modulosMock.mockClear();
    const r = await caller({ impersonatedBy: "admin@juridflow" } as any).ajuda.primeirosPassos();
    expect(modulosMock).not.toHaveBeenCalled();
    expect(r.total).toBe(5);
  });
});

describe("ajuda.primeirosPassos — toda consulta amarra o escritório da sessão", () => {
  it("as 6 tabelas são consultadas e cada WHERE carrega o escritorioId", async () => {
    tudoFeito();
    await caller().ajuda.primeirosPassos();
    expect(tabelasConsultadas()).toEqual([
      "canais_integrados", "cofre_credenciais", "colaboradores", "contatos", "convites_colaborador", "motor_monitoramentos",
    ]);
    for (const w of wheresDoRouter()) {
      expect(w.sql, `${w.table}: WHERE sem a coluna do escritório`).toMatch(/escritorio/i);
      expect(w.params, `${w.table}: WHERE sem o id do escritório da sessão`).toContain(ESCRITORIO_ID);
    }
  });

  it("as condições de estado são as do app: canal conectado com telefone, credencial ativa/validando, monitor ativo, colaborador ativo", async () => {
    tudoFeito();
    await caller().ajuda.primeirosPassos();
    const de = (t: string) => wheresDoRouter().find((w) => w.table === t)!;
    const canal = de("canais_integrados");
    expect(canal.params).toEqual(expect.arrayContaining(["whatsapp_api", "conectado"]));
    expect(canal.sql).toMatch(/telefoneCanal.*is not null/i);
    expect(de("cofre_credenciais").params).toEqual(expect.arrayContaining(["ativa", "validando"]));
    expect(de("motor_monitoramentos").params).toContain("ativo");
    expect(de("colaboradores").params).toContain(true);
  });
});

// ─── Client: varreduras de texto ────────────────────────────────────────────
describe("client — onde o bloco mora", () => {
  const dash = ler("client/src/pages/Dashboard.tsx");

  it("o Dashboard do dono monta <PrimeirosPassos /> DEPOIS da saída da variante processual", () => {
    expect(dash).toContain('import PrimeirosPassos from "./dashboards/PrimeirosPassos"');
    const mount = dash.indexOf("<PrimeirosPassos");
    expect(mount).toBeGreaterThan(-1);
    const ini = dash.indexOf("if (processualPuro) {");
    expect(ini).toBeGreaterThan(-1);
    const fim = dash.indexOf("\n  }", ini);
    const blocoProcessual = dash.slice(ini, fim);
    expect(blocoProcessual, "a variante processual não pode montar o bloco — o GuiaProcessual já cobre").not.toContain("PrimeirosPassos");
    expect(blocoProcessual).toContain("<DashboardProcessual />");
    expect(mount).toBeGreaterThan(fim);
    // Só o dono — o servidor decide, mas o client nem pergunta pra quem não é.
    expect(dash).toContain("{isDono && <PrimeirosPassos />}");
  });

  it("a variante processual não monta o bloco (nem importa)", () => {
    const proc = ler("client/src/pages/dashboards/DashboardProcessual.tsx");
    expect(proc).not.toContain("PrimeirosPassos");
    expect(proc).toContain("<GuiaProcessual");
  });
});

describe("client — o componente", () => {
  const comp = ler("client/src/pages/dashboards/PrimeirosPassos.tsx");

  it("exporta o bloco (default) e o resumo compacto da Central", () => {
    expect(comp).toContain("export default function PrimeirosPassos()");
    expect(comp).toContain("export function PrimeirosPassosResumo()");
    expect(comp).toContain("trpc.ajuda.primeirosPassos.useQuery");
    expect(comp).toContain('setLocation("/dashboard")');
    expect(comp).toContain("ver no Dashboard");
  });

  it("some sozinho quando os N estão feitos; o resumo da Central NÃO some", () => {
    const bloco = comp.slice(comp.indexOf("export default function PrimeirosPassos()"), comp.indexOf("export function PrimeirosPassosResumo()"));
    expect(bloco).toContain("data.feitos === data.total) return null");
    const resumo = comp.slice(comp.indexOf("export function PrimeirosPassosResumo()"));
    expect(resumo).not.toContain("data.feitos === data.total");
  });

  it("desenho da aba 4: título, selo N de M, barra, feito em verde, atual com botão, travado com cadeado", () => {
    expect(comp).toContain("Primeiros passos");
    expect(comp).toContain("{feitos} de {total}");
    expect(comp).toContain("<Progress value={pct}");
    expect(comp).toContain("border-success/30 bg-success-bg");
    expect(comp).toContain("Feito{p.feitoEm ?");
    expect(comp).toContain("depois do passo {numeroDoPasso(passos, p.travadoPor)}");
    expect(comp).toContain("<Lock");
    expect(comp).toContain('variant={ehAtual ? "default" : "outline"}');
    expect(comp).toContain("setLocation(p.rota)");
  });

  it("cabe em 390px: grid com a coluna do celular declarada e itens que encolhem; hooks antes da saída", () => {
    expect(comp.match(/grid-cols-1 gap-[\d.]+ sm:grid-cols-2 lg:grid-cols-5/g)?.length).toBe(2);
    expect((comp.match(/min-w-0/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(comp).toContain("flex flex-wrap items-center gap-2");
    // Identidade do app: tokens da escala tipográfica (piso 11px), sem tamanho solto.
    expect(comp).not.toMatch(/text-\[\d/);
    // Nenhum hook depois da saída antecipada (React #310).
    for (const inicio of ["export default function PrimeirosPassos()", "export function PrimeirosPassosResumo()"]) {
      const i = comp.indexOf(inicio);
      const fim = comp.indexOf("\nexport ", i + inicio.length);
      const bloco = comp.slice(i, fim < 0 ? undefined : fim);
      const saida = bloco.indexOf("return null;");
      expect(saida, `${inicio}: sem saída antecipada`).toBeGreaterThan(-1);
      expect(bloco.slice(0, saida)).toMatch(/\n {2}const \[, setLocation\] = useLocation\(\);/);
      expect(bloco.slice(saida), `${inicio}: hook depois do return`).not.toMatch(/\n {2}(?:const .*=\s*)?use[A-Z]\w*\(/);
    }
  });
});

describe("client — rotas e deep-links dos passos", () => {
  function rotasDoApp(): Set<string> {
    const app = ler("client/src/App.tsx");
    return new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]));
  }

  it("toda rota de passo existe no <Switch> do App.tsx", () => {
    const rotas = rotasDoApp();
    expect(rotas.size).toBeGreaterThan(20);
    for (const p of PRIMEIROS_PASSOS) {
      const caminho = p.rota.split("?")[0];
      expect(rotas.has(caminho), `${p.id}: rota "${caminho}" não existe no App.tsx`).toBe(true);
      expect(p.rota).toMatch(/novo=1$/);
    }
  });

  it("cofre e vigiar reusam os deep-links do GuiaProcessual", () => {
    const guia = ler("client/src/pages/dashboards/GuiaProcessual.tsx");
    for (const id of ["cofre", "processo", "cliente"] as const) {
      const rota = PRIMEIROS_PASSOS.find((p) => p.id === id)!.rota;
      expect(guia, `${id}: ${rota} não é o deep-link do guia`).toContain(`"${rota}"`);
    }
  });

  it("?novo=1 abre o fluxo real: Clientes completo, aba Canais (WhatsApp novo) e aba Equipe (convite)", () => {
    const cli = ler("client/src/pages/Clientes.tsx");
    expect(cli).toContain('useState(\n    () => new URLSearchParams(window.location.search).get("novo") === "1",');
    expect(cli).toContain("<NovoClienteDialog open={showNovo}");

    const cfg = ler("client/src/pages/Configuracoes.tsx");
    expect(cfg).toContain('p.get("tab") === "canais" && p.get("novo") === "1" ? { type: "whatsapp" } : null');
    expect(cfg).toContain('if (new URLSearchParams(window.location.search).get("novo") !== "1") return;');
    expect(cfg).toContain('document.getElementById("convite-email-input")');
    // A leitura do `?tab=` que abre a aba certa continua lá.
    expect(cfg).toContain('params.get("tab")');
    expect(PRIMEIROS_PASSOS.find((p) => p.id === "whatsapp")!.rota).toBe("/configuracoes?tab=canais&novo=1");
    expect(PRIMEIROS_PASSOS.find((p) => p.id === "equipe")!.rota).toBe("/configuracoes?tab=equipe&novo=1");
  });
});

describe("registro do router", () => {
  it("namespace `ajuda` é core (null) e está no appRouter", () => {
    expect("ajuda" in MODULO_POR_NAMESPACE).toBe(true);
    expect(MODULO_POR_NAMESPACE.ajuda).toBeNull();
    expect(ler("server/routers.ts")).toContain("ajuda: ajudaRouter");
  });
});
