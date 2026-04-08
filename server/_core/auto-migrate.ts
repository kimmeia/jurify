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

/**
 * Migração: substitui Stripe por Asaas na tabela `subscriptions` e em `users`.
 *
 * - users.stripeCustomerId  → users.asaasCustomerId
 * - subscriptions.stripeSubscriptionId → subscriptions.asaasSubscriptionId
 * - subscriptions.stripePriceId        → REMOVIDO (não tem equivalente Asaas)
 * - subscriptions.asaasCustomerId      → NOVO
 *
 * Estratégia: ADICIONA colunas novas (sem dropar as antigas), tornando
 * stripeSubscriptionId/stripePriceId nullable. Bancos com dados antigos
 * continuam funcionando — assinaturas Stripe legadas podem coexistir
 * com assinaturas Asaas novas até serem migradas manualmente.
 */
async function ensureAsaasBillingColumns(connection: mysql.Connection): Promise<void> {
  try {
    // ─── users.asaasCustomerId ────────────────────────────────────────
    const [userTables] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`,
    );
    if ((userTables as unknown[]).length > 0) {
      const [userCols] = await connection.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`,
      );
      const userColSet = new Set(
        (userCols as { COLUMN_NAME: string }[]).map((c) => c.COLUMN_NAME),
      );
      if (!userColSet.has("asaasCustomerId")) {
        try {
          await connection.query(
            "ALTER TABLE users ADD COLUMN asaasCustomerId VARCHAR(255) NULL",
          );
          log.info("ensureAsaasBillingColumns: users.asaasCustomerId adicionada");
        } catch (err: any) {
          if (!isHarmlessError(err.message || String(err))) {
            log.warn({ err: err.message }, "Falha ao adicionar users.asaasCustomerId");
          }
        }
      }
    }

    // ─── subscriptions: asaasSubscriptionId, asaasCustomerId ──────────
    const [subTables] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions'`,
    );
    if ((subTables as unknown[]).length === 0) {
      log.debug("Tabela 'subscriptions' não existe — pulando ensureAsaasBillingColumns");
      return;
    }

    const [subCols] = await connection.query(
      `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions'`,
    );
    const subColMap = new Map(
      (subCols as { COLUMN_NAME: string; IS_NULLABLE: string }[]).map(
        (c) => [c.COLUMN_NAME, c.IS_NULLABLE],
      ),
    );

    const ops: { name: string; sql: string }[] = [];

    if (!subColMap.has("asaasSubscriptionId")) {
      ops.push({
        name: "ADD asaasSubscriptionId",
        sql: "ALTER TABLE subscriptions ADD COLUMN asaasSubscriptionId VARCHAR(255) NULL",
      });
    }
    if (!subColMap.has("asaasCustomerId")) {
      ops.push({
        name: "ADD asaasCustomerId",
        sql: "ALTER TABLE subscriptions ADD COLUMN asaasCustomerId VARCHAR(255) NULL",
      });
    }
    // Tornar stripeSubscriptionId nullable (se ainda existir e for NOT NULL)
    if (subColMap.get("stripeSubscriptionId") === "NO") {
      ops.push({
        name: "stripeSubscriptionId → NULL",
        sql: "ALTER TABLE subscriptions MODIFY COLUMN stripeSubscriptionId VARCHAR(255) NULL",
      });
    }
    if (subColMap.get("stripePriceId") === "NO") {
      ops.push({
        name: "stripePriceId → NULL",
        sql: "ALTER TABLE subscriptions MODIFY COLUMN stripePriceId VARCHAR(255) NULL",
      });
    }

    if (ops.length === 0) {
      log.debug("ensureAsaasBillingColumns: schema já está atualizado");
    } else {
      log.info({ ops: ops.map((o) => o.name) }, "ensureAsaasBillingColumns: aplicando");
      for (const op of ops) {
        try {
          await connection.query(op.sql);
          log.info({ op: op.name }, "ensureAsaasBillingColumns: aplicado");
        } catch (err: any) {
          if (!isHarmlessError(err.message || String(err))) {
            log.warn({ op: op.name, err: err.message }, "ensureAsaasBillingColumns: falha");
          }
        }
      }
    }

    // Índice único em asaasSubscriptionId (idempotente)
    try {
      await connection.query(
        "CREATE UNIQUE INDEX uniq_subscriptions_asaasSubscriptionId ON subscriptions (asaasSubscriptionId)",
      );
      log.info("ensureAsaasBillingColumns: índice único criado");
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.debug({ err: err.message }, "Índice asaasSubscriptionId já existe ou falhou");
      }
    }

    // ─── Cancelamento de subs órfãs (Stripe legado sem Asaas) ─────────
    // Linhas que tinham stripeSubscriptionId mas não foram migradas
    // ficam órfãs: ainda aparecem como "active" mas não têm
    // asaasSubscriptionId, então cancel/changePlan quebram. Marcamos
    // como "canceled" — o usuário precisa criar nova assinatura no
    // Asaas via /plans.
    if (subColMap.has("stripeSubscriptionId")) {
      try {
        const [orphans] = await connection.query(
          `SELECT COUNT(*) AS total FROM subscriptions
           WHERE stripeSubscriptionId IS NOT NULL
             AND (asaasSubscriptionId IS NULL OR asaasSubscriptionId = '')
             AND status IN ('active', 'trialing', 'past_due')`,
        );
        const total = Number((orphans as { total: number }[])[0]?.total || 0);
        if (total > 0) {
          log.warn(
            { total },
            "Encontradas assinaturas Stripe legadas sem migração — marcando como canceladas",
          );
          await connection.query(
            `UPDATE subscriptions
             SET status = 'canceled'
             WHERE stripeSubscriptionId IS NOT NULL
               AND (asaasSubscriptionId IS NULL OR asaasSubscriptionId = '')
               AND status IN ('active', 'trialing', 'past_due')`,
          );
          log.info(
            { total },
            "ensureAsaasBillingColumns: subs Stripe órfãs canceladas — usuários precisam reasinar via Asaas",
          );
        }
      } catch (err: any) {
        log.warn(
          { err: err.message },
          "ensureAsaasBillingColumns: falha ao cancelar subs Stripe órfãs",
        );
      }
    }
  } catch (err) {
    log.error({ err: String(err) }, "ensureAsaasBillingColumns: erro inesperado");
  }
}

