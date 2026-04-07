/**
 * Auto-migrator — executa as migrations SQL da pasta `drizzle/` no startup.
 *
 * Por que não usar drizzle-kit em produção?
 *   - drizzle-kit é devDependency, não está disponível em production builds
 *   - rodar comandos externos no deploy é frágil e específico de plataforma
 *
 * Como funciona:
 *   1. Conecta no banco usando DATABASE_URL
 *   2. Cria tabela `__migrations` se não existir (controle de quais já rodaram)
 *   3. Lista todos os .sql da pasta drizzle/ ordenados por nome
 *   4. Para cada arquivo: se ainda não foi aplicado, executa
 *   5. Marca como aplicado na tabela `__migrations`
 *
 * Tolerante a erros de "duplicado" (ex: ALTER TABLE ADD COLUMN se a coluna
 * já existe) — esses são logados como warning mas não interrompem o boot.
 */

import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import { fileURLToPath } from "url";
import { createLogger } from "./logger";

const log = createLogger("auto-migrate");

// Resolve o diretório drizzle/ relativo ao projeto.
// Em dev: server/_core/auto-migrate.ts → ../../drizzle
// Em prod (esbuild bundle em dist/): dist/index.js → ../drizzle
function findDrizzleDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "drizzle"),
    path.resolve(process.cwd(), "../drizzle"),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isDirectory()) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function isHarmlessError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("duplicate column") ||
    m.includes("duplicate key name") ||
    m.includes("already exists") ||
    m.includes("duplicate entry") ||
    m.includes("can't drop") ||
    m.includes("check that column/key exists") ||
    m.includes("multiple primary key")
  );
}

/** Remove linhas que são apenas comentários `-- ...` no início e fim do statement. */
function stripCommentLines(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

/**
 * Divide o conteúdo do arquivo .sql em statements individuais.
 *
 * Suporta dois formatos:
 *  - Drizzle padrão: usa `--> statement-breakpoint` como separador
 *  - SQL puro: divide por `;` no final de linha
 *
 * Para cada statement, remove linhas de comentário inteiras (-- ...) antes
 * de avaliar se o statement é vazio. Isso evita que statements com
 * comentários explicativos no topo sejam erroneamente filtrados.
 */
function splitStatements(sql: string): string[] {
  let parts: string[];
  if (sql.includes("--> statement-breakpoint")) {
    parts = sql.split("--> statement-breakpoint");
  } else {
    parts = sql.split(/;\s*\n/);
  }

  return parts
    .map((s) => stripCommentLines(s))
    .filter((s) => s.length > 0);
}

export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    log.warn("DATABASE_URL ausente — pulando migrations");
    return;
  }

  const dir = findDrizzleDir();
  if (!dir) {
    log.warn("Pasta drizzle/ não encontrada — pulando migrations");
    return;
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // garante ordem alfabética/numérica

  if (files.length === 0) {
    log.info("Nenhuma migration encontrada em drizzle/");
    return;
  }

  log.info({ count: files.length, dir }, "Iniciando migrations");

  let connection: mysql.Connection;
  try {
    connection = await mysql.createConnection(url);
  } catch (err) {
    log.error({ err: String(err) }, "Falha ao conectar ao banco — abortando migrations");
    return;
  }

  try {
    // Garante a tabela de controle
    await connection.execute(
      `CREATE TABLE IF NOT EXISTS __migrations (
        filename VARCHAR(255) PRIMARY KEY,
        appliedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    );

    // Carrega quais já foram aplicadas
    const [rows] = await connection.execute("SELECT filename FROM __migrations");
    const applied = new Set((rows as { filename: string }[]).map((r) => r.filename));

    let aplicadas = 0;
    let puladas = 0;

    for (const file of files) {
      if (applied.has(file)) {
        puladas++;
        continue;
      }

      const fullPath = path.join(dir, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      const statements = splitStatements(sql);

      if (statements.length === 0) {
        log.warn({ file }, "Migration sem statements executáveis — pulando sem marcar como aplicada");
        continue;
      }

      log.info({ file, statements: statements.length }, "Aplicando migration");

      let warnings = 0;
      for (const stmt of statements) {
        try {
          await connection.query(stmt);
        } catch (err: any) {
          const msg = err.message || String(err);
          if (isHarmlessError(msg)) {
            warnings++;
            log.debug({ file, err: msg }, "Statement já aplicado");
          } else {
            log.error({ file, err: msg, stmt: stmt.slice(0, 200) }, "Erro na migration");
            throw err;
          }
        }
      }

      // Marca como aplicada
      await connection.execute("INSERT INTO __migrations (filename) VALUES (?)", [file]);
      aplicadas++;
      log.info({ file, warnings }, "Migration aplicada");
    }

    log.info({ aplicadas, puladas, total: files.length }, "Migrations concluídas");
  } catch (err) {
    log.error({ err: String(err) }, "Falha ao executar migrations — boot prossegue mesmo assim");
  } finally {
    await connection.end().catch(() => {
      /* ignore */
    });
  }
}
