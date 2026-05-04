/**
 * Garante que TODA tabela com `escritorioId` no schema esteja
 * classificada explicitamente em uma das três listas:
 *   - TABELAS_INCLUIR
 *   - EXCLUIR_SEGREDO
 *   - EXCLUIR_NAO_RELEVANTE
 *
 * Se uma feature nova adicionar tabela com escritorioId e esquecer de
 * declarar, este teste falha — força decisão consciente sobre o que
 * fazer com os dados no backup.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXCLUIR_NAO_RELEVANTE,
  EXCLUIR_SEGREDO,
  ORDEM_TOPOLOGICA,
  TABELAS_INCLUIR,
  TABELAS_SATELITE,
} from "../backup/escritorio-tabelas";

function lerSchema(): string {
  return fs.readFileSync(
    path.resolve(__dirname, "../../drizzle/schema.ts"),
    "utf-8",
  );
}

/**
 * Extrai tuplas (drizzleName, dbTableName) de toda mysqlTable do schema
 * que tem alguma coluna com `escritorioId` (mesmo que renomeada via
 * `escritorioIdXxx`).
 */
function tabelasComEscritorioId(): Array<{ drizzleName: string; dbTable: string }> {
  const src = lerSchema();
  const lines = src.split("\n");
  let currentDrizzle: string | null = null;
  let currentDbTable: string | null = null;
  const result = new Map<string, string>();

  const reExport = /^export const ([a-zA-Z]+) = mysqlTable\(\s*"([^"]+)"/;
  // Coluna real: escritorioId(...)?: int("...") — exige `:` e tipo `int(`,
  // descarta comments porque só matcha em linhas que parecem declaração.
  const reEscCol = /^\s+escritorioId(?:[A-Z]\w*)?:\s*int\(/;
  // Fim da tabela: linha começando com `});` (Drizzle convention).
  const reFimTabela = /^\}\)/;

  for (const line of lines) {
    const m = line.match(reExport);
    if (m) {
      currentDrizzle = m[1];
      currentDbTable = m[2];
      continue;
    }
    if (currentDrizzle && currentDbTable && reEscCol.test(line)) {
      result.set(currentDrizzle, currentDbTable);
    }
    if (currentDrizzle && reFimTabela.test(line)) {
      currentDrizzle = null;
      currentDbTable = null;
    }
  }

  return Array.from(result, ([drizzleName, dbTable]) => ({ drizzleName, dbTable }));
}

describe("backup escritório — allowlist", () => {
  const detectadas = tabelasComEscritorioId();

  it("encontra tabelas com escritorioId no schema (smoke)", () => {
    expect(detectadas.length).toBeGreaterThan(20);
  });

  it("toda tabela com escritorioId está classificada (incluir | excluir-segredo | excluir-nao-relevante)", () => {
    const incluidas = new Set(TABELAS_INCLUIR.map((t) => t.nomeBanco));
    const excluidasSegredo = new Set(EXCLUIR_SEGREDO.map((t) => t.nomeBanco));
    const excluidasNR = new Set(EXCLUIR_NAO_RELEVANTE.map((t) => t.nomeBanco));

    const naoClassificadas: string[] = [];
    for (const { dbTable } of detectadas) {
      if (
        !incluidas.has(dbTable) &&
        !excluidasSegredo.has(dbTable) &&
        !excluidasNR.has(dbTable)
      ) {
        naoClassificadas.push(dbTable);
      }
    }

    if (naoClassificadas.length > 0) {
      throw new Error(
        `Tabelas com escritorioId não classificadas no backup:\n  ` +
          naoClassificadas.join("\n  ") +
          `\n\nAdicione cada uma a TABELAS_INCLUIR, EXCLUIR_SEGREDO ou EXCLUIR_NAO_RELEVANTE em server/backup/escritorio-tabelas.ts.`,
      );
    }
  });

  it("não há duplicatas entre as três listas", () => {
    const incluidas = new Set(TABELAS_INCLUIR.map((t) => t.nomeBanco));
    const segredo = new Set(EXCLUIR_SEGREDO.map((t) => t.nomeBanco));
    const naoRelev = new Set(EXCLUIR_NAO_RELEVANTE.map((t) => t.nomeBanco));

    for (const t of incluidas) {
      expect(segredo.has(t), `${t} está em INCLUIR e EXCLUIR_SEGREDO`).toBe(false);
      expect(naoRelev.has(t), `${t} está em INCLUIR e EXCLUIR_NAO_RELEVANTE`).toBe(false);
    }
    for (const t of segredo) {
      expect(naoRelev.has(t), `${t} está em EXCLUIR_SEGREDO e EXCLUIR_NAO_RELEVANTE`).toBe(false);
    }
  });

  it("tabelas com colunas omitidas declaram explicitamente o motivo (segredo)", () => {
    const comOmissao = TABELAS_INCLUIR.filter((t) => t.colunasOmitir && t.colunasOmitir.length > 0);
    // Cada coluna omitida deve parecer ser segredo (nome com Encrypted/Key/Token/Iv/Tag)
    const padraoSegredo = /(encrypted|apikey|token|secret|iv|tag|password)/i;
    for (const tab of comOmissao) {
      for (const col of tab.colunasOmitir!) {
        expect(
          padraoSegredo.test(col),
          `coluna "${col}" omitida em ${tab.nomeBanco} não bate o padrão de segredo — confirme que faz sentido omitir`,
        ).toBe(true);
      }
    }
  });

  it("EXCLUIR_SEGREDO sempre tem motivo preenchido", () => {
    for (const t of EXCLUIR_SEGREDO) {
      expect(t.motivo.length, `${t.nomeBanco} sem motivo`).toBeGreaterThan(0);
    }
  });

  it("ORDEM_TOPOLOGICA cobre todas as tabelas (incluir + satélite) sem duplicatas", () => {
    const esperado = new Set([
      ...TABELAS_INCLUIR.map((t) => t.nomeBanco),
      ...TABELAS_SATELITE.map((t) => t.nomeBanco),
    ]);
    const presente = new Set(ORDEM_TOPOLOGICA);

    // Sem duplicatas
    expect(
      ORDEM_TOPOLOGICA.length,
      `ORDEM_TOPOLOGICA tem duplicatas: ${ORDEM_TOPOLOGICA.length} itens vs ${presente.size} únicos`,
    ).toBe(presente.size);

    // Cobre tudo
    const faltando = [...esperado].filter((n) => !presente.has(n));
    expect(faltando, `Faltando em ORDEM_TOPOLOGICA: ${faltando.join(", ")}`).toEqual([]);

    // Sem extras
    const extras = [...presente].filter((n) => !esperado.has(n));
    expect(extras, `Sobrando em ORDEM_TOPOLOGICA: ${extras.join(", ")}`).toEqual([]);
  });

  it("TABELAS_SATELITE filtroSql sempre referencia uma tabela INCLUIR", () => {
    const incluir = new Set(TABELAS_INCLUIR.map((t) => t.nomeBanco));
    for (const sat of TABELAS_SATELITE) {
      // filtroSql tem padrão "FK IN (SELECT id FROM <tabela_pai> WHERE...)"
      const m = sat.filtroSql.match(/FROM\s+(\w+)/i);
      expect(m, `${sat.nomeBanco} filtroSql sem FROM detectável`).toBeTruthy();
      const pai = m![1];
      expect(
        incluir.has(pai),
        `${sat.nomeBanco} aponta pra ${pai} que não está em TABELAS_INCLUIR — backup ficaria órfão`,
      ).toBe(true);
    }
  });
});
