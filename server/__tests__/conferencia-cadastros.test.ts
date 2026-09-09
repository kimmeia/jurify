/**
 * Conferência de cadastros (mockup `mockup-conferencia-cadastros`, "aprovado,
 * pode fazer" do dono em 09/09/2026, com as quatro decisões da proposta):
 *
 *  1. grupo com CPFs diferentes: "Mesclar todos" pula, o Mesclar da linha
 *     pede confirmação nomeando o CPF que seria descartado;
 *  2. "Não é duplicado" existe, tira o grupo da conta em toda tela e é
 *     reversível na aba própria;
 *  3. mora em página própria de Clientes (/clientes/conferencia);
 *  4. a planilha leva o CPF inteiro; tela e PDF mascaram.
 *
 * Um cálculo, três saídas: tela, PDF e planilha leem a MESMA `Conferencia`,
 * e o "(N)" do botão "Possíveis duplicados" sai dela também.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

// ─── Banco falso: filas por tabela + captura de escritas, deletes e selects ──

const NOME = Symbol.for("drizzle:Name");
const COLUNAS = Symbol.for("drizzle:Columns");
function nomeTabela(t: any): string { return (t?.[NOME] as string) || ""; }
function ehColuna(x: any): boolean { return !!x && typeof x === "object" && "columnType" in x && x.table !== undefined; }
function refColuna(col: any): { tabela: string; chave: string } {
  const cols = col.table[COLUNAS] as Record<string, unknown>;
  const chave = Object.keys(cols).find((k) => cols[k] === col) ?? col.name;
  return { tabela: nomeTabela(col.table), chave };
}
type Token = { col: { tabela: string; chave: string } } | { op: string } | { valor: unknown };
function tokens(no: any, out: Token[] = []): Token[] {
  if (no === null || no === undefined) return out;
  if (Array.isArray(no)) { for (const n of no) tokens(n, out); return out; }
  const ctor = no.constructor?.name;
  if (ctor === "SQL") return tokens(no.queryChunks, out);
  if (ctor === "StringChunk") { const s = (no.value as string[]).join("").trim(); if (s && s !== "(" && s !== ")") out.push({ op: s }); return out; }
  if (ctor === "Param") { out.push({ valor: no.value }); return out; }
  if (ehColuna(no)) { out.push({ col: refColuna(no) }); return out; }
  return out;
}
function whereLegivel(where: unknown): string {
  return tokens(where)
    .map((t) => ("col" in t ? t.col.chave : "op" in t ? t.op : String(t.valor)))
    .join(" ");
}
function sqlCru(q: any): string {
  const chunks = q?.queryChunks ?? [];
  return chunks.map((c: any) => (Array.isArray(c?.value) ? c.value.join("") : "")).join("");
}

const filas: Record<string, any[][]> = {};
const padroes: Record<string, any[]> = {};
const capturado = {
  inserts: [] as { table: string; values: any }[],
  updates: [] as { table: string; set: any; where: string }[],
  deletes: [] as { table: string; where: string }[],
  selects: [] as { table: string; where: string }[],
  execs: [] as string[],
};
function proximaFila(table: string): any[] {
  const fila = filas[table];
  return fila && fila.length > 0 ? fila.shift()! : (padroes[table] ?? []);
}
function makeDb() {
  function builder(): any {
    let table = "";
    const b: any = {
      from: (t: any) => { table = nomeTabela(t); return b; },
      innerJoin: () => b,
      leftJoin: () => b,
      where: (w: unknown) => { capturado.selects.push({ table, where: whereLegivel(w) }); return b; },
      orderBy: () => b,
      groupBy: () => b,
      offset: () => b,
      limit: () => b,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(proximaFila(table)).then(res, rej),
    };
    return b;
  }
  let proximoInsertId = 900;
  return {
    select: () => builder(),
    selectDistinct: () => builder(),
    insert: (t: any) => ({
      values: (v: any) => { capturado.inserts.push({ table: nomeTabela(t), values: v }); return Promise.resolve([{ insertId: ++proximoInsertId }]); },
    }),
    update: (t: any) => ({
      set: (s: any) => ({
        where: (w: unknown) => { capturado.updates.push({ table: nomeTabela(t), set: s, where: whereLegivel(w) }); return Promise.resolve([{ affectedRows: 1 }]); },
      }),
    }),
    delete: (t: any) => ({
      where: (w: unknown) => { capturado.deletes.push({ table: nomeTabela(t), where: whereLegivel(w) }); return Promise.resolve([{ affectedRows: 1 }]); },
    }),
    execute: (q: any) => {
      const cru = sqlCru(q);
      capturado.execs.push(cru);
      if (/^UPDATE/i.test(cru)) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[]]);
    },
  };
}
const dbInstance = makeDb();

vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  return { ...real, getDb: vi.fn(async () => dbInstance) };
});

const PERM = {
  allowed: true, verTodos: true, verProprios: false, criar: true, editar: true, excluir: true,
  colaboradorId: 10, escritorioId: 1, cargo: "dono",
};
const checkPermissionMock = vi.fn(async () => ({ ...PERM }));
vi.mock("../escritorio/check-permission", () => ({
  checkPermission: (...a: unknown[]) => (checkPermissionMock as any)(...a),
  checkPermissionAdminOuMatriz: (...a: unknown[]) => (checkPermissionMock as any)(...a),
}));
vi.mock("../billing/plan-limits", () => ({ verificarLimite: vi.fn(async () => ({ permitido: true })) }));
vi.mock("../escritorio/db-escritorio", async (importOriginal) => {
  const real = await importOriginal<typeof import("../escritorio/db-escritorio")>();
  return {
    ...real,
    getEscritorioPorUsuario: vi.fn(async () => ({
      escritorio: { id: 1, nome: "Escritório Exemplo Advocacia", fusoHorario: "America/Sao_Paulo" },
    })),
  };
});
const unificarContatosMock = vi.fn(async () => ({ tabelasAtualizadas: ["conversas"] }));
vi.mock("../escritorio/db-crm", async (importOriginal) => {
  const real = await importOriginal<typeof import("../escritorio/db-crm")>();
  return { ...real, unificarContatos: (...a: unknown[]) => unificarContatosMock(...(a as [])) };
});

const { appRouter } = await import("../routers");
const {
  telefoneInvalido, normalizarNome, nomesCompativeis, nomeIncompletoEntre, mascararCpfCnpj,
  divergenciasDoGrupo, classeDoGrupo, grupoPassaNoFiltro, FALTA_TIPOS, MENSAGEM_CPFS_DIFERENTES,
} = await import("../../shared/conferencia-cadastros");
const { modulosDaRota } = await import("../../shared/modulos-contratacao");
const {
  montarConferencia, faltasDasFichas, gerarConferenciaCsv, conferenciaParaTela, gruposFiltrados, COLUNAS_CSV,
  carregarBaseConferencia, marcarNaoDuplicado, desmarcarNaoDuplicado,
} = await import("../escritorio/conferencia-cadastros");
const { gerarConferenciaPDF } = await import("../escritorio/conferencia-pdf");

function ctx(): TrpcContext {
  return {
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X", loginMethod: "google", role: "user",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: { host: "app.juridflow.com.br" }, ip: "127.0.0.1" } as any,
    res: { clearCookie: () => {}, cookie: () => {} } as any,
  };
}
const caller = () => appRouter.createCaller(ctx());

// ─── Fixture: o escritório do mockup, com nomes fictícios ────────────────────

type Ficha = import("../escritorio/conferencia-cadastros").FichaBase;
const F = (over: Partial<Ficha> & { id: number; nome: string }): Ficha => ({
  telefone: null, telefonesSecundarios: null, cpfCnpj: null, email: null, estagio: "lead",
  origem: "whatsapp", createdAt: new Date("2026-09-01T12:00:00Z"), responsavelId: null, ...over,
});
const D = (s: string) => new Date(`2026-${s}T12:00:00Z`);

// CPFs válidos (dígito verificador confere) — só o 111.111.111-11 é inválido de propósito.
const CPF_MARIA = "52998224725";
const CPF_PEDRO = "12345678909";
const CPF_JOANA = "98765432100";
const CPF_FRANCISCO = "11144477735";
const CPF_ANA = "01234567890";
const CPF_EMAIL = "00000000191";

const FICHAS: Ficha[] = [
  // (85) 98123-4567 — 3 fichas, responsáveis diferentes, nome incompleto; CPF em duas delas
  F({ id: 977, nome: "Maria Clara Sousa Bezerra", telefone: "(85) 98123-4567", cpfCnpj: CPF_MARIA, estagio: "cliente", origem: "manual", createdAt: D("08-21"), responsavelId: 1 }),
  F({ id: 1201, nome: "Maria C. Bezerra", telefone: "5585981234567", cpfCnpj: CPF_MARIA, email: "mclara@exemplo.com", estagio: "cliente", origem: "asaas", createdAt: D("08-30"), responsavelId: 2 }),
  F({ id: 951, nome: "Maria Clara", telefone: "558581234567", createdAt: D("08-15"), responsavelId: 2 }),
  // (88) 99700-1122 — CPFs diferentes, nomes diferentes (casal)
  F({ id: 1042, nome: "Pedro Henrique Matos", telefone: "(88) 99700-1122", cpfCnpj: CPF_PEDRO, email: "pedro.matos@exemplo.com", estagio: "cliente", origem: "manual", createdAt: D("07-30"), responsavelId: 1 }),
  F({ id: 1188, nome: "Joana Matos Ribeiro", telefone: "88997001122", cpfCnpj: CPF_JOANA, estagio: "cliente", origem: "asaas", createdAt: D("08-12"), responsavelId: 1 }),
  // (85) 99611-7788 — e-mails diferentes
  F({ id: 300, nome: "Carlos Eduardo Pinto", telefone: "(85) 99611-7788", email: "carlos@exemplo.com", origem: "site", createdAt: D("06-03"), responsavelId: 2 }),
  F({ id: 301, nome: "Carlos E. Pinto", telefone: "5585996117788", email: "cadu.pinto@exemplo.com", createdAt: D("06-04"), responsavelId: 2 }),
  // (85) 99876-5432 — só falta preencher
  F({ id: 41, nome: "Francisco Nogueira Lima", telefone: "(85) 99876-5432", cpfCnpj: CPF_FRANCISCO, email: "francisco.n@exemplo.com", estagio: "cliente", origem: "manual", createdAt: D("09-08"), responsavelId: 2 }),
  F({ id: 40, nome: "Francisco", telefone: "558598765432", createdAt: D("09-02") }),
  // mesmo CPF da Maria com telefone fixo diferente
  F({ id: 1330, nome: "Maria Clara S. Bezerra", telefone: "(85) 3232-1010", cpfCnpj: CPF_MARIA, estagio: "cliente", origem: "manual", createdAt: D("09-02"), responsavelId: 1 }),
  // faltas e inválidos
  F({ id: 410, nome: "Ana Beatriz Fontes", cpfCnpj: CPF_ANA, email: "anab@exemplo.com", estagio: "cliente", origem: "manual", createdAt: D("03-12"), responsavelId: 1 }),
  F({ id: 411, nome: "Roberto Sales Andrade", telefone: "(85) 3232-9999", estagio: "cliente", origem: "asaas", createdAt: D("07-05") }),
  F({ id: 412, nome: "Lead sem nada", createdAt: D("09-03") }),
  F({ id: 413, nome: "Telefone curto", telefone: "8599", origem: "site" }),
  F({ id: 414, nome: "CPF repetido", telefone: "(85) 99999-0001", cpfCnpj: "111.111.111-11", estagio: "cliente", origem: "manual" }),
  F({ id: 415, nome: "E-mail torto", telefone: "(85) 99999-0002", cpfCnpj: CPF_EMAIL, email: "joao.silva", estagio: "cliente", origem: "manual" }),
  F({ id: 416, nome: "Fran 🌸", telefone: "5585999990003", createdAt: D("09-02") }),
  F({ id: 417, nome: "Só secundário", telefonesSecundarios: JSON.stringify(["85988887777"]), origem: "manual" }),
  F({ id: 418, nome: "Com processo", telefone: "5585999990004" }),
];
const CONTAGENS = {
  conversas: new Map([[40, 1], [951, 3], [300, 1], [301, 2]]),
  cobrancas: new Map([[41, 1], [1201, 1], [1188, 1], [410, 2]]),
  processos: new Map([[977, 2], [1042, 1], [418, 1]]),
};
const RESPONSAVEIS = new Map([[1, "Ana P."], [2, "Rodrigo Q."]]);
const base = (ignorados: Array<{ tipo: "telefone" | "cpf"; chave: string }> = []) => ({
  fichas: FICHAS, contagens: CONTAGENS, responsaveis: RESPONSAVEIS,
  ignorados: ignorados.map((i) => ({ ...i, marcadoPor: 10, createdAt: D("09-09") })),
});
const CHAVE_MARIA = "8581234567";
const CHAVE_CASAL = "8897001122";
const CHAVE_CARLOS = "8596117788";
const CHAVE_FRANCISCO = "8598765432";

// Filas que a procedure precisa pra montar a conferência do escritório 1.
function enfileirarBase() {
  filas["contatos"] = [FICHAS];
  filas["conversas"] = [[...CONTAGENS.conversas].map(([contatoId, n]) => ({ contatoId, n }))];
  filas["asaas_cobrancas"] = [[...CONTAGENS.cobrancas].map(([contatoId, n]) => ({ contatoId, n }))];
  filas["cliente_processos"] = [[...CONTAGENS.processos].map(([contatoId, n]) => ({ contatoId, n }))];
  // O porteiro de módulos do protectedProcedure também lê colaboradores — por isso `padroes`.
  padroes["colaboradores"] = [{ id: 1, nome: "Ana P." }, { id: 2, nome: "Rodrigo Q." }];
  filas["contatos_nao_duplicados"] = [[]];
}

beforeEach(() => {
  capturado.inserts = [];
  capturado.updates = [];
  capturado.deletes = [];
  capturado.selects = [];
  capturado.execs = [];
  for (const k of Object.keys(filas)) delete filas[k];
  for (const k of Object.keys(padroes)) delete padroes[k];
  unificarContatosMock.mockClear();
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue({ ...PERM });
});

// ─── Regras puras (shared) ───────────────────────────────────────────────────

describe("regras compartilhadas — o que é inválido, o que é divergente", () => {
  it("telefone inválido: menos de 10 dígitos, DDD inexistente, DDI de outro país, repetido; vazio NÃO é inválido", () => {
    expect(telefoneInvalido("")).toBe(false);
    expect(telefoneInvalido(null)).toBe(false);
    expect(telefoneInvalido("(85) 99876-5432")).toBe(false);
    expect(telefoneInvalido("5585998765432")).toBe(false);
    expect(telefoneInvalido("558598765432")).toBe(false);
    expect(telefoneInvalido("(85) 3232-1010")).toBe(false);
    expect(telefoneInvalido("8599")).toBe(true);
    expect(telefoneInvalido("+1 305 555 1234")).toBe(true);
    expect(telefoneInvalido("0000000000")).toBe(true);
    expect(telefoneInvalido("(20) 99876-5432")).toBe(true);
    expect(telefoneInvalido("85812345678")).toBe(true);
    expect(telefoneInvalido("+44 20 7946 0958")).toBe(true);
  });

  it("nome: abreviação e nome do perfil cabem no nome completo; outra pessoa não cabe", () => {
    expect(normalizarNome("Maria C. Bezerra")).toEqual(["maria", "c", "bezerra"]);
    expect(normalizarNome("João da Silva")).toEqual(["joao", "silva"]);
    expect(nomesCompativeis("Maria C. Bezerra", "Maria Clara Sousa Bezerra")).toBe(true);
    expect(nomesCompativeis("Fran 🌸", "Francisco Nogueira Lima")).toBe(true);
    expect(nomesCompativeis("Francisco", "Francisco Nogueira Lima")).toBe(true);
    expect(nomesCompativeis("Carlos E. Pinto", "Carlos Eduardo Pinto")).toBe(true);
    expect(nomesCompativeis("Joana Matos Ribeiro", "Pedro Henrique Matos")).toBe(false);
    expect(nomesCompativeis("Cadu Pinto", "Carlos Eduardo Pinto")).toBe(false);
    expect(nomesCompativeis("", "Qualquer")).toBe(true);
    expect(nomeIncompletoEntre(["Francisco", "Francisco Nogueira Lima"])).toBe(true);
    expect(nomeIncompletoEntre(["Francisco Nogueira Lima", "Francisco Nogueira Lima"])).toBe(false);
    expect(nomeIncompletoEntre(["Joana Matos Ribeiro", "Pedro Henrique Matos"])).toBe(false);
  });

  it("CPF e CNPJ mascarados escondem o miolo; lixo curto vira ***", () => {
    expect(mascararCpfCnpj("52998224725")).toBe("529.982.***-25");
    expect(mascararCpfCnpj("529.982.247-25")).toBe("529.982.***-25");
    expect(mascararCpfCnpj("12345678000195")).toBe("12.345.***/0001-95");
    expect(mascararCpfCnpj("12345")).toBe("12***45");
    expect(mascararCpfCnpj("123")).toBe("***");
    expect(mascararCpfCnpj(null)).toBe("");
  });

  it("divergência só quando os dois lados estão preenchidos e diferentes; ordem fixa", () => {
    const g = (ids: number[]) => FICHAS.filter((f) => ids.includes(f.id));
    expect(divergenciasDoGrupo(g([977, 1201, 951]), "telefone")).toEqual(["responsavel"]);
    expect(divergenciasDoGrupo(g([1042, 1188]), "telefone")).toEqual(["cpf", "nome"]);
    expect(divergenciasDoGrupo(g([300, 301]), "telefone")).toEqual(["email"]);
    expect(divergenciasDoGrupo(g([41, 40]), "telefone")).toEqual([]);
    expect(divergenciasDoGrupo(g([977, 1201, 1330]), "cpf")).toEqual(["responsavel", "telefone"]);
    // Em grupo de CPF, o CPF é igual por construção — nunca entra como divergência.
    expect(divergenciasDoGrupo(g([977, 1330]), "cpf")).not.toContain("cpf");
    // E-mail compara sem diferenciar maiúsculas.
    expect(divergenciasDoGrupo([
      { nome: "A", cpfCnpj: null, email: "X@exemplo.com", responsavelId: null, telefone: null },
      { nome: "A", cpfCnpj: null, email: "x@exemplo.com", responsavelId: null, telefone: null },
    ], "telefone")).toEqual([]);
  });

  it("classe do grupo e filtro: CPFs diferentes é classe própria; 'divergência' pega tudo que não é só falta", () => {
    expect(classeDoGrupo(["cpf", "nome"])).toBe("cpfs_diferentes");
    expect(classeDoGrupo(["cpf"])).toBe("cpfs_diferentes");
    expect(classeDoGrupo(["nome"])).toBe("com_divergencia");
    expect(classeDoGrupo(["email"])).toBe("com_divergencia");
    expect(classeDoGrupo([])).toBe("so_falta");
    expect(grupoPassaNoFiltro("cpfs_diferentes", "todos")).toBe(true);
    expect(grupoPassaNoFiltro("cpfs_diferentes", "divergencia")).toBe(true);
    expect(grupoPassaNoFiltro("com_divergencia", "divergencia")).toBe(true);
    expect(grupoPassaNoFiltro("so_falta", "divergencia")).toBe(false);
    expect(grupoPassaNoFiltro("com_divergencia", "cpfs_diferentes")).toBe(false);
    expect(grupoPassaNoFiltro("so_falta", "so_falta")).toBe(true);
  });

  it("/clientes/conferencia cai no módulo de Clientes, como a lista", () => {
    expect(modulosDaRota("/clientes/conferencia")).toEqual(modulosDaRota("/clientes"));
    expect(modulosDaRota("/clientes/conferencia")).toContain("clientes");
  });
});

