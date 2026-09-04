/**
 * Lead criado à mão sem DDI casa com o WhatsApp — uma ficha só.
 *
 * `crm.criarContato` grava o telefone como foi digitado ("(85) 99796-5706",
 * "85997965706"); a mensagem que chega do WhatsApp traz "5585997965706".
 * `buscarContatoPorTelefone` comparava só a forma canônica com 55, então o
 * handler não achava o lead e criava um segundo cadastro — histórico, lead e
 * responsável divididos em dois contatos, e a Nova Conversa dizendo "número
 * livre" com o lead na frente.
 *
 * A correção é na LEITURA (compara a coluna sem máscara com as formas com e
 * sem DDI), não na gravação: vale pro que já está no banco, sem migration, e
 * não muda o que as telas mostram.
 *
 * O banco aqui é de mentira, mas o WHERE é o de verdade: a condição que a
 * função monta é renderizada pelo dialeto MySQL e avaliada linha a linha.
 * Sem isso o teste passaria com qualquer mock que devolvesse a linha.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

type Linha = {
  id: number;
  escritorioId: number;
  nome: string;
  telefone: string | null;
  telefonesAnteriores?: string | null;
  telefonesSecundarios?: string | null;
};

const banco = { contatos: [] as Linha[], inserts: [] as Record<string, unknown>[] };
const ultimo = { where: null as SQL | null };
const dialeto = new MySqlDialect();

const semMascara = (v: string | null | undefined) => (v ?? "").replace(/[()\- +]/g, "");

function contemLike(campo: string | null | undefined, padrao: unknown): boolean {
  const miolo = String(padrao).replace(/^%|%$/g, "").replace(/\\([%_\\])/g, "$1");
  return (campo ?? "").includes(miolo);
}

/**
 * Avalia o WHERE renderizado contra uma linha. Só conhece o que
 * `buscarContatoPorTelefone` monta — escritório AND (telefone = ? OR
 * anteriores LIKE ? OR secundários LIKE ? OR REPLACE(telefone…) = ?) — e
 * explode em condição desconhecida, pra não passar por acidente.
 */
function bate(where: SQL, linha: Linha): boolean {
  const { sql, params } = dialeto.sqlToQuery(where);
  expect(sql).toMatch(/^\(`contatos`\.`escritorioIdContato` = \? and \(/);
  const partes = sql.split("?");
  let escritorioOk = false;
  let telefoneOk = false;
  partes.slice(0, -1).forEach((antes, i) => {
    const p = params[i];
    if (/`escritorioIdContato` = $/.test(antes)) { escritorioOk = linha.escritorioId === p; return; }
    if (/'\+', ''\) = $/.test(antes)) { if (semMascara(linha.telefone) === p) telefoneOk = true; return; }
    if (/`telefoneContato` = $/.test(antes)) { if (linha.telefone === p) telefoneOk = true; return; }
    if (/`telefonesAnteriores` like $/.test(antes)) { if (contemLike(linha.telefonesAnteriores, p)) telefoneOk = true; return; }
    if (/`telefonesSecundarios` like $/.test(antes)) { if (contemLike(linha.telefonesSecundarios, p)) telefoneOk = true; return; }
    throw new Error(`condição não reconhecida no WHERE: …${antes.slice(-80)}`);
  });
  return escritorioOk && telefoneOk;
}

function makeDb() {
  function builder(): any {
    let where: SQL | null = null;
    const linhas = () =>
      banco.contatos
        .filter((l) => (where ? bate(where, l) : true))
        .map(({ id, nome, telefone }) => ({ id, nome, telefone }));
    const b: any = {
      from: () => b,
      where: (w: SQL) => { where = w; ultimo.where = w; return b; },
      orderBy: () => b,
      limit: () => Promise.resolve(linhas()),
      then: (resolve: (v: unknown) => unknown) => resolve(linhas()),
    };
    return b;
  }
  return {
    select: () => builder(),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        const id = banco.contatos.length + 1;
        banco.inserts.push(v);
        banco.contatos.push({ id, ...(v as Omit<Linha, "id">) });
        return Promise.resolve([{ insertId: id }]);
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }) }),
  };
}

const dbInstance = makeDb();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbInstance),
}));

const { criarOuReutilizarContato, buscarContatoPorTelefone } = await import("../escritorio/db-crm");

const INBOUND = "5585997965706";

