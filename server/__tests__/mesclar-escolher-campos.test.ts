/**
 * Escolher campo a campo o que fica ao mesclar dois cadastros
 * (mockups `mockup-mesclar-escolher-campos` + `mockup-mesclar-decisoes`,
 * aprovado pelo dono em 10/09/2026 com as duas decisões):
 *
 *   1 = A · a escolha aparece nos DOIS lugares que mesclam um par por vez
 *           (o Mesclar da ficha e o Mesclar da linha na Conferência). O lote
 *           "Mesclar todos" continua sem perguntar nada.
 *   2 = B · o responsável ENTRA na lista de campos escolhíveis, com o aviso de
 *           que ele decide acesso, padrão de comissão e rodízio.
 *
 * O padrão de cada linha é o que a mesclagem faria sozinha, então quem não
 * mexer em nada termina com o resultado de sempre. Por isso a tela manda pro
 * servidor só o que DIFERE do padrão.
 *
 * O ponto sensível é o Desfazer: ele restaura a ficha que sobreviveu a partir
 * de `principalAntes`. Se a escolha passa a sobrescrever nome, tags e
 * responsável, esses campos TÊM que entrar na fotografia — senão desfazer
 * devolve a ficha absorvida e deixa a outra com o nome trocado.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const NOME = Symbol.for("drizzle:Name");
function nomeTabela(t: any): string { return (t?.[NOME] as string) || ""; }

const filas: Record<string, any[][]> = {};
const updates: Array<{ table: string; set: any }> = [];
const inserts: Array<{ table: string; values: any }> = [];
function proximaFila(table: string): any[] {
  const fila = filas[table];
  return fila && fila.length > 0 ? fila.shift()! : [];
}
function makeDb() {
  function builder(): any {
    let table = "";
    const b: any = {
      from: (t: any) => { table = nomeTabela(t); return b; },
      innerJoin: () => b, leftJoin: () => b, where: () => b, orderBy: () => b, limit: () => b, offset: () => b,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(proximaFila(table)).then(res, rej),
    };
    return b;
  }
  return {
    select: () => builder(),
    selectDistinct: () => builder(),
    insert: (t: any) => ({
      values: (v: any) => { inserts.push({ table: nomeTabela(t), values: v }); return Promise.resolve([{ insertId: 7 }]); },
    }),
    update: (t: any) => ({
      set: (s: any) => {
        updates.push({ table: nomeTabela(t), set: s });
        const p: any = Promise.resolve([{ affectedRows: 1 }]);
        p.where = () => Promise.resolve([{ affectedRows: 1 }]);
        return p;
      },
    }),
    delete: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }),
    execute: () => Promise.resolve([[]]),
  };
}
const dbFalso = makeDb();

vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  return { ...real, getDb: vi.fn(async () => dbFalso) };
});
const unificarContatosMock = vi.fn(async () => {
  // Marca a posição na fila de escritas: a ordem entre a mesclagem de sempre e
  // as escolhas é o que garante que uma não desfaz a outra.
  updates.push({ table: "__unificarContatos", set: {} });
  return { tabelasAtualizadas: ["conversas"] };
});
vi.mock("../escritorio/db-crm", async (importOriginal) => {
  const real = await importOriginal<typeof import("../escritorio/db-crm")>();
  return { ...real, unificarContatos: (...a: unknown[]) => unificarContatosMock(...(a as [])) };
});

const {
  linhasDaMesclagem, escolhasPadrao, escolhasQueMudam, quantasEscolhas,
  CAMPOS_ESCOLHIVEIS, ROTULO_CAMPO, AVISO_RESPONSAVEL,
} = await import("../../shared/mesclar-campos");
const { unificarComRegistro, desfazerUnificacao } = await import("../escritorio/reconhecer-cadastro");

type Ficha = import("../../shared/mesclar-campos").FichaMesclagem;
const F = (over: Partial<Ficha> & { id: number; nome: string }): Ficha => ({
  telefone: null, telefonesSecundarios: null, email: null, cpfCnpj: null,
  observacoes: null, tags: null, responsavelId: null, responsavelNome: null, ...over,
});

beforeEach(() => {
  for (const k of Object.keys(filas)) delete filas[k];
  updates.length = 0;
  inserts.length = 0;
  unificarContatosMock.mockClear();
});

// ─── As regras, puras ────────────────────────────────────────────────────────

describe("quais linhas a tela mostra", () => {
  it("campo igual dos dois lados não vira linha — não há o que decidir nem conferir", () => {
    const p = F({ id: 1, nome: "Renata Coelho", email: "r@x.com" });
    const d = F({ id: 2, nome: "Renata Coelho", email: "r@x.com" });
    expect(linhasDaMesclagem(p, d)).toEqual([]);
  });

  it("campo vazio dos dois lados também não vira linha", () => {
    const p = F({ id: 1, nome: "Renata" });
    const d = F({ id: 2, nome: "Renata" });
    expect(linhasDaMesclagem(p, d).map((l) => l.campo)).toEqual([]);
  });

  it("os dois preenchidos e diferentes viram ESCOLHA, com o padrão na ficha que fica", () => {
    const p = F({ id: 1, nome: "Renata Coelho Siqueira", email: "velho@hotmail.com" });
    const d = F({ id: 2, nome: "Renata C. Siqueira", email: "novo@gmail.com" });
    const linhas = linhasDaMesclagem(p, d);
    const email = linhas.find((l) => l.campo === "email")!;
    expect(email.tipo).toBe("escolha");
    expect(email.padrao).toBe("principal");
    expect(quantasEscolhas(linhas)).toBe(2);
  });

  it("o CPF ignora a máscara: mesmo número escrito diferente não é escolha", () => {
    const p = F({ id: 1, nome: "R", cpfCnpj: "907.442.318-20" });
    const d = F({ id: 2, nome: "R", cpfCnpj: "90744231820" });
    expect(linhasDaMesclagem(p, d).some((l) => l.campo === "cpfCnpj")).toBe(false);
  });

  it("só um lado tem: e-mail, CPF e observações preenchem buraco vazio, como sempre fizeram", () => {
    const p = F({ id: 1, nome: "R" });
    const d = F({ id: 2, nome: "R", email: "novo@gmail.com", cpfCnpj: "90744231820", observacoes: "obs" });
    const linhas = linhasDaMesclagem(p, d);
    for (const campo of ["email", "cpfCnpj", "observacoes"]) {
      const l = linhas.find((x) => x.campo === campo)!;
      expect(l.tipo, campo).toBe("um_lado");
      expect(l.padrao, campo).toBe("duplicado");
    }
  });

  it("só um lado tem: NOME e RESPONSÁVEL nunca foram copiados, então o padrão fica na ficha que sobrevive", () => {
    const p = F({ id: 1, nome: "Renata" });
    const d = F({ id: 2, nome: "Renata", responsavelId: 9, responsavelNome: "Milena Araújo" });
    const resp = linhasDaMesclagem(p, d).find((l) => l.campo === "responsavelId")!;
    expect(resp.tipo).toBe("um_lado");
    expect(resp.padrao).toBe("principal");
    expect(resp.duplicado).toBe("Milena Araújo");
  });

  it("telefone e tags SOMAM: não são escolha", () => {
    const p = F({ id: 1, nome: "R", telefone: "8598765432", tags: "trabalhista" });
    const d = F({ id: 2, nome: "R", telefone: "8532721180", tags: "indicação" });
    const linhas = linhasDaMesclagem(p, d);
    expect(linhas.find((l) => l.campo === "telefone")!.tipo).toBe("somam");
    expect(linhas.find((l) => l.campo === "tags")!.tipo).toBe("somam");
    expect(escolhasPadrao(linhas)).toEqual({});
  });

  it("decisão 2 = B: o responsável está entre os campos escolhíveis", () => {
    expect(CAMPOS_ESCOLHIVEIS).toContain("responsavelId");
    expect(ROTULO_CAMPO.responsavelId).toBe("Responsável");
    expect(AVISO_RESPONSAVEL).toMatch(/comiss/i);
    expect(AVISO_RESPONSAVEL).toMatch(/rod[ií]zio/i);
  });

  it("o servidor recebe só o que MUDOU — repetir o padrão faria reescrever campo intocado", () => {
    const p = F({ id: 1, nome: "Renata Coelho", email: "velho@hotmail.com" });
    const d = F({ id: 2, nome: "Renata C.", email: "novo@gmail.com" });
    const linhas = linhasDaMesclagem(p, d);
    expect(escolhasQueMudam(linhas, escolhasPadrao(linhas))).toEqual({});
    expect(escolhasQueMudam(linhas, { ...escolhasPadrao(linhas), email: "duplicado" })).toEqual({ email: "duplicado" });
  });
});

// ─── Aplicar e desfazer ──────────────────────────────────────────────────────

const PRINCIPAL = {
  id: 41, escritorioId: 1, nome: "Renata Coelho Siqueira", telefone: "8532721180",
  telefonesSecundarios: null, email: "velho@hotmail.com", cpfCnpj: "90744231820",
  observacoes: "obs antiga", tags: "indicação", responsavelId: 5,
};
const DUPLICADO = {
  id: 40, escritorioId: 1, nome: "Renata C. Siqueira", telefone: "8598765432",
  telefonesSecundarios: null, email: "novo@gmail.com", cpfCnpj: null,
  observacoes: null, tags: "trabalhista", responsavelId: 9,
};

async function mesclar(escolhas?: Record<string, "principal" | "duplicado">) {
  filas["contatos"] = [[PRINCIPAL], [DUPLICADO]];
  return unificarComRegistro(dbFalso as any, {
    escritorioId: 1, principalId: 41, duplicadoId: 40,
    origem: "manual", executadoPor: 10, escolhas: escolhas as any,
  });
}

describe("as escolhas chegam no banco", () => {
  it("sem escolha nenhuma, só as tags somam — o resto é a mesclagem de sempre", async () => {
    await mesclar();
    const set = updates.find((u) => u.table === "contatos")?.set ?? {};
    expect(set.tags).toBe("indicação, trabalhista");
    expect(set.nome).toBeUndefined();
    expect(set.email).toBeUndefined();
    expect(set.responsavelId).toBeUndefined();
  });

  it("escolher o lado da ficha absorvida grava o valor dela", async () => {
    await mesclar({ email: "duplicado", nome: "duplicado" });
    const set = updates.find((u) => u.table === "contatos")?.set ?? {};
    expect(set.email).toBe("novo@gmail.com");
    expect(set.nome).toBe("Renata C. Siqueira");
  });

  it("decisão 2 = B: dá pra trazer o responsável da ficha absorvida", async () => {
    await mesclar({ responsavelId: "duplicado" });
    expect(updates.find((u) => u.table === "contatos")?.set?.responsavelId).toBe(9);
  });

  it("escolher um lado SEM valor não apaga o que o outro lado já tinha — só a tela filtra isso, a procedure precisa filtrar de novo", async () => {
    // Chamada direta (fora da tela, que só deixa clicar em lado preenchido):
    // duplicado não tem cpfCnpj nem observações, e o principal (que fica) tem
    // os dois. `?? null` sem essa guarda apagaria o que já estava certo.
    filas["contatos"] = [[PRINCIPAL], [{ ...DUPLICADO, cpfCnpj: null, observacoes: null }]];
    await unificarComRegistro(dbFalso as any, {
      escritorioId: 1, principalId: 41, duplicadoId: 40,
      origem: "manual", executadoPor: 10,
      escolhas: { cpfCnpj: "duplicado", observacoes: "duplicado" } as any,
    });
    const set = updates.find((u) => u.table === "contatos")?.set ?? {};
    expect(set.cpfCnpj).toBeUndefined();
    expect(set.observacoes).toBeUndefined();
  });

  it("escolher um responsável em branco não desliga o responsável de quem fica", async () => {
    filas["contatos"] = [[{ ...PRINCIPAL, responsavelId: null }], [DUPLICADO]];
    await unificarComRegistro(dbFalso as any, {
      escritorioId: 1, principalId: 41, duplicadoId: 40,
      origem: "manual", executadoPor: 10,
      escolhas: { responsavelId: "principal" } as any,
    });
    expect(updates.find((u) => u.table === "contatos")?.set?.responsavelId).toBeUndefined();
  });

  it("nome vazio na origem escolhida NÃO apaga o nome de quem fica (a coluna é obrigatória)", async () => {
    filas["contatos"] = [[PRINCIPAL], [{ ...DUPLICADO, nome: "   " }]];
    await unificarComRegistro(dbFalso as any, {
      escritorioId: 1, principalId: 41, duplicadoId: 40,
      origem: "manual", executadoPor: 10, escolhas: { nome: "duplicado" } as any,
    });
    expect(updates.find((u) => u.table === "contatos")?.set?.nome).toBeUndefined();
  });

  it("a mesclagem de sempre roda ANTES das escolhas — senão ela sobrescreveria a decisão", async () => {
    await mesclar({ email: "duplicado" });
    expect(unificarContatosMock).toHaveBeenCalledWith(1, 41, 40);
    const iMescla = updates.findIndex((u) => u.table === "__unificarContatos");
    const iEscolhas = updates.findIndex((u) => u.table === "contatos");
    expect(iMescla).toBeGreaterThanOrEqual(0);
    expect(iEscolhas).toBeGreaterThan(iMescla);
  });
});

describe("o Desfazer acompanha o que a escolha sobrescreveu", () => {
  it("a fotografia guarda TODOS os campos que a escolha pode trocar", async () => {
    await mesclar({ nome: "duplicado" });
    const reg = inserts.find((i) => i.table === "contatos_unificacoes")!.values;
    for (const campo of ["nome", "email", "cpfCnpj", "observacoes", "telefonesSecundarios", "tags", "responsavelId"]) {
      expect(reg.principalAntes, campo).toHaveProperty(campo);
    }
    expect(reg.principalAntes.nome).toBe("Renata Coelho Siqueira");
    expect(reg.principalAntes.responsavelId).toBe(5);
  });

  it("desfazer devolve nome, tags e responsável junto com os quatro de sempre", async () => {
    filas["contatos_unificacoes"] = [[{
      id: 3, escritorioId: 1, principalId: 41, duplicadoId: 40, desfeitaEm: null,
      createdAt: new Date(), duplicadoSnapshot: { id: 40, nome: "Renata C. Siqueira" }, movidos: {},
      principalAntes: {
        nome: "Renata Coelho Siqueira", email: "velho@hotmail.com", cpfCnpj: "90744231820",
        observacoes: "obs antiga", telefonesSecundarios: null, tags: "indicação", responsavelId: 5,
      },
    }]];
    await desfazerUnificacao(dbFalso as any, { escritorioId: 1, id: 3, executadoPor: 10 });
    const volta = updates.find((u) => u.table === "contatos" && "nome" in u.set)?.set;
    expect(volta.nome).toBe("Renata Coelho Siqueira");
    expect(volta.tags).toBe("indicação");
    expect(volta.responsavelId).toBe(5);
  });

  it("registro ANTIGO (só os quatro campos) não tem nome apagado no desfazer", async () => {
    filas["contatos_unificacoes"] = [[{
      id: 3, escritorioId: 1, principalId: 41, duplicadoId: 40, desfeitaEm: null,
      createdAt: new Date(), duplicadoSnapshot: { id: 40, nome: "X" }, movidos: {},
      principalAntes: { email: null, cpfCnpj: null, observacoes: null, telefonesSecundarios: null },
    }]];
    await desfazerUnificacao(dbFalso as any, { escritorioId: 1, id: 3, executadoPor: 10 });
    const volta = updates.find((u) => u.table === "contatos")?.set ?? {};
    expect(volta).not.toHaveProperty("nome");
    expect(volta).not.toHaveProperty("tags");
    expect(volta).not.toHaveProperty("responsavelId");
  });
});

// ─── Amarras no código ───────────────────────────────────────────────────────

describe("decisão 1 = A: as duas telas que mesclam um par por vez", () => {
  it("o Mesclar da ficha ganhou o passo do meio", () => {
    const tela = ler("client/src/pages/Clientes.tsx");
    expect(tela).toContain("useEscolhasMesclagem");
    expect(tela).toContain('setPasso(passo === "escolher-ficha" && campos.precisaEscolher ? "campos" : "confirmar")');
    expect(tela).toContain("onConfirmar(selecionado.id, conflito || undefined, campos.mudancas)");
  });

  it("o Mesclar da linha da Conferência também", () => {
    const conf = ler("client/src/pages/clientes/ConferenciaCadastros.tsx");
    expect(conf).toContain("MesclarComEscolhaDialog");
    expect(conf).toContain("onMesclar={(grupo) => setEscolhendo(grupo)}");
    expect(conf).toContain("paresDoGrupo(g, false, escolhasPorFicha)");
  });

  it('"Mesclar todos" em lote continua sem perguntar nada', () => {
    const conf = ler("client/src/pages/clientes/ConferenciaCadastros.tsx");
    const lote = conf.slice(conf.indexOf("const pares = grupos.flatMap"), conf.indexOf("const pares = grupos.flatMap") + 400);
    expect(lote).toContain("paresDoGrupo(g)");
    expect(lote).not.toContain("escolhas");
  });

  it("as duas telas usam o MESMO componente e a MESMA conta do servidor", () => {
    const comp = ler("client/src/pages/clientes/mesclar-escolher-campos.tsx");
    expect(comp).toContain('from "@shared/mesclar-campos"');
    // A CHAMADA, não o import: trocar o corpo por [] deixava o import intacto.
    expect(comp).toContain("linhasDaMesclagem(data.principal, data.duplicado)");
    expect(comp).toContain("escolhasQueMudam(linhas, escolhas)");
  });

  it("o passo só aparece quando há divergência de verdade", () => {
    const comp = ler("client/src/pages/clientes/mesclar-escolher-campos.tsx");
    expect(comp).toContain("precisaEscolher: quantasEscolhas(linhas) > 0");
  });

  it("a leitura dos dois lados é escopada pelo escritório e pede a permissão do Mesclar", () => {
    const router = ler("server/escritorio/router-clientes.ts");
    const proc = router.slice(router.indexOf("camposParaMesclar: protectedProcedure"), router.indexOf("possiveisDuplicadosTelefone: protectedProcedure"));
    expect(proc).toContain('checkPermission(ctx.user.id, "clientes", "excluir")');
    expect(proc).toContain("eq(contatos.escritorioId, perm.escritorioId)");
    expect(proc).toContain("eq(colaboradores.escritorioId, perm.escritorioId)");
  });
});