/**
 * Garante que a tabela `contatos` tem a coluna `telefonesAnteriores`.
 * Usado pelo handler do WhatsApp pra reconhecer contatos que tiveram o
 * telefone alterado — evita criar contatos duplicados quando chega
 * mensagem do número antigo.
 */
async function ensureContatoColumns(connection: mysql.Connection): Promise<void> {
  try {
    const [tables] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contatos'`,
    );
    if ((tables as unknown[]).length === 0) {
      log.debug("Tabela 'contatos' ainda não existe — pulando ensureContatoColumns");
      return;
    }

    const [cols] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contatos'`,
    );
    const colSet = new Set(
      (cols as { COLUMN_NAME: string }[]).map((c) => c.COLUMN_NAME),
    );

    if (!colSet.has("telefonesAnteriores")) {
      try {
        await connection.query(
          "ALTER TABLE contatos ADD COLUMN telefonesAnteriores TEXT NULL AFTER telefoneContato",
        );
        log.info("ensureContatoColumns: telefonesAnteriores adicionada");
      } catch (err: any) {
        const msg = err.message || String(err);
        if (!isHarmlessError(msg)) {
          log.warn({ err: msg }, "ensureContatoColumns: falha ao adicionar telefonesAnteriores");
        }
      }
    }
  } catch (err) {
    log.error({ err: String(err) }, "ensureContatoColumns: erro inesperado");
  }
}

/**
 * Remove o ON DELETE CASCADE da FK conversas.contatoIdConv — estava
 * perigoso: se alguém deletasse um contato, TODAS as conversas históricas
 * seriam apagadas junto. Agora: ON DELETE NO ACTION (RESTRICT) — banco
 * bloqueia o delete se houver conversas, forçando o usuário a lidar
 * com o histórico explicitamente.
 */
async function relaxConversasForeignKey(connection: mysql.Connection): Promise<void> {
  try {
    // Checa se a FK existe e se está com CASCADE
    const [rows] = await connection.query(
      `SELECT rc.CONSTRAINT_NAME, rc.DELETE_RULE
       FROM information_schema.REFERENTIAL_CONSTRAINTS rc
       WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
         AND rc.TABLE_NAME = 'conversas'
         AND rc.REFERENCED_TABLE_NAME = 'contatos'`,
    );
    const fks = rows as { CONSTRAINT_NAME: string; DELETE_RULE: string }[];
    if (fks.length === 0) {
      log.debug("relaxConversasForeignKey: FK não existe ainda, pulando");
      return;
    }

    for (const fk of fks) {
      if (fk.DELETE_RULE === "CASCADE") {
        log.info({ fk: fk.CONSTRAINT_NAME }, "relaxConversasForeignKey: removendo CASCADE");
        try {
          await connection.query(`ALTER TABLE conversas DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
          await connection.query(
            `ALTER TABLE conversas ADD CONSTRAINT \`${fk.CONSTRAINT_NAME}\`
             FOREIGN KEY (contatoIdConv) REFERENCES contatos(id)
             ON DELETE NO ACTION ON UPDATE NO ACTION`,
          );
          log.info({ fk: fk.CONSTRAINT_NAME }, "relaxConversasForeignKey: aplicado");
        } catch (err: any) {
          log.warn({ err: err.message, fk: fk.CONSTRAINT_NAME }, "relaxConversasForeignKey: falha");
        }
      }
    }
  } catch (err) {
    log.error({ err: String(err) }, "relaxConversasForeignKey: erro inesperado");
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
    await ensureContatoColumns(connection);
    await ensureAsaasBillingColumns(connection);
    await relaxConversasForeignKey(connection);

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
