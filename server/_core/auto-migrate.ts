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

/**
 * Garantia hardcoded de schema para auth (passwordHash, googleSub).
 *
 * Roda ANTES das migrations baseadas em arquivo. Garante que as colunas
 * essenciais para login existem mesmo se:
 *  - A pasta drizzle/ não for acessível em runtime
 *  - Alguma migration anterior falhar e bloquear as seguintes
 *  - O esquema do banco estiver dessincronizado por qualquer motivo
 *
 * Usa information_schema pra checar antes de tentar adicionar — assim
 * é idempotente e seguro de rodar a cada boot.
 */
async function ensureAuthColumns(connection: mysql.Connection): Promise<void> {
  try {
    // Verifica se a tabela users existe
    const [tables] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`,
    );
    if ((tables as unknown[]).length === 0) {
      log.warn("Tabela 'users' ainda não existe — pulando ensureAuthColumns");
      return;
    }

    // Lista colunas existentes
    const [cols] = await connection.query(
      `SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`,
    );
    const colMap = new Map(
      (cols as { COLUMN_NAME: string; CHARACTER_MAXIMUM_LENGTH: number | null }[]).map(
        (c) => [c.COLUMN_NAME, c.CHARACTER_MAXIMUM_LENGTH],
      ),
    );

    const ops: { name: string; sql: string }[] = [];

    // openId precisa ser >= 128 chars (acomoda openIds sintéticos)
    const openIdLen = colMap.get("openId");
    if (openIdLen != null && openIdLen < 128) {
      ops.push({
        name: "openId → VARCHAR(128)",
        sql: "ALTER TABLE users MODIFY COLUMN openId VARCHAR(128) NOT NULL",
      });
    }

    // passwordHash
    if (!colMap.has("passwordHash")) {
      ops.push({
        name: "ADD passwordHash",
        sql: "ALTER TABLE users ADD COLUMN passwordHash VARCHAR(255) NULL AFTER email",
      });
    }

    // googleSub
    if (!colMap.has("googleSub")) {
      ops.push({
        name: "ADD googleSub",
        sql: "ALTER TABLE users ADD COLUMN googleSub VARCHAR(128) NULL AFTER passwordHash",
      });
    }

    if (ops.length === 0) {
      log.debug("ensureAuthColumns: schema já está atualizado");
      return;
    }

    log.info({ ops: ops.map((o) => o.name) }, "ensureAuthColumns: aplicando alterações");

    for (const op of ops) {
      try {
        await connection.query(op.sql);
        log.info({ op: op.name }, "ensureAuthColumns: aplicado");
      } catch (err: any) {
        const msg = err.message || String(err);
        if (isHarmlessError(msg)) {
          log.debug({ op: op.name, err: msg }, "ensureAuthColumns: já aplicado");
        } else {
          log.error({ op: op.name, err: msg }, "ensureAuthColumns: falha");
        }
      }
    }

    // Índices úteis (idempotente)
    const indexOps = [
      { name: "idx_users_googleSub", sql: "CREATE INDEX idx_users_googleSub ON users (googleSub)" },
      { name: "idx_users_email", sql: "CREATE INDEX idx_users_email ON users (email)" },
    ];
    for (const op of indexOps) {
      try {
        await connection.query(op.sql);
        log.info({ op: op.name }, "ensureAuthColumns: índice criado");
      } catch (err: any) {
        const msg = err.message || String(err);
        if (isHarmlessError(msg)) {
          /* já existe */
        } else {
          log.warn({ op: op.name, err: msg }, "ensureAuthColumns: índice falhou");
        }
      }
    }
  } catch (err) {
    log.error({ err: String(err) }, "ensureAuthColumns: erro inesperado");
  }
}

export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    log.warn("DATABASE_URL ausente — pulando migrations");
    return;
  }

  log.info("Iniciando processo de migrations");

  let connection: mysql.Connection;
  try {
    connection = await mysql.createConnection(url);
  } catch (err) {
    log.error({ err: String(err) }, "Falha ao conectar ao banco — abortando migrations");
    return;
  }

  try {
    // ─── 1. Garantia hardcoded de schema essencial ──────────────────────────
    // Roda SEMPRE, independente das migrations baseadas em arquivo.
    await ensureAuthColumns(connection);

    // ─── 2. Migrations baseadas em arquivo (drizzle/*.sql) ──────────────────
    const dir = findDrizzleDir();
    if (!dir) {
      log.warn("Pasta drizzle/ não encontrada — pulando migrations baseadas em arquivo");
      return;
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      log.info("Nenhum arquivo .sql em drizzle/");
      return;
    }

    log.info({ count: files.length, dir }, "Lendo migrations da pasta drizzle/");

    // Garante a tabela de controle
    await connection.execute(
      `CREATE TABLE IF NOT EXISTS __migrations (
        filename VARCHAR(255) PRIMARY KEY,
        appliedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    );

    const [rows] = await connection.execute("SELECT filename FROM __migrations");
    const applied = new Set((rows as { filename: string }[]).map((r) => r.filename));

    let aplicadas = 0;
    let puladas = 0;
    let comErro = 0;

    for (const file of files) {
      if (applied.has(file)) {
        puladas++;
        continue;
      }

      const fullPath = path.join(dir, file);
      let sql: string;
      try {
        sql = fs.readFileSync(fullPath, "utf8");
      } catch (err) {
        log.warn({ file, err: String(err) }, "Não consegui ler arquivo, pulando");
        comErro++;
        continue;
      }

      const statements = splitStatements(sql);

      if (statements.length === 0) {
        log.warn({ file }, "Sem statements executáveis, pulando sem marcar");
        continue;
      }

      log.info({ file, statements: statements.length }, "Aplicando migration");

      let warnings = 0;
      let fileFailed = false;
      for (const stmt of statements) {
        try {
          await connection.query(stmt);
        } catch (err: any) {
          const msg = err.message || String(err);
          if (isHarmlessError(msg)) {
            warnings++;
          } else {
            log.warn({ file, err: msg, stmt: stmt.slice(0, 150) }, "Statement falhou");
            fileFailed = true;
            // NÃO faz throw — continua tentando os próximos statements e o próximo arquivo
          }
        }
      }

      if (fileFailed) {
        comErro++;
        log.warn({ file, warnings }, "Migration teve falhas — não marcando como aplicada");
      } else {
        await connection.execute("INSERT INTO __migrations (filename) VALUES (?)", [file]);
        aplicadas++;
        log.info({ file, warnings }, "Migration aplicada com sucesso");
      }
    }

    log.info(
      { aplicadas, puladas, comErro, total: files.length },
      "Migrations concluídas",
    );
  } catch (err) {
    log.error({ err: String(err) }, "Falha geral em runMigrations");
  } finally {
    await connection.end().catch(() => {
      /* ignore */
    });
  }
}
