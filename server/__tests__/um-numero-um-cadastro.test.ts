/**
 * Um número, um cadastro (mockup `mockup-reconhecer-cadastro`, "Gostei, pode
 * fazer" do dono em 09/09/2026, com as quatro decisões da proposta):
 *
 *  1. cadastrar um telefone que já tem ficha AVISA e oferece completar — a
 *     segunda ficha só nasce com o clique consciente (`forcarSeparado`);
 *  2. ficha magra presa à conversa é absorvida SOZINHA pelo cadastro
 *     completo do mesmo número, com aviso e "Desfazer" por 7 dias;
 *  3. sobrevive a ficha com CPF; em empate, a mais antiga;
 *  4. o telefone aparece padronizado nas telas (o gravado não muda).
 *
 * E o endereço de resposta da conversa acompanha de onde o cliente escreveu
 * — era o 131047 do Francisco: "Bom dia" entrava na conversa e a resposta
 * saía pro identificador antigo, sem janela de 24h.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

// ─── Banco falso: filas por tabela + captura de escritas e de SQL cru ──────

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
// Resposta fixa por tabela quando a fila acaba — o porteiro de módulos do
// `protectedProcedure` também consulta `colaboradores`, e comeria a fila.
const padroes: Record<string, any[]> = {};
const execFila: any[][] = [];
const capturado = {
  inserts: [] as { table: string; values: any }[],
  updates: [] as { table: string; set: any; where: string }[],
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
      where: () => b,
      orderBy: () => b,
      groupBy: () => b,
      limit: () => Promise.resolve(proximaFila(table)),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(proximaFila(table)).then(res, rej),
    };
    return b;
  }
  let proximoInsertId = 900;
  return {
    select: () => builder(),
    insert: (t: any) => ({
      values: (v: any) => { capturado.inserts.push({ table: nomeTabela(t), values: v }); return Promise.resolve([{ insertId: ++proximoInsertId }]); },
    }),
    update: (t: any) => ({
      set: (s: any) => ({
        where: (w: unknown) => { capturado.updates.push({ table: nomeTabela(t), set: s, where: whereLegivel(w) }); return Promise.resolve([{ affectedRows: 1 }]); },
      }),
    }),
    execute: (q: any) => {
      const cru = sqlCru(q);
      capturado.execs.push(cru);
      if (/^UPDATE/i.test(cru)) return Promise.resolve([{ affectedRows: 1 }]);
      const resposta = execFila.length > 0 ? execFila.shift()! : [];
      return Promise.resolve([resposta]);
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

const buscarContatosPorTelefoneMock = vi.fn(async (): Promise<any[]> => []);
const unificarContatosMock = vi.fn(async () => ({ tabelasAtualizadas: ["conversas"] }));
vi.mock("../escritorio/db-crm", async (importOriginal) => {
  const real = await importOriginal<typeof import("../escritorio/db-crm")>();
  return {
    ...real,
    buscarContatosPorTelefone: (...a: unknown[]) => buscarContatosPorTelefoneMock(...(a as [])),
    unificarContatos: (...a: unknown[]) => unificarContatosMock(...(a as [])),
  };
});

const { appRouter } = await import("../routers");
const {
  ehFichaMagra, escolherSobrevivente, agruparPorTelefone, atualizarEnderecoDeResposta,
  reconhecerCadastroNaEntrada, unificarComRegistro, desfazerUnificacao, unificacaoRecente,
  JANELA_DESFAZER_MS,
} = await import("../escritorio/reconhecer-cadastro");

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

const DIA = 24 * 60 * 60 * 1000;
const MAGRA = { id: 40, escritorioId: 1, nome: "Francisco", telefone: "558598765432", cpfCnpj: null, email: null, estagio: "lead", origem: "whatsapp", createdAt: new Date("2026-09-02T12:00:00Z"), observacoes: null, telefonesSecundarios: null };
const COMPLETA = { id: 41, escritorioId: 1, nome: "Francisco Nogueira Lima", telefone: "(85) 99876-5432", cpfCnpj: "81012345640", email: null, estagio: "cliente", origem: "manual", createdAt: new Date("2026-09-08T12:00:00Z"), observacoes: "obs", telefonesSecundarios: null };

beforeEach(() => {
  capturado.inserts = [];
  capturado.updates = [];
  capturado.execs = [];
  execFila.length = 0;
  for (const k of Object.keys(filas)) delete filas[k];
  for (const k of Object.keys(padroes)) delete padroes[k];
  buscarContatosPorTelefoneMock.mockReset();
  buscarContatosPorTelefoneMock.mockResolvedValue([]);
  unificarContatosMock.mockClear();
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue({ ...PERM });
});

// ─── Regras puras ─────────────────────────────────────────────────────────────

describe("regras puras — a mesma régua do “Vincular”", () => {
  it("ficha magra = sem CPF, sem e-mail, ainda lead e sem processo; qualquer sinal a torna cadastro", () => {
    expect(ehFichaMagra({ cpfCnpj: null, email: null, estagio: "lead" }, false)).toBe(true);
    expect(ehFichaMagra({ cpfCnpj: "  ", email: "", estagio: "lead" }, false)).toBe(true);
    expect(ehFichaMagra({ cpfCnpj: "81012345640", email: null, estagio: "lead" }, false)).toBe(false);
    expect(ehFichaMagra({ cpfCnpj: null, email: "a@b.c", estagio: "lead" }, false)).toBe(false);
    expect(ehFichaMagra({ cpfCnpj: null, email: null, estagio: "cliente" }, false)).toBe(false);
    expect(ehFichaMagra({ cpfCnpj: null, email: null, estagio: "lead" }, true)).toBe(false);
  });

  it("sobrevive a ficha com CPF (decisão 3); em empate, a mais antiga; empate total, o menor id", () => {
    const semCpfAntiga = { id: 1, cpfCnpj: null, email: null, estagio: "lead", createdAt: new Date("2026-01-01") };
    const comCpfNova = { id: 2, cpfCnpj: "81012345640", email: null, estagio: "cliente", createdAt: new Date("2026-09-01") };
    expect(escolherSobrevivente(semCpfAntiga, comCpfNova).principal.id).toBe(2);
    expect(escolherSobrevivente(comCpfNova, semCpfAntiga).principal.id).toBe(2);
    const a = { ...semCpfAntiga, id: 5 };
    const b = { ...semCpfAntiga, id: 6, createdAt: new Date("2026-02-01") };
    expect(escolherSobrevivente(b, a).principal.id).toBe(5);
    expect(escolherSobrevivente({ ...a, id: 9 }, { ...a, id: 8 }).principal.id).toBe(8);
    // Data ausente conta como "mais nova": não rouba a sobrevivência de quem tem histórico.
    expect(escolherSobrevivente({ ...a, id: 3, createdAt: null }, a).principal.id).toBe(5);
  });

  it("agrupa pelo telefone em todas as formas (com/sem 9, com/sem 55, com máscara) e ignora quem está sozinho", () => {
    const grupos = agruparPorTelefone([
      { id: 1, telefone: "(85) 99876-5432" },
      { id: 2, telefone: "558598765432" },
      { id: 3, telefone: "85998765432" },
      { id: 4, telefone: "(85) 3222-1111" },
      { id: 5, telefone: null },
      { id: 6, telefone: "lixo" },
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].chave).toBe("8598765432");
    expect(grupos[0].contatos.map((c) => c.id)).toEqual([1, 2, 3]);
  });
});

// ─── Endereço de resposta ────────────────────────────────────────────────────

describe("atualizarEnderecoDeResposta — a resposta vai pra onde o cliente escreveu", () => {
  it("troca o endereço quando o cliente escreveu de outro identificador de telefone", async () => {
    filas["conversas"] = [[{ chatIdExterno: "5585998765432@s.whatsapp.net" }]];
    const r = await atualizarEnderecoDeResposta(dbInstance, { escritorioId: 1, conversaId: 7, chatId: "558598765432@s.whatsapp.net" });
    expect(r).toBe(true);
    expect(capturado.updates).toEqual([expect.objectContaining({ table: "conversas", set: { chatIdExterno: "558598765432@s.whatsapp.net" }, where: "id = 7 and escritorioId = 1" })]);
  });

  it("não mexe quando é o mesmo endereço, quando é @lid ou quando a conversa não é do escritório", async () => {
    filas["conversas"] = [[{ chatIdExterno: "558598765432@s.whatsapp.net" }]];
    expect(await atualizarEnderecoDeResposta(dbInstance, { escritorioId: 1, conversaId: 7, chatId: "558598765432@s.whatsapp.net" })).toBe(false);
    expect(await atualizarEnderecoDeResposta(dbInstance, { escritorioId: 1, conversaId: 7, chatId: "123456789012345@lid" })).toBe(false);
    filas["conversas"] = [[]];
    expect(await atualizarEnderecoDeResposta(dbInstance, { escritorioId: 1, conversaId: 7, chatId: "558598765432@s.whatsapp.net" })).toBe(false);
    expect(capturado.updates).toHaveLength(0);
  });
});

// ─── Reconhecimento na entrada ───────────────────────────────────────────────

describe("reconhecerCadastroNaEntrada — a conversa segue o cadastro completo", () => {
  const entrada = { escritorioId: 1, conversaId: 7, contatoId: 40, chatId: "558598765432@s.whatsapp.net", telefone: "558598765432" };

  it("ficha magra + cadastro completo do mesmo número → absorve (decisão 2) e devolve o sobrevivente", async () => {
    filas["conversas"] = [[{ chatIdExterno: entrada.chatId }]];
    filas["contatos"] = [[MAGRA], [COMPLETA], [MAGRA]];
    filas["cliente_processos"] = [[], []];
    buscarContatosPorTelefoneMock.mockResolvedValue([COMPLETA]);
    execFila.push([{ id: 501 }, { id: 502 }]); // conversas movidas

    const r = await reconhecerCadastroNaEntrada(dbInstance, entrada);

    expect(r.contatoId).toBe(41);
    expect(r.unificacaoId).toBeGreaterThan(0);
    expect(buscarContatosPorTelefoneMock).toHaveBeenCalledWith(1, "558598765432", { excetoId: 40 });
    expect(unificarContatosMock).toHaveBeenCalledWith(1, 41, 40);
    const reg = capturado.inserts.find((i) => i.table === "contatos_unificacoes")!;
    expect(reg.values).toEqual(expect.objectContaining({ escritorioId: 1, principalId: 41, duplicadoId: 40, origem: "automatica", executadoPor: null }));
    expect(reg.values.duplicadoSnapshot).toEqual(expect.objectContaining({ id: 40, nome: "Francisco" }));
    expect(reg.values.movidos).toEqual({ conversas: [501, 502] });
    expect(reg.values.principalAntes).toEqual({ email: null, cpfCnpj: "81012345640", observacoes: "obs", telefonesSecundarios: null });
  });

  it("ficha que já é cadastro (CPF) não é mexida — nem procura outras", async () => {
    filas["conversas"] = [[{ chatIdExterno: entrada.chatId }]];
    filas["contatos"] = [[COMPLETA]];
    filas["cliente_processos"] = [[]];
    const r = await reconhecerCadastroNaEntrada(dbInstance, { ...entrada, contatoId: 41 });
    expect(r.contatoId).toBe(41);
    expect(r.unificacaoId).toBeNull();
    expect(buscarContatosPorTelefoneMock).not.toHaveBeenCalled();
    expect(unificarContatosMock).not.toHaveBeenCalled();
  });

  it("ficha magra sem cadastro completo do mesmo número fica como está (outra magra não conta)", async () => {
    filas["conversas"] = [[{ chatIdExterno: entrada.chatId }]];
    filas["contatos"] = [[MAGRA]];
    filas["cliente_processos"] = [[], []];
    buscarContatosPorTelefoneMock.mockResolvedValue([{ ...MAGRA, id: 55, nome: "Chico" }]);
    const r = await reconhecerCadastroNaEntrada(dbInstance, entrada);
    expect(r.contatoId).toBe(40);
    expect(unificarContatosMock).not.toHaveBeenCalled();
  });

  it("ficha magra com processo é cadastro de verdade — não é absorvida", async () => {
    filas["conversas"] = [[{ chatIdExterno: entrada.chatId }]];
    filas["contatos"] = [[MAGRA]];
    filas["cliente_processos"] = [[{ id: 1 }]];
    buscarContatosPorTelefoneMock.mockResolvedValue([COMPLETA]);
    const r = await reconhecerCadastroNaEntrada(dbInstance, entrada);
    expect(r.contatoId).toBe(40);
    expect(unificarContatosMock).not.toHaveBeenCalled();
  });

  it("entre dois cadastros completos, o que tem CPF sobrevive mesmo sendo mais novo (decisão 3)", async () => {
    const comEmailAntigo = { ...COMPLETA, id: 60, cpfCnpj: null, email: "f@x.adv.br", estagio: "lead", createdAt: new Date("2026-01-01T00:00:00Z") };
    filas["conversas"] = [[{ chatIdExterno: entrada.chatId }]];
    filas["contatos"] = [[MAGRA], [COMPLETA], [MAGRA]];
    filas["cliente_processos"] = [[], [], []];
    buscarContatosPorTelefoneMock.mockResolvedValue([comEmailAntigo, COMPLETA]);
    const r = await reconhecerCadastroNaEntrada(dbInstance, entrada);
    expect(r.contatoId).toBe(41);
    expect(unificarContatosMock).toHaveBeenCalledWith(1, 41, 40);
  });
});

// ─── Desfazer ────────────────────────────────────────────────────────────────

describe("desfazerUnificacao — 7 dias pra voltar atrás", () => {
  const agora = Date.parse("2026-09-09T15:00:00Z");
  const REG = {
    id: 3, escritorioId: 1, principalId: 41, duplicadoId: 40, origem: "automatica",
    duplicadoSnapshot: { ...MAGRA, createdAt: "2026-09-02T12:00:00.000Z", updatedAt: "2026-09-02T12:00:00.000Z" },
    principalAntes: { email: null, cpfCnpj: "81012345640", observacoes: "obs", telefonesSecundarios: null },
    movidos: { conversas: [501, 502], asaas_cobrancas: [9] },
    executadoPor: null, desfeitaEm: null, desfeitaPor: null,
    createdAt: new Date(agora - 2 * DIA),
  };

  it("recria a ficha com o MESMO id, devolve as linhas movidas e restaura a sobrevivente", async () => {
    filas["contatos_unificacoes"] = [[REG]];
    filas["contatos"] = [[]];
    const r = await desfazerUnificacao(dbInstance, { escritorioId: 1, id: 3, executadoPor: 10, agoraMs: agora });
    expect(r).toEqual({ principalId: 41, duplicadoId: 40 });

    const recriada = capturado.inserts.find((i) => i.table === "contatos")!;
    expect(recriada.values).toEqual(expect.objectContaining({ id: 40, escritorioId: 1, nome: "Francisco", telefone: "558598765432" }));
    expect(recriada.values.createdAt).toBeInstanceOf(Date);

    expect(capturado.execs).toEqual([
      "UPDATE `conversas` SET `contatoIdConv` = 40 WHERE id IN (501,502)",
      "UPDATE `asaas_cobrancas` SET `contatoIdAsaasCob` = 40 WHERE id IN (9)",
    ]);
    const restaura = capturado.updates.find((u) => u.table === "contatos")!;
    expect(restaura.set).toEqual({ email: null, cpfCnpj: "81012345640", observacoes: "obs", telefonesSecundarios: null });
    expect(restaura.where).toBe("id = 41 and escritorioId = 1");
    const fecha = capturado.updates.find((u) => u.table === "contatos_unificacoes")!;
    expect(fecha.set).toEqual(expect.objectContaining({ desfeitaPor: 10 }));
    expect(fecha.set.desfeitaEm).toBeInstanceOf(Date);
  });

  it("recusa quando já foi desfeita, quando passou dos 7 dias ou quando a ficha já existe de novo", async () => {
    filas["contatos_unificacoes"] = [[{ ...REG, desfeitaEm: new Date() }]];
    await expect(desfazerUnificacao(dbInstance, { escritorioId: 1, id: 3, executadoPor: 10, agoraMs: agora })).rejects.toThrow("já foi desfeita");

    filas["contatos_unificacoes"] = [[{ ...REG, createdAt: new Date(agora - JANELA_DESFAZER_MS - 1000) }]];
    await expect(desfazerUnificacao(dbInstance, { escritorioId: 1, id: 3, executadoPor: 10, agoraMs: agora })).rejects.toThrow("7 dias");

    filas["contatos_unificacoes"] = [[REG]];
    filas["contatos"] = [[{ id: 40 }]];
    await expect(desfazerUnificacao(dbInstance, { escritorioId: 1, id: 3, executadoPor: 10, agoraMs: agora })).rejects.toThrow("já existe");
    expect(capturado.inserts).toHaveLength(0);
    expect(capturado.execs).toHaveLength(0);
  });

  it("unificacaoRecente devolve o aviso da conversa com as contagens do que foi junto", async () => {
    filas["contatos_unificacoes"] = [[REG]];
    filas["contatos"] = [[{ nome: "Francisco Nogueira Lima" }]];
    const r = await unificacaoRecente(dbInstance, { escritorioId: 1, contatoId: 41, agoraMs: agora });
    expect(r).toEqual(expect.objectContaining({
      id: 3, origem: "automatica", principalNome: "Francisco Nogueira Lima",
      duplicadoNome: "Francisco", duplicadoTelefone: "558598765432", duplicadoOrigem: "whatsapp",
      contagens: { conversas: 2, cobrancas: 1, processos: 0, leads: 0, arquivos: 0 },
    }));
    filas["contatos_unificacoes"] = [[]];
    expect(await unificacaoRecente(dbInstance, { escritorioId: 1, contatoId: 41, agoraMs: agora })).toBeNull();
  });
});

// ─── Procedures ──────────────────────────────────────────────────────────────

describe("clientes.verificarTelefone — o aviso enquanto digita", () => {
  it("só pergunta com DDD + número completo; devolve a ficha que sobreviveria e o contexto do atendimento", async () => {
    expect(await caller().clientes.verificarTelefone({ telefone: "(85) 9987" })).toBeNull();
    expect(buscarContatosPorTelefoneMock).not.toHaveBeenCalled();

    buscarContatosPorTelefoneMock.mockResolvedValue([MAGRA, COMPLETA]);
    filas["conversas"] = [[{ id: 7, atendenteId: 10 }]];
    padroes["colaboradores"] = [{ nome: "Rodrigo Q." }];
    const r = await caller().clientes.verificarTelefone({ telefone: "(85) 99876-5432" });
    expect(buscarContatosPorTelefoneMock).toHaveBeenCalledWith(1, "85998765432", { excetoId: undefined });
    expect(r).toEqual(expect.objectContaining({ id: 41, nome: "Francisco Nogueira Lima", temCpf: true, conversasAbertas: 1, atendenteNome: "Rodrigo Q.", outros: 1 }));
  });

  it("sem ficha com o número, devolve null", async () => {
    expect(await caller().clientes.verificarTelefone({ telefone: "85998765432" })).toBeNull();
  });
});

describe("clientes.criar — telefone que já tem ficha (decisão 1)", () => {
  const base = { nome: "Francisco Nogueira Lima", telefone: "(85) 99876-5432", cpfCnpj: "529.982.247-25" };

  it("sem escolha, recusa com o id da ficha existente na mensagem (o mesmo formato do CPF duplicado)", async () => {
    filas["contatos"] = [[]];
    buscarContatosPorTelefoneMock.mockResolvedValue([MAGRA]);
    await expect(caller().clientes.criar(base)).rejects.toMatchObject({
      code: "CONFLICT",
      message: 'Telefone já cadastrado para "Francisco" [ID:40]',
    });
    expect(capturado.inserts).toHaveLength(0);
  });

  it("“Criar separado mesmo assim” passa `forcarSeparado` e a segunda ficha nasce", async () => {
    filas["contatos"] = [[]];
    buscarContatosPorTelefoneMock.mockResolvedValue([MAGRA]);
    const r = await caller().clientes.criar({ ...base, forcarSeparado: true });
    expect(r.id).toBeGreaterThan(0);
    expect(capturado.inserts.find((i) => i.table === "contatos")?.values).toEqual(expect.objectContaining({ nome: base.nome, telefone: base.telefone }));
  });

  it("“Completar esse cadastro” preenche a ficha magra: nome, CPF, vira cliente; conversa e responsável ficam", async () => {
    filas["contatos"] = [[], [{ ...MAGRA, responsavelId: 22, tags: null, camposPersonalizados: null, documentacaoPendente: false, documentacaoObservacoes: null, profissao: null, estadoCivil: null, nacionalidade: null, cep: null, logradouro: null, numeroEndereco: null, complemento: null, bairro: null, cidade: null, uf: null }]];
    const r = await caller().clientes.criar({ ...base, completarContatoId: 40, email: "f@x.adv.br" });
    expect(r.id).toBe(40);
    expect(capturado.inserts).toHaveLength(0);
    const up = capturado.updates.find((u) => u.table === "contatos")!;
    expect(up.where).toBe("id = 40 and escritorioId = 1");
    expect(up.set).toEqual(expect.objectContaining({
      nome: "Francisco Nogueira Lima", cpfCnpj: "529.982.247-25", email: "f@x.adv.br",
      telefone: "558598765432", responsavelId: 22, estagio: "cliente",
    }));
  });

  it("completar uma ficha de OUTRO telefone é recusado — o número é a prova de que é a mesma pessoa", async () => {
    filas["contatos"] = [[], [{ ...MAGRA, telefone: "(85) 3222-1111" }]];
    await expect(caller().clientes.criar({ ...base, completarContatoId: 40 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(capturado.updates).toHaveLength(0);
  });

  it("ficha pra completar de outro escritório não é encontrada", async () => {
    filas["contatos"] = [[], []];
    await expect(caller().clientes.criar({ ...base, completarContatoId: 40 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("clientes.possiveisDuplicadosTelefone / mesclarDuplicados — a faxina", () => {
  it("agrupa pelo número, escolhe quem sobrevive e conta o que cada ficha carrega", async () => {
    filas["contatos"] = [[MAGRA, COMPLETA, { ...MAGRA, id: 70, nome: "Maria", telefone: "(85) 98123-4567" }]];
    filas["conversas"] = [[{ contatoId: 40, n: 1 }]];
    filas["asaas_cobrancas"] = [[{ contatoId: 41, n: 1 }]];
    filas["cliente_processos"] = [[]];
    const r = await caller().clientes.possiveisDuplicadosTelefone();
    expect(r.podeVer).toBe(true);
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0].sobrevivente).toEqual(expect.objectContaining({ id: 41, temCpf: true, cobrancas: 1 }));
    expect(r.grupos[0].mescladas).toEqual([expect.objectContaining({ id: 40, conversas: 1, temCpf: false })]);
  });

  it("sem permissão de excluir, a lista nem existe", async () => {
    checkPermissionMock.mockResolvedValue({ ...PERM, allowed: false, excluir: false });
    expect(await caller().clientes.possiveisDuplicadosTelefone()).toEqual({ podeVer: false, grupos: [] });
    await expect(caller().clientes.mesclarDuplicados({ pares: [{ principalId: 41, duplicadoId: 40 }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(unificarContatosMock).not.toHaveBeenCalled();
  });

  it("mesclar registra cada par como manual, assinado por quem clicou, e não para no primeiro erro", async () => {
    filas["contatos"] = [[COMPLETA], [MAGRA], [COMPLETA], []];
    const r = await caller().clientes.mesclarDuplicados({ pares: [{ principalId: 41, duplicadoId: 40 }, { principalId: 41, duplicadoId: 77 }] });
    expect(r.feitos).toEqual([40]);
    expect(r.falhas).toEqual([{ duplicadoId: 77, erro: "Contato duplicado não encontrado" }]);
    expect(unificarContatosMock).toHaveBeenCalledTimes(1);
    expect(capturado.inserts.find((i) => i.table === "contatos_unificacoes")?.values).toEqual(expect.objectContaining({ origem: "manual", executadoPor: 10 }));
  });
});

describe("crm.unificarContatos / desfazerUnificacao / unificacaoRecente", () => {
  it("o “Mesclar” manual da ficha passou a deixar registro desfazível", async () => {
    filas["contatos"] = [[COMPLETA], [MAGRA]];
    const r = await caller().crm.unificarContatos({ principalId: 41, duplicadoId: 40 });
    expect(r.unificacaoId).toBeGreaterThan(0);
    expect(unificarContatosMock).toHaveBeenCalledWith(1, 41, 40);
    expect(capturado.inserts.find((i) => i.table === "contatos_unificacoes")?.values).toEqual(expect.objectContaining({ origem: "manual", executadoPor: 10 }));
  });

  it("desfazer exige a permissão do Mesclar", async () => {
    checkPermissionMock.mockResolvedValue({ ...PERM, allowed: false });
    await expect(caller().crm.desfazerUnificacao({ id: 3 })).rejects.toThrow("desfazer uma unificação");
    checkPermissionMock.mockResolvedValue({ ...PERM });
    filas["contatos_unificacoes"] = [[]];
    expect(await caller().crm.unificacaoRecente({ contatoId: 41 })).toBeNull();
  });
});

// ─── Amarras no código ───────────────────────────────────────────────────────

describe("amarras no código", () => {
  const handler = ler("server/integracoes/whatsapp-handler.ts");
  const crm = ler("server/escritorio/router-crm.ts");
  const dbCrm = ler("server/escritorio/db-crm.ts");
  const ficha = ler("client/src/pages/clientes/detail-tabs.tsx");
  const fin = ler("client/src/pages/financeiro/dialogs.tsx");
  const atd = ler("client/src/pages/Atendimento.tsx");
  const clientes = ler("client/src/pages/Clientes.tsx");

  it("o handler reconhece o cadastro DEPOIS de resolver a conversa e ANTES de salvar a mensagem, e passa a usar o contato devolvido", () => {
    const resolve = handler.indexOf("chatIdExterno: msg.chatId,\n    });\n  }");
    const reconhece = handler.indexOf("reconhecerCadastroNaEntrada(dbCadastro, {");
    const salva = handler.indexOf("const mensagemId = await salvarMensagem({");
    expect(resolve).toBeGreaterThan(-1);
    expect(reconhece).toBeGreaterThan(resolve);
    expect(salva).toBeGreaterThan(reconhece);
    expect(handler).toContain("if (rec.contatoId && rec.contatoId !== contatoId) contatoId = rec.contatoId;");
  });

  it("a resposta manual conta a janela de 24h por cliente e canal, como o “Nova conversa” já fazia", () => {
    expect(crm).toContain("ultimaEntradaDoContatoNoCanal(db, convData.contatoId, convData.canalId)");
    expect(crm).toContain("contatoId: conversas.contatoId,\n            telefone: contatos.telefone,");
  });

  it("uma régua só: WhatsApp, Clientes, Financeiro, sincronização e adoção do Asaas usam a mesma busca por telefone", () => {
    expect(dbCrm).toContain("async function condicoesMesmoTelefone(");
    expect(dbCrm).toContain("export async function buscarContatosPorTelefone(");
    for (const arq of [
      "server/escritorio/router-clientes.ts",
      "server/integracoes/router-asaas.ts",
      "server/integracoes/asaas-webhook.ts",
      "server/integracoes/asaas-adocao-orfas.ts",
    ]) {
      expect(ler(arq), arq).toContain("buscarContatosPorTelefone");
    }
    // Tudo que muda de dono numa unificação — e o Desfazer devolve pelos mesmos pares.
    for (const t of ["conversas", "leads", "cliente_arquivos", "cliente_anotacoes", "cliente_processos", "assinaturas_digitais", "tarefas", "asaas_clientes", "asaas_cobrancas", "smartflow_execucoes", "agendamentos"]) {
      expect(dbCrm).toContain(`{ tabela: "${t}", coluna:`);
    }
  });

  it("migration 0218 cria a memória das unificações e o schema a declara", () => {
    const mig = ler("drizzle/0218_contatos_unificacoes.sql");
    expect(mig).toContain("CREATE TABLE IF NOT EXISTS contatos_unificacoes");
    for (const col of ["duplicadoSnapshotUnif JSON NOT NULL", "principalAntesUnif JSON NOT NULL", "movidosUnif JSON NOT NULL", "desfeitaEmUnif TIMESTAMP NULL"]) {
      expect(mig).toContain(col);
    }
    expect(ler("drizzle/schema.ts")).toContain('mysqlTable("contatos_unificacoes"');
  });

  it("Clientes → Novo cliente: o card de reconhecimento, os dois caminhos e o Cadastrar travado enquanto espera a escolha", () => {
    expect(ficha).toContain("clientes.verificarTelefone.useQuery(");
    expect(ficha).toContain("Este WhatsApp já está em um cadastro");
    expect(ficha).toContain("submeter({ completarContatoId: telReconhecido.id })");
    expect(ficha).toContain("onClick={() => setTelSeparadoAck(telDigitos)}");
    expect(ficha).toContain("telSeparadoAck === telDigitos ? { forcarSeparado: true } : {}");
    expect(ficha).toContain("disabled={!nome || criar.isPending || telAguardandoEscolha}");
    expect(ficha).toContain("Nada é apagado.");
  });

  it("Financeiro → Novo cliente (Asaas): mesma conferência, “Usar esse cadastro” manda o id", () => {
    expect(fin).toContain("clientes.verificarTelefone.useQuery(");
    expect(fin).toContain("enviar({ usarContatoId: telReconhecido.id })");
    expect(fin).toContain("disabled={criarMut.isPending || !prontoParaEnviar || telAguardandoEscolha}");
  });

  it("Atendimento: selo do cadastro, aviso da unificação com Desfazer, e telefone padronizado (decisão 4)", () => {
    expect(atd).toContain("✓ cadastro reconhecido");
    expect(atd).toContain("contato do WhatsApp");
    expect(atd).toContain("Duas fichas com este número foram unificadas");
    expect(atd).toContain("desfazerUnificacaoMut.mutate({ id: unificacao.id })");
    expect(atd).toContain('{mascararTelefoneBR(conv.contatoTelefone || conv.chatIdExterno?.replace(/@.*/, "") || "")}');
    // A lista de conversas só carrega o que o selo precisa — booleano, nunca o CPF.
    expect(dbCrm).toContain("contatoCadastroCompleto: !!(contatoCpfCnpj?.trim() || contatoEmail?.trim() || contatoEstagio === \"cliente\")");
    expect(dbCrm).toContain("return rows.map(({ marcadaNaoLidaEm, contatoCpfCnpj, contatoEmail, contatoEstagio, ...r }) => ({");
  });

  it("Clientes: telefone padronizado na lista e na ficha, e a faxina de duplicados no cabeçalho", () => {
    expect(clientes).toContain("{mascararTelefoneBR(c.telefone)}");
    expect(clientes).toContain("{mascararTelefoneBR(cliente.telefone)}");
    expect(clientes).toContain("<PossiveisDuplicadosButton onMesclado={() => { refetch(); refetchStats(); }} />");
    const dup = ler("client/src/pages/clientes/possiveis-duplicados.tsx");
    expect(dup).toContain("clientes.possiveisDuplicadosTelefone.useQuery(");
    expect(dup).toContain("if (grupos.length === 0) return null;");
    expect(dup).toContain("Mesclar todos");
  });
});
