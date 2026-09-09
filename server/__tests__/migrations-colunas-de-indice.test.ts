/**
 * Índice de migration não pode citar coluna que não existe.
 *
 * `0035_contatos_documentacao_pendente` e
 * `0084_modelos_contrato_eh_para_assinatura` indexavam `escritorioId`.
 * Só que o projeto sufixa o nome físico em boa parte das tabelas —
 * `contatos` usa `escritorioIdContato`, `modelos_contrato` usa
 * `escritorioIdModCt` — e outras 15 usam o nome puro. A propriedade em
 * TypeScript se chama `escritorioId` nas três, então quem escreve a
 * migration olhando o código acerta a propriedade e erra a coluna.
 *
 * O sintoma não é o índice faltando. É que a migration inteira fica sem
 * ser marcada como aplicada, e o `runMigrations` acusa falha FATAL a
 * cada boot, em todo ambiente, para sempre. Passaram anos assim: o
 * contador de erro virou linha de base, e ninguém repara quando ele
 * sobe.
 *
 * A régua é o nome FÍSICO em `drizzle/schema.ts`, que é o que o banco
 * enxerga.
 *
 * Onde este teste erra, ele erra pro lado seguro: o conjunto de colunas
 * conhecidas por tabela é montado por regex e sai maior que o real
 * (pega também nome de índice declarado no bloco). Conjunto maior deixa
 * passar defeito; nunca inventa um.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ_DRIZZLE = join(__dirname, "..", "..", "drizzle");
const SCHEMA = readFileSync(join(RAIZ_DRIZZLE, "schema.ts"), "utf8");

/** `tabela física` → nomes de coluna que o banco realmente tem. */
function colunasPorTabela(): Map<string, Set<string>> {
  const mapa = new Map<string, Set<string>>();
  const blocos = SCHEMA.split(/mysqlTable\(\s*"/).slice(1);

  for (const bruto of blocos) {
    const tabela = bruto.slice(0, bruto.indexOf('"'));
    // O bloco termina no próximo `export const` — basta pra não vazar
    // colunas de uma tabela para a seguinte.
    const corpo = bruto.slice(0, bruto.search(/\nexport const /) + 1 || undefined);

    const colunas = new Set<string>();
    for (const m of corpo.matchAll(/\w+\(\s*"([A-Za-z0-9_]+)"/g)) {
      colunas.add(m[1]!);
    }
    mapa.set(tabela, colunas);
  }
  return mapa;
}

interface RefIndice {
  arquivo: string;
  tabela: string;
  coluna: string;
}

/**
 * Casa `CREATE INDEX ... ON tabela (colunas)` e
 * `ALTER TABLE tabela ADD INDEX ... (colunas)`, inclusive quando o
 * statement está dentro de string preparada — que é o formato de 0035.
 */
function referenciasDeIndice(): RefIndice[] {
  const refs: RefIndice[] = [];
  const arquivos = readdirSync(RAIZ_DRIZZLE).filter((f) => f.endsWith(".sql"));

  const CREATE = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+[`"']?\w+[`"']?\s+ON\s+[`"']?(\w+)[`"']?\s*\(([^)]+)\)/gi;
  const ALTER = /ALTER\s+TABLE\s+[`"']?(\w+)[`"']?\s+ADD\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?\w+[`"']?\s*\(([^)]+)\)/gi;

  for (const arquivo of arquivos) {
    const sql = readFileSync(join(RAIZ_DRIZZLE, arquivo), "utf8");
    for (const padrao of [CREATE, ALTER]) {
      for (const m of sql.matchAll(padrao)) {
        const tabela = m[1]!;
        for (const bruta of m[2]!.split(",")) {
          // Tira crase, prefixo de tamanho (`col(20)`) e direção.
          const coluna = bruta
            .trim()
            .replace(/[`"']/g, "")
            .replace(/\s*\(\d+\)$/, "")
            .replace(/\s+(ASC|DESC)$/i, "")
            .trim();
          if (coluna) refs.push({ arquivo, tabela, coluna });
        }
      }
    }
  }
  return refs;
}

describe("índices de migration citam colunas que existem", () => {
  const tabelas = colunasPorTabela();
  const refs = referenciasDeIndice();

  it("o parser encontrou schema e migrations", () => {
    // Sem isto, um regex que parou de casar transformaria o teste em
    // aprovação automática.
    expect(tabelas.size, "nenhuma tabela lida de schema.ts").toBeGreaterThan(50);
    expect(refs.length, "nenhum índice lido das migrations").toBeGreaterThan(20);
  });

  it("nenhuma migration indexa coluna inexistente", () => {
    const quebradas = refs
      .filter((r) => {
        const colunas = tabelas.get(r.tabela);
        // Tabela fora do schema.ts (renomeada, removida) não é assunto
        // deste teste — ele guarda nome de COLUNA.
        return colunas && !colunas.has(r.coluna);
      })
      .map((r) => `${r.arquivo}: ${r.tabela}.${r.coluna}`);

    expect(
      [...new Set(quebradas)],
      "a migration inteira deixa de ser marcada como aplicada e o boot passa " +
        "a acusar falha FATAL em todo ambiente, para sempre",
    ).toEqual([]);
  });
});