beforeEach(() => {
  banco.contatos = [];
  banco.inserts = [];
  ultimo.where = null;
});

describe("lead criado à mão casa com a mensagem que chega do WhatsApp", () => {
  it("'(85) 99796-5706' no Novo Lead + inbound 5585997965706 = UMA ficha", async () => {
    // 1. O lead entra como `crm.criarContato` manda: telefone digitado, cru.
    const lead = await criarOuReutilizarContato({
      escritorioId: 1, nome: "Lead do Pipeline", telefone: "(85) 99796-5706", origem: "manual",
    });
    expect(lead.jaCadastrado).toBe(false);
    expect(banco.inserts).toHaveLength(1);
    // A gravação não mudou: o que está no banco continua como foi digitado.
    expect(banco.inserts[0].telefone).toBe("(85) 99796-5706");

    // 2. A mensagem chega — é o mesmo caminho do whatsapp-handler.
    const doWhats = await criarOuReutilizarContato({
      escritorioId: 1, nome: "Contato WhatsApp", telefone: INBOUND, origem: "whatsapp",
    });
    expect(doWhats).toEqual({ id: lead.id, jaCadastrado: true });
    expect(banco.inserts).toHaveLength(1);
  });

  it.each([
    ["com máscara", "(85) 99796-5706"],
    ["só dígitos, sem DDI", "85997965706"],
    ["sem o nono dígito", "8597965706"],
    ["sem o nono dígito, com máscara", "(85) 9796-5706"],
    ["com +55 e espaços", "+55 85 99796-5706"],
    ["já canônico (o que sempre funcionou)", "5585997965706"],
  ])("cadastro gravado %s é encontrado pelo inbound canônico", async (_rotulo, gravado) => {
    banco.contatos.push({ id: 7, escritorioId: 1, nome: "Fulano", telefone: gravado });
    const achado = await buscarContatoPorTelefone(1, INBOUND);
    expect(achado?.id).toBe(7);
  });

  it("o caminho inverso também: contato do WhatsApp achado pelo número digitado sem DDI", async () => {
    banco.contatos.push({ id: 8, escritorioId: 1, nome: "Do Whats", telefone: "5585997965706" });
    expect((await buscarContatoPorTelefone(1, "85997965706"))?.id).toBe(8);
    expect((await buscarContatoPorTelefone(1, "8597965706"))?.id).toBe(8);
  });

  it("o WHERE compara a coluna sem máscara com as formas sem DDI, por igualdade", async () => {
    await buscarContatoPorTelefone(1, INBOUND);
    const { sql, params } = dialeto.sqlToQuery(ultimo.where!);
    expect(sql).toContain("REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`contatos`.`telefoneContato`, '(', ''), ')', ''), '-', ''), ' ', ''), '+', '') = ?");
    expect(params).toEqual(expect.arrayContaining(["5585997965706", "558597965706", "85997965706", "8597965706"]));
  });
});

describe("a tolerância não vira falso positivo", () => {
  it("número parecido (último dígito diferente) NÃO casa", async () => {
    banco.contatos.push({ id: 9, escritorioId: 1, nome: "Outro", telefone: "(85) 99796-5707" });
    expect(await buscarContatoPorTelefone(1, INBOUND)).toBeNull();
  });

  it("continua preso ao escritório", async () => {
    banco.contatos.push({ id: 10, escritorioId: 2, nome: "De outro escritório", telefone: "(85) 99796-5706" });
    expect(await buscarContatoPorTelefone(1, INBOUND)).toBeNull();
    expect((await buscarContatoPorTelefone(2, INBOUND))?.id).toBe(10);
  });

  it("DDD 55 (RS) gravado sem DDI casa com o seu próprio inbound, e não com o do 85", async () => {
    banco.contatos.push({ id: 11, escritorioId: 1, nome: "Santa Maria", telefone: "(55) 9979-6570" });
    expect((await buscarContatoPorTelefone(1, "555599796570"))?.id).toBe(11);
    expect(await buscarContatoPorTelefone(1, INBOUND)).toBeNull();
  });

  it("telefone vazio não consulta nada", async () => {
    banco.contatos.push({ id: 12, escritorioId: 1, nome: "Sem número", telefone: "" });
    expect(await buscarContatoPorTelefone(1, "")).toBeNull();
    expect(ultimo.where).toBeNull();
  });
});
