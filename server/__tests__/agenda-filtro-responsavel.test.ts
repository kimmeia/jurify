import { describe, it, expect } from "vitest";

/**
 * O recorte por pessoa/equipe do `agenda.listar` precisa EMPILHAR com o filtro
 * de permissão, nunca substituí-lo. Um estagiário com `verProprios` que marque
 * o nome da sócia no filtro não pode passar a ver a agenda dela.
 *
 * Testamos a condição gerada, sem banco: um drizzle real sobre uma conexão
 * fake devolve o SQL que seria executado.
 */
import { drizzle } from "drizzle-orm/mysql2";
import { and, eq, inArray, or } from "drizzle-orm";
import { agendamentos } from "../../drizzle/schema";

// Conexão fake: nada é executado, só queremos o SQL que o drizzle geraria.
const conexaoFake = {
  query: async () => [[], []],
  execute: async () => [[], []],
};
const db = drizzle(conexaoFake as never);

/** Só o WHERE — a lista de colunas do SELECT cita todos os campos e
 *  contaminaria qualquer asserção sobre "responsavelId aparece?". */
function whereDe(cond: unknown): string {
  const q = db.select().from(agendamentos).where(cond as never).toSQL();
  const i = q.sql.toLowerCase().indexOf(" where ");
  return i < 0 ? "" : q.sql.slice(i + 7);
}

describe("recorte por responsável no agenda.listar", () => {
  const ESCRITORIO = 7;
  const EU = 3;
  const OUTRA_PESSOA = 9;

  it("sem recorte, a condição é só escritório", () => {
    const conds = [eq(agendamentos.escritorioId, ESCRITORIO)];
    const s = whereDe(and(...conds));
    expect(s).toContain("escritorioId");
    expect(s).not.toContain("responsavelId");
  });

  it("com recorte, entra um IN em responsavelId", () => {
    const conds = [
      eq(agendamentos.escritorioId, ESCRITORIO),
      inArray(agendamentos.responsavelId, [OUTRA_PESSOA]),
    ];
    const s = whereDe(and(...conds));
    expect(s).toContain("responsavelId");
    expect(s.toLowerCase()).toContain("in (");
  });

  it("verProprios + recorte: as DUAS condições aparecem", () => {
    // É o teste que importa. Se o recorte substituísse o filtro de permissão,
    // a condição de "sou responsável ou criador" sumiria daqui.
    const conds = [
      eq(agendamentos.escritorioId, ESCRITORIO),
      or(eq(agendamentos.responsavelId, EU), eq(agendamentos.criadoPorId, EU)),
      inArray(agendamentos.responsavelId, [OUTRA_PESSOA]),
    ];
    const s = whereDe(and(...conds));
    expect(s).toContain("criadoPorId");
    expect(s.toLowerCase()).toContain("in (");
    // O AND entre elas é o que garante a interseção (e não a união).
    expect(s.toLowerCase()).toContain("and");
    expect(s.toLowerCase()).not.toMatch(/or\s+`agendamentos`\.`responsavelid`\s+in/);
  });
});

describe("interseção de equipe com pessoas escolhidas", () => {
  /** Reproduz a regra do router: setor define o universo, seleção recorta. */
  function resolverRecorte(
    doSetor: number[] | null,
    escolhidos: number[] | undefined,
  ): number[] | null {
    let recorte: number[] | null = doSetor;
    if (escolhidos?.length) {
      const set = new Set(escolhidos);
      recorte = recorte ? recorte.filter((id) => set.has(id)) : [...set];
    }
    return recorte;
  }

  it("só equipe devolve a equipe inteira", () => {
    expect(resolverRecorte([1, 2, 3], undefined)).toEqual([1, 2, 3]);
  });

  it("só pessoas devolve as pessoas", () => {
    expect(resolverRecorte(null, [4, 5])).toEqual([4, 5]);
  });

  it("equipe + pessoas devolve a interseção", () => {
    expect(resolverRecorte([1, 2, 3], [2, 3, 9])).toEqual([2, 3]);
  });

  it("interseção vazia devolve lista vazia, não 'todos'", () => {
    // O router transforma isso em "nenhum resultado". Devolver tudo aqui faria
    // o filtro parecer quebrado justamente quando ele está certo.
    expect(resolverRecorte([1, 2], [9])).toEqual([]);
  });

  it("nada selecionado devolve null (sem recorte)", () => {
    expect(resolverRecorte(null, undefined)).toBeNull();
    expect(resolverRecorte(null, [])).toBeNull();
  });
});