// ─── Cálculo puro ────────────────────────────────────────────────────────────

describe("montarConferencia — um cálculo, três saídas", () => {
  const conf = montarConferencia(base());

  it("agrupa por telefone (mais fichas primeiro, depois pela chave), sobrevivente na frente", () => {
    expect(conf.gruposTelefone.map((g) => g.chave)).toEqual([CHAVE_MARIA, CHAVE_CARLOS, CHAVE_FRANCISCO, CHAVE_CASAL]);
    const maria = conf.gruposTelefone[0];
    expect(maria.sobreviventeId).toBe(977);
    expect(maria.fichas.map((f) => f.id)).toEqual([977, 1201, 951]);
    expect(maria.rotulo).toBe("(85) 98123-4567");
    expect(maria.divergencias).toEqual(["responsavel"]);
    expect(maria.classe).toBe("com_divergencia");
    expect(maria.nomeIncompleto).toBe(true);
    expect(maria.fichas[0]).toEqual(expect.objectContaining({ responsavelNome: "Ana P.", processos: 2, cpfCnpj: CPF_MARIA }));
    expect(maria.fichas[2]).toEqual(expect.objectContaining({ responsavelNome: "Rodrigo Q.", conversas: 3 }));
  });

  it("casal com o mesmo telefone é classe própria; o mais antigo sobrevive quando os dois têm CPF", () => {
    const casal = conf.gruposTelefone.find((g) => g.chave === CHAVE_CASAL)!;
    expect(casal.classe).toBe("cpfs_diferentes");
    expect(casal.divergencias).toEqual(["cpf", "nome"]);
    expect(casal.sobreviventeId).toBe(1042);
    expect(casal.nomeIncompleto).toBe(false);
  });

  it("agrupa por CPF e diz quando o grupo também aparece no telefone", () => {
    expect(conf.gruposCpf).toHaveLength(1);
    const g = conf.gruposCpf[0];
    expect(g.chave).toBe(CPF_MARIA);
    expect(g.rotulo).toBe("529.982.***-25");
    expect(g.fichas.map((f) => f.id)).toEqual([977, 1201, 1330]);
    expect(g.divergencias).toEqual(["responsavel", "telefone"]);
    expect(g.tambemNoTelefone).toBe(true);
  });

  it("resumo bate com as listas — é o 341 do cabeçalho, do card e do arquivo", () => {
    expect(conf.resumo.telefone).toEqual({ grupos: 4, fichas: 9, comDivergencia: 3, cpfsDiferentes: 1, soFalta: 1 });
    expect(conf.resumo.cpf).toEqual({ grupos: 1, fichas: 3, tambemNoTelefone: 1 });
    expect(conf.resumo.divergentes).toEqual({ grupos: 4, cpfsDiferentes: 1 });
    expect(conf.resumo.telefone.grupos).toBe(conf.gruposTelefone.length);
    expect(conf.fichas).toEqual({ total: FICHAS.length, clientes: 10, leads: FICHAS.length - 10 });
    expect(conf.todas).toHaveLength(FICHAS.length);
  });

  it("faltas: cada categoria com a régua do mockup, contando clientes e leads em separado", () => {
    const f = conf.faltas;
    expect([...f.sem_telefone.ids].sort()).toEqual([410, 412]);
    expect(f.sem_telefone).toEqual(expect.objectContaining({ clientes: 1, leads: 1 }));
    expect(f.sem_telefone.exemplo).toEqual(expect.objectContaining({ id: 410, nome: "Ana Beatriz Fontes", origem: "manual" }));
    expect(f.telefone_invalido.ids).toEqual([413]);
    expect(f.cliente_sem_cpf.ids).toEqual([411]);
    expect(f.cpf_invalido.ids).toEqual([414]);
    expect(f.email_invalido.ids).toEqual([415]);
    // Só o nome do perfil = lead do WhatsApp sem CPF, sem e-mail, sem processo (418 tem processo, 301 tem e-mail).
    expect([...f.so_nome_perfil.ids].sort((a, b) => a - b)).toEqual([40, 412, 416, 951]);
    expect(conf.resumo.semTelefoneOuInvalido).toBe(3);
    expect(conf.resumo.clienteSemCpfOuInvalido).toBe(2);
    // Telefone secundário conta como telefone.
    expect(f.sem_telefone.ids).not.toContain(417);
  });

  it("faltasDasFichas é a mesma função que a lista de Clientes usa no 'Ver na lista'", () => {
    const so = faltasDasFichas(FICHAS, (id) => (CONTAGENS.processos.get(id) ?? 0) > 0);
    for (const tipo of FALTA_TIPOS) expect(so[tipo].ids).toEqual(conf.faltas[tipo].ids);
  });

  it("'não é duplicado' tira o grupo de TODA conta e o guarda na lista própria (decisão 2)", () => {
    const c2 = montarConferencia(base([{ tipo: "telefone", chave: CHAVE_CASAL }, { tipo: "cpf", chave: CPF_MARIA }]));
    expect(c2.gruposTelefone.map((g) => g.chave)).not.toContain(CHAVE_CASAL);
    expect(c2.gruposCpf).toHaveLength(0);
    expect(c2.resumo.telefone.grupos).toBe(3);
    expect(c2.resumo.telefone.cpfsDiferentes).toBe(0);
    expect(c2.resumo.divergentes.grupos).toBe(2);
    expect(c2.resumo.ignorados).toBe(2);
    expect(c2.ignorados.map((g) => `${g.tipo}:${g.chave}`)).toEqual([`telefone:${CHAVE_CASAL}`, `cpf:${CPF_MARIA}`]);
    expect(c2.ignorados[0].ignorado).toEqual(expect.objectContaining({ marcadoPor: 10 }));
  });

  it("a projeção pra tela mascara o CPF e não carrega a lista de ids das faltas", () => {
    const tela = conferenciaParaTela(conf);
    const cpfs = [...tela.gruposTelefone, ...tela.gruposCpf].flatMap((g) => g.fichas.map((f) => f.cpfCnpj)).filter(Boolean);
    expect(cpfs.length).toBeGreaterThan(0);
    for (const c of cpfs) {
      expect(c).toMatch(/\*\*\*/);
      expect(c).not.toContain(CPF_MARIA);
    }
    expect(JSON.stringify(tela)).not.toContain(CPF_MARIA);
    // A chave do grupo de CPF é o CPF — na tela vira o id da sobrevivente.
    expect(tela.gruposCpf[0].chave).toBe("cpf-977");
    expect(tela.gruposTelefone[0].chave).toBe(CHAVE_MARIA);
    expect(tela.faltas.sem_telefone).toEqual({ total: 2, clientes: 1, leads: 1, exemplo: expect.objectContaining({ id: 410 }) });
    expect((tela.faltas.sem_telefone as any).ids).toBeUndefined();
  });

  it("o filtro vale pros dois tipos de grupo", () => {
    expect(gruposFiltrados(conf, "cpfs_diferentes").telefone.map((g) => g.chave)).toEqual([CHAVE_CASAL]);
    expect(gruposFiltrados(conf, "cpfs_diferentes").cpf).toHaveLength(0);
    expect(gruposFiltrados(conf, "so_falta").telefone.map((g) => g.chave)).toEqual([CHAVE_FRANCISCO]);
    expect(gruposFiltrados(conf, "divergencia").telefone).toHaveLength(3);
    expect(gruposFiltrados(conf, "divergencia").cpf).toHaveLength(1);
  });
});

// ─── Planilha e PDF ──────────────────────────────────────────────────────────

describe("planilha e PDF — mesma conta, com o filtro marcado", () => {
  const conf = montarConferencia(base());

  it("planilha: BOM, ponto-e-vírgula, as 16 colunas, uma linha por ficha, CPF inteiro (decisão 4)", () => {
    const csv = gerarConferenciaCsv(conf, "todos");
    expect(csv.startsWith("﻿")).toBe(true);
    const linhas = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(linhas[0]).toBe(COLUNAS_CSV.join(";"));
    expect(COLUNAS_CSV).toHaveLength(16);
    // 9 fichas nos grupos de telefone + 3 no de CPF + 11 linhas de falta (2+1+1+1+1+4 + 1 do 40 que… não: 40 já está em so_nome_perfil)
    const grupos = linhas.slice(1).filter((l) => l.startsWith("telefone;") || l.startsWith("cpf;"));
    expect(grupos).toHaveLength(12);
    const faltas = linhas.slice(1).filter((l) => l.startsWith("falta;"));
    expect(faltas).toHaveLength(2 + 1 + 1 + 1 + 1 + 4);
    const maria = linhas.find((l) => l.startsWith(`telefone;${CHAVE_MARIA};977;`))!;
    expect(maria).toContain(`;${CPF_MARIA};`);
    expect(maria).toContain(";Ana P.;");
    expect(maria.endsWith(";sim;responsavel")).toBe(true);
    const casal = linhas.find((l) => l.startsWith(`telefone;${CHAVE_CASAL};1188;`))!;
    expect(casal.endsWith(";não;cpf,nome")).toBe(true);
    const ana = linhas.find((l) => l.startsWith("falta;sem_telefone;410;"))!;
    expect(ana).toContain("Ana Beatriz Fontes");
    expect(ana).toContain(`;${CPF_ANA};`);
    // Data COM hora (fuso de Brasília): quatro fichas iguais no mesmo minuto é clique repetido.
    expect(ana).toContain(";12/03/2026 09:00;");
    // Telefone como está gravado, sem máscara padronizada.
    expect(linhas.find((l) => l.startsWith(`telefone;${CHAVE_MARIA};1201;`))).toContain(";5585981234567;");
  });

  it("planilha respeita o filtro nos grupos e escapa campo com ponto-e-vírgula ou aspas", () => {
    const csv = gerarConferenciaCsv(conf, "cpfs_diferentes");
    const grupos = csv.split("\r\n").filter((l) => l.startsWith("telefone;") || l.startsWith("cpf;"));
    expect(grupos).toHaveLength(2);
    const c2 = montarConferencia({ ...base(), fichas: [...FICHAS, F({ id: 999, nome: 'Fulano; "o" Tal', telefone: "(85) 99876-5432" })] });
    const csv2 = gerarConferenciaCsv(c2, "todos");
    expect(csv2).toContain('"Fulano; ""o"" Tal"');
  });

  it("origem 'manual' é 'Cadastro manual' na tela, no diálogo e no PDF — 'Clientes' ao lado de 'Lead' lia como se fosse cliente", () => {
    for (const arq of [
      "client/src/pages/clientes/ConferenciaCadastros.tsx",
      "client/src/pages/clientes/possiveis-duplicados.tsx",
      "server/escritorio/conferencia-pdf.ts",
    ]) {
      const texto = ler(arq);
      expect(texto).toContain('manual: "Cadastro manual"');
      expect(texto).not.toContain('manual: "Clientes"');
    }
  });

  it("PDF: a linha da tabela cresce com o texto (nome longo quebra sem cair em cima da ficha seguinte)", () => {
    const pdf = ler("server/escritorio/conferencia-pdf.ts");
    expect(pdf).toContain("doc.heightOfString(texto, { width: largura - 4 })");
    expect(pdf).toContain("Math.max(ALTURA_LINHA, ...valores.map((v, i) => alturaCelula(v, colunas[i].largura)))");
    expect(pdf).toContain("height: altura - ESPACO_LINHA, ellipsis: true");
    expect(pdf).not.toContain("lineBreak: false");
  });

  it("PDF sai como PDF, com título do escritório", async () => {
    const buf = await gerarConferenciaPDF(conf, { nomeEscritorio: "Escritório Exemplo", filtro: "todos", fuso: "America/Sao_Paulo" });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(2000);
    const vazio = await gerarConferenciaPDF(
      montarConferencia({ fichas: [], contagens: { conversas: new Map(), cobrancas: new Map(), processos: new Map() }, responsaveis: new Map(), ignorados: [] }),
      { nomeEscritorio: "Vazio", filtro: "so_falta", fuso: "America/Sao_Paulo" },
    );
    expect(vazio.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

// ─── Carga e "não é duplicado" no banco ──────────────────────────────────────

describe("carregarBaseConferencia / marcar / desmarcar", () => {
  it("lê fichas, contagens por escritório, nomes dos responsáveis e a lista de ignorados", async () => {
    filas["contatos"] = [FICHAS];
    filas["conversas"] = [[{ contatoId: 40, n: 1 }]];
    filas["asaas_cobrancas"] = [[{ contatoId: 41, n: 2 }]];
    filas["cliente_processos"] = [[]];
    filas["colaboradores"] = [[{ id: 1, nome: "Ana P." }]];
    filas["contatos_nao_duplicados"] = [[{ tipo: "telefone", chave: CHAVE_CASAL, marcadoPor: 10, createdAt: D("09-09") }]];
    const b = await carregarBaseConferencia(dbInstance, 1);
    expect(b.fichas).toHaveLength(FICHAS.length);
    expect(b.contagens.conversas.get(40)).toBe(1);
    expect(b.contagens.cobrancas.get(41)).toBe(2);
    expect(b.responsaveis.get(1)).toBe("Ana P.");
    expect(b.ignorados).toEqual([expect.objectContaining({ tipo: "telefone", chave: CHAVE_CASAL })]);
    // Contagens escopadas pelo escritório da tabela, não por lista de ids.
    for (const t of ["conversas", "asaas_cobrancas", "cliente_processos"]) {
      expect(capturado.selects.find((s) => s.table === t)?.where).toBe("escritorioId = 1");
    }
  });

  it("marcar grava uma vez por chave; desmarcar apaga pela mesma chave", async () => {
    filas["contatos_nao_duplicados"] = [[]];
    expect(await marcarNaoDuplicado(dbInstance, { escritorioId: 1, tipo: "telefone", chave: CHAVE_CASAL, marcadoPor: 10 })).toEqual({ ok: true, jaEstava: false });
    expect(capturado.inserts).toEqual([{ table: "contatos_nao_duplicados", values: { escritorioId: 1, tipo: "telefone", chave: CHAVE_CASAL, marcadoPor: 10 } }]);
    filas["contatos_nao_duplicados"] = [[{ id: 5 }]];
    expect(await marcarNaoDuplicado(dbInstance, { escritorioId: 1, tipo: "telefone", chave: CHAVE_CASAL, marcadoPor: 10 })).toEqual({ ok: true, jaEstava: true });
    expect(capturado.inserts).toHaveLength(1);
    await desmarcarNaoDuplicado(dbInstance, { escritorioId: 1, tipo: "cpf", chave: CPF_MARIA });
    expect(capturado.deletes).toEqual([{ table: "contatos_nao_duplicados", where: `escritorioId = 1 and tipo = cpf and chave = ${CPF_MARIA}` }]);
  });
});

// ─── Procedures ──────────────────────────────────────────────────────────────

describe("clientes.conferenciaCadastros / possiveisDuplicadosTelefone — a mesma conta", () => {
  it("sem permissão de excluir, a página não abre", async () => {
    checkPermissionMock.mockResolvedValue({ ...PERM, allowed: false, excluir: false });
    expect(await caller().clientes.conferenciaCadastros()).toEqual({ podeVer: false });
    await expect(caller().clientes.marcarNaoDuplicado({ tipo: "telefone", contatoId: 1042 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().clientes.desmarcarNaoDuplicado({ tipo: "telefone", contatoId: 1042 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().clientes.exportarConferenciaPdf({ filtro: "todos" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().clientes.exportarConferenciaCsv({ filtro: "todos" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(capturado.inserts).toHaveLength(0);
  });

  it("a página recebe resumo, grupos com CPF mascarado e faltas sem ids", async () => {
    enfileirarBase();
    const r = await caller().clientes.conferenciaCadastros();
    expect(r.podeVer).toBe(true);
    if (!r.podeVer) return;
    expect(r.resumo.telefone.grupos).toBe(4);
    expect(r.gruposTelefone[0].fichas[0].cpfCnpj).toBe("529.982.***-25");
    expect(JSON.stringify(r)).not.toContain(CPF_MARIA);
    expect(r.faltas.so_nome_perfil.total).toBe(4);
    expect(typeof r.geradoEm).toBe("string");
  });

  it("o '(N)' do botão Possíveis duplicados é o mesmo N do card, e marca quem tem CPFs diferentes", async () => {
    enfileirarBase();
    const pagina = await caller().clientes.conferenciaCadastros();
    enfileirarBase();
    const botao = await caller().clientes.possiveisDuplicadosTelefone();
    expect(botao.podeVer).toBe(true);
    expect(botao.grupos).toHaveLength(pagina.podeVer ? pagina.resumo.telefone.grupos : -1);
    const casal = botao.grupos.find((g) => g.chave === CHAVE_CASAL)!;
    expect(casal.cpfsDiferentes).toBe(true);
    expect(casal.sobrevivente.id).toBe(1042);
    expect(casal.mescladas.map((m) => m.id)).toEqual([1188]);
    expect(botao.grupos.find((g) => g.chave === CHAVE_MARIA)!.cpfsDiferentes).toBe(false);
    expect(botao.grupos.find((g) => g.chave === CHAVE_MARIA)!.sobrevivente).toEqual(expect.objectContaining({ id: 977, temCpf: true, processos: 2 }));
  });

  it("'não é duplicado' some dos dois lugares ao mesmo tempo", async () => {
    enfileirarBase();
    filas["contatos_nao_duplicados"] = [[{ tipo: "telefone", chave: CHAVE_CASAL, marcadoPor: 10, createdAt: D("09-09") }]];
    const pagina = await caller().clientes.conferenciaCadastros();
    enfileirarBase();
    filas["contatos_nao_duplicados"] = [[{ tipo: "telefone", chave: CHAVE_CASAL, marcadoPor: 10, createdAt: D("09-09") }]];
    const botao = await caller().clientes.possiveisDuplicadosTelefone();
    expect(pagina.podeVer && pagina.resumo.telefone.grupos).toBe(3);
    expect(botao.grupos.map((g) => g.chave)).not.toContain(CHAVE_CASAL);
    expect(pagina.podeVer && pagina.ignorados.map((g) => g.chave)).toEqual([CHAVE_CASAL]);
  });

  it("marcar e desmarcar apontam a ficha sobrevivente; a chave (o CPF) é resolvida no servidor, escopada", async () => {
    filas["contatos"] = [[{ telefone: "(85) 98123-4567", cpfCnpj: CPF_MARIA }]];
    filas["contatos_nao_duplicados"] = [[]];
    expect(await caller().clientes.marcarNaoDuplicado({ tipo: "cpf", contatoId: 977 })).toEqual({ ok: true, jaEstava: false });
    expect(capturado.inserts[0]).toEqual({ table: "contatos_nao_duplicados", values: { escritorioId: 1, tipo: "cpf", chave: CPF_MARIA, marcadoPor: 10 } });
    expect(capturado.selects.find((s) => s.table === "contatos")?.where).toBe("id = 977 and escritorioId = 1");

    filas["contatos"] = [[{ telefone: "(85) 98123-4567", cpfCnpj: CPF_MARIA }]];
    await caller().clientes.desmarcarNaoDuplicado({ tipo: "telefone", contatoId: 977 });
    expect(capturado.deletes[0].where).toBe(`escritorioId = 1 and tipo = telefone and chave = ${CHAVE_MARIA}`);

    // Ficha de outro escritório (ou sem o dado que agrupa) não marca nada.
    filas["contatos"] = [[]];
    await expect(caller().clientes.marcarNaoDuplicado({ tipo: "cpf", contatoId: 977 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    filas["contatos"] = [[{ telefone: "(85) 98123-4567", cpfCnpj: null }]];
    await expect(caller().clientes.marcarNaoDuplicado({ tipo: "cpf", contatoId: 977 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(capturado.inserts).toHaveLength(1);
  });
});

describe("clientes.mesclarDuplicados — trava dos CPFs diferentes (decisão 1)", () => {
  it("sem confirmação, o par com dois CPFs diferentes vira falha e nada é mesclado", async () => {
    filas["contatos"] = [[{ id: 1042, cpfCnpj: CPF_PEDRO }, { id: 1188, cpfCnpj: CPF_JOANA }]];
    const r = await caller().clientes.mesclarDuplicados({ pares: [{ principalId: 1042, duplicadoId: 1188 }] });
    expect(r.feitos).toEqual([]);
    expect(r.falhas).toEqual([{ duplicadoId: 1188, erro: MENSAGEM_CPFS_DIFERENTES }]);
    expect(unificarContatosMock).not.toHaveBeenCalled();
    expect(capturado.inserts).toHaveLength(0);
  });

  it("com confirmação explícita, mescla e registra como manual", async () => {
    const P = FICHAS.find((f) => f.id === 1042)!;
    const Dp = FICHAS.find((f) => f.id === 1188)!;
    filas["contatos"] = [[P], [Dp]];
    const r = await caller().clientes.mesclarDuplicados({ pares: [{ principalId: 1042, duplicadoId: 1188, confirmarCpfDiferente: true }] });
    expect(r.feitos).toEqual([1188]);
    expect(unificarContatosMock).toHaveBeenCalledWith(1, 1042, 1188);
    expect(capturado.inserts.find((i) => i.table === "contatos_unificacoes")?.values).toEqual(expect.objectContaining({ origem: "manual", executadoPor: 10 }));
  });

  it("um CPF só (ou nenhum) segue mesclando sem perguntar", async () => {
    const P = FICHAS.find((f) => f.id === 41)!;
    const Dp = FICHAS.find((f) => f.id === 40)!;
    filas["contatos"] = [[{ id: 41, cpfCnpj: CPF_FRANCISCO }, { id: 40, cpfCnpj: null }], [P], [Dp]];
    const r = await caller().clientes.mesclarDuplicados({ pares: [{ principalId: 41, duplicadoId: 40 }] });
    expect(r.feitos).toEqual([40]);
    expect(r.falhas).toEqual([]);
    // A consulta da trava é escopada pelo escritório de quem clicou.
    expect(capturado.selects.find((s) => s.table === "contatos")).toEqual({ table: "contatos", where: expect.stringContaining("escritorioId = 1 and id in") });
  });
});

describe("clientes.listar com ?conferencia — 'Ver na lista' mostra as MESMAS fichas que o card contou", () => {
  it("filtra pelos ids da falta", async () => {
    enfileirarBase();
    filas["contatos"] = [FICHAS, [], [{ count: 0 }]];
    await caller().clientes.listar({ conferencia: "sem_telefone", estagio: "todos" });
    const lista = capturado.selects.filter((s) => s.table === "contatos" && s.where.includes("id in"));
    expect(lista.length).toBeGreaterThan(0);
    expect(lista[0].where).toContain("410");
    expect(lista[0].where).toContain("412");
    expect(lista[0].where).not.toContain("413");
  });

  it("categoria vazia devolve lista vazia, não a base inteira", async () => {
    enfileirarBase();
    filas["contatos"] = [FICHAS.filter((f) => f.id !== 413), [], [{ count: 0 }]];
    await caller().clientes.listar({ conferencia: "telefone_invalido", estagio: "todos" });
    const lista = capturado.selects.filter((s) => s.table === "contatos" && s.where.includes("1 = 0"));
    expect(lista.length).toBeGreaterThan(0);
  });
});

describe("clientes.exportarConferenciaPdf / Csv", () => {
  it("planilha: nome com a data do escritório, base64 do CSV com BOM e CPF inteiro", async () => {
    enfileirarBase();
    const r = await caller().clientes.exportarConferenciaCsv({ filtro: "todos" });
    expect(r.filename).toMatch(/^conferencia-cadastros_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(r.mimeType).toBe("text/csv;charset=utf-8");
    const texto = Buffer.from(r.base64, "base64").toString("utf8");
    expect(texto.startsWith("﻿grupo;chave;id;nome")).toBe(true);
    expect(texto).toContain(CPF_MARIA);
  });

  it("PDF: nome com a data do escritório e conteúdo PDF", async () => {
    enfileirarBase();
    const r = await caller().clientes.exportarConferenciaPdf({ filtro: "divergencia" });
    expect(r.filename).toMatch(/^conferencia-cadastros_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(r.mimeType).toBe("application/pdf");
    expect(Buffer.from(r.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });
});

// ─── Amarras de texto: rota, botão, diálogo antigo, migration, backup ────────

describe("telas e infra", () => {
  it("a página existe, tem rota própria dentro da área do app e o botão mora no cabeçalho de Clientes", () => {
    const app = ler("client/src/App.tsx");
    expect(app).toContain('import ConferenciaCadastros from "./pages/clientes/ConferenciaCadastros";');
    expect(app).toContain('<Route path="/clientes/conferencia">');
    expect(app.indexOf('<Route path="/clientes/conferencia">')).toBeLessThan(app.indexOf('<Route path="/clientes">'));
    const clientes = ler("client/src/pages/Clientes.tsx");
    expect(clientes).toContain('onClick={() => setLocation("/clientes/conferencia")}');
    expect(clientes).toContain("Conferência de cadastros");
    // Só quem pode excluir clientes vê o botão — a mesma permissão da página.
    expect(clientes).toMatch(/\{podeExcluirCliente && \(\s*<Button[\s\S]*?\/clientes\/conferencia/);
    // Os dois botões de hoje continuam onde estão.
    expect(clientes).toContain('"Duplicatas (PDF)"');
    expect(clientes).toContain("<PossiveisDuplicadosButton onMesclado={() => { refetch(); refetchStats(); }} />");
  });

  it("a lista de Clientes lê ?conferencia= da URL, manda pro servidor, mostra o chip e limpa junto", () => {
    const clientes = ler("client/src/pages/Clientes.tsx");
    expect(clientes).toContain('new URLSearchParams(window.location.search).get("conferencia")');
    expect(clientes).toContain("conferencia: conferencia ?? undefined,");
    expect(clientes).toContain('if (conferencia) params.set("conferencia", conferencia);');
    expect(clientes).toContain("Conferência: {ROTULO_FALTA[conferencia]}");
    expect(clientes).toContain("onClick={() => { setFiltros(FILTROS_VAZIOS); setBusca(\"\"); setConferencia(null); }}");
  });

  it("a página: abas, filtros, Mesclar mesmo assim com confirmação, Não é duplicado, Ver na lista, PDF e planilha", () => {
    const pagina = ler("client/src/pages/clientes/ConferenciaCadastros.tsx");
    for (const trecho of [
      "clientes.conferenciaCadastros.useQuery(",
      "clientes.mesclarDuplicados.useMutation(",
      "clientes.marcarNaoDuplicado.useMutation(",
      "clientes.desmarcarNaoDuplicado.useMutation(",
      "clientes.exportarConferenciaPdf.useMutation(",
      "clientes.exportarConferenciaCsv.useMutation(",
      "Mesclar mesmo assim",
      "Não é duplicado",
      "Voltar a considerar",
      "Ver na lista",
      "setLocation(`/clientes?conferencia=${tipo}`)",
      "confirmarCpfDiferente: true",
      "<AlertDialog",
      "Mesclar todos os \"só falta preencher\"",
      'g.classe === "so_falta"',
      "bg-warning-bg",
      "bg-danger-bg",
    ]) {
      expect(pagina).toContain(trecho);
    }
    // "Mesclar todos" e "Mesclar mesmo assim" passam pelo AlertDialog — nunca confirm() nativo.
    expect(pagina).not.toMatch(/\bconfirm\(/);
    // O lote respeita o máximo de 50 pares por chamada do servidor.
    expect(pagina).toContain("pares.slice(i, i + 50)");
  });

  it("o diálogo 'Possíveis duplicados' de hoje ganhou a trava: pula CPFs diferentes no lote e pede confirmação na linha", () => {
    const dup = ler("client/src/pages/clientes/possiveis-duplicados.tsx");
    expect(dup).toContain("grupos.filter((g) => !g.cpfsDiferentes).flatMap((g) => paresDoGrupo(g))");
    expect(dup).toContain("Mesclar mesmo assim");
    expect(dup).toContain("confirmarCpfDiferente: true");
    expect(dup).toContain("<AlertDialog");
    expect(dup).toContain("if (grupos.length === 0) return null;");
    expect(dup).toContain("Mesclar todos");
    expect(dup).not.toMatch(/\bconfirm\(/);
  });

  it("migration 0219, schema e backup conhecem a tabela contatos_nao_duplicados", () => {
    expect(existsSync(join(raiz, "drizzle/0219_contatos_nao_duplicados.sql"))).toBe(true);
    const sql = ler("drizzle/0219_contatos_nao_duplicados.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS contatos_nao_duplicados");
    expect(sql).toContain("UNIQUE KEY uq_nao_dup (escritorioIdNaoDup, tipoNaoDup, chaveNaoDup)");
    expect(ler("drizzle/schema.ts")).toContain('mysqlTable("contatos_nao_duplicados"');
    const backup = ler("server/backup/escritorio-tabelas.ts");
    expect(backup).toContain('{ nomeBanco: "contatos_nao_duplicados", colunaEscritorio: "escritorioIdNaoDup", categoria: "dados" }');
  });
});
