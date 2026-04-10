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
 * Sprint 1 — Controle de cliente:
 *   - users.bloqueado / motivoBloqueio / bloqueadoEm
 *   - escritorios.suspenso / motivoSuspensao / suspensoEm
 *   - tabela cliente_notas_admin (notas internas do admin)
 */
async function ensureClienteControlSchema(connection: mysql.Connection): Promise<void> {
  try {
    // ─── users: colunas de bloqueio ───────────────────────────────────
    const [userCols] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`,
    );
    const userColSet = new Set(
      (userCols as { COLUMN_NAME: string }[]).map((c) => c.COLUMN_NAME),
    );

    if (!userColSet.has("bloqueado")) {
      await connection
        .query("ALTER TABLE users ADD COLUMN bloqueado BOOLEAN NOT NULL DEFAULT FALSE")
        .then(() => log.info("users.bloqueado adicionada"))
        .catch((err: any) => {
          if (!isHarmlessError(err.message || String(err)))
            log.warn({ err: err.message }, "Falha ao adicionar users.bloqueado");
        });
    }
    if (!userColSet.has("motivoBloqueio")) {
      await connection
        .query("ALTER TABLE users ADD COLUMN motivoBloqueio VARCHAR(500) NULL")
        .then(() => log.info("users.motivoBloqueio adicionada"))
        .catch((err: any) => {
          if (!isHarmlessError(err.message || String(err)))
            log.warn({ err: err.message }, "Falha ao adicionar users.motivoBloqueio");
        });
    }
    if (!userColSet.has("bloqueadoEm")) {
      await connection
        .query("ALTER TABLE users ADD COLUMN bloqueadoEm TIMESTAMP NULL")
        .then(() => log.info("users.bloqueadoEm adicionada"))
        .catch((err: any) => {
          if (!isHarmlessError(err.message || String(err)))
            log.warn({ err: err.message }, "Falha ao adicionar users.bloqueadoEm");
        });
    }

    // ─── escritorios: colunas de suspensão ────────────────────────────
    const [escTables] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'escritorios'`,
    );
    if ((escTables as unknown[]).length > 0) {
      const [escCols] = await connection.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'escritorios'`,
      );
      const escColSet = new Set(
        (escCols as { COLUMN_NAME: string }[]).map((c) => c.COLUMN_NAME),
      );

      if (!escColSet.has("suspenso")) {
        await connection
          .query("ALTER TABLE escritorios ADD COLUMN suspenso BOOLEAN NOT NULL DEFAULT FALSE")
          .then(() => log.info("escritorios.suspenso adicionada"))
          .catch((err: any) => {
            if (!isHarmlessError(err.message || String(err)))
              log.warn({ err: err.message }, "Falha ao adicionar escritorios.suspenso");
          });
      }
      if (!escColSet.has("motivoSuspensao")) {
        await connection
          .query("ALTER TABLE escritorios ADD COLUMN motivoSuspensao VARCHAR(500) NULL")
          .then(() => log.info("escritorios.motivoSuspensao adicionada"))
          .catch((err: any) => {
            if (!isHarmlessError(err.message || String(err)))
              log.warn({ err: err.message }, "Falha ao adicionar escritorios.motivoSuspensao");
          });
      }
      if (!escColSet.has("suspensoEm")) {
        await connection
          .query("ALTER TABLE escritorios ADD COLUMN suspensoEm TIMESTAMP NULL")
          .then(() => log.info("escritorios.suspensoEm adicionada"))
          .catch((err: any) => {
            if (!isHarmlessError(err.message || String(err)))
              log.warn({ err: err.message }, "Falha ao adicionar escritorios.suspensoEm");
          });
      }
    }

    // ─── cliente_notas_admin: tabela inteira ──────────────────────────
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS cliente_notas_admin (
          id INT NOT NULL AUTO_INCREMENT,
          userIdNota INT NOT NULL,
          autorAdminIdNota INT NOT NULL,
          conteudoNota TEXT NOT NULL,
          categoriaNota ENUM('geral','financeiro','suporte','comercial','alerta') NOT NULL DEFAULT 'geral',
          createdAtNota TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAtNota TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_notas_user (userIdNota),
          INDEX idx_notas_admin (autorAdminIdNota)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      log.info("cliente_notas_admin criada (ou já existia)");
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.warn({ err: err.message }, "Falha ao criar cliente_notas_admin");
      }
    }

    // ─── audit_log: tabela imutável de auditoria ──────────────────────
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id INT NOT NULL AUTO_INCREMENT,
          actorUserIdAudit INT NOT NULL,
          actorNameAudit VARCHAR(255),
          acaoAudit VARCHAR(100) NOT NULL,
          alvoTipoAudit VARCHAR(50),
          alvoIdAudit INT,
          alvoNomeAudit VARCHAR(255),
          detalhesAudit TEXT,
          ipAudit VARCHAR(64),
          createdAtAudit TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_audit_actor (actorUserIdAudit),
          INDEX idx_audit_acao (acaoAudit),
          INDEX idx_audit_created (createdAtAudit)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      log.info("audit_log criada (ou já existia)");
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.warn({ err: err.message }, "Falha ao criar audit_log");
      }
    }

    // ─── planos_overrides: editar planos sem deploy ────────────────────
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS planos_overrides (
          id INT NOT NULL AUTO_INCREMENT,
          planIdOverride VARCHAR(64) NOT NULL UNIQUE,
          nameOverride VARCHAR(100),
          descriptionOverride VARCHAR(500),
          priceMonthlyOverride INT,
          priceYearlyOverride INT,
          featuresOverride TEXT,
          popularOverride BOOLEAN,
          ocultoOverride BOOLEAN DEFAULT FALSE,
          updatedByOverride INT,
          updatedAtOverride TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      log.info("planos_overrides criada (ou já existia)");
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.warn({ err: err.message }, "Falha ao criar planos_overrides");
      }
    }

    // ─── cupons: descontos promocionais ────────────────────────────────
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS cupons (
          id INT NOT NULL AUTO_INCREMENT,
          codigoCupom VARCHAR(64) NOT NULL UNIQUE,
          descricaoCupom VARCHAR(255),
          tipoCupom ENUM('percentual','valorFixo') NOT NULL,
          valorCupom INT NOT NULL,
          validoDeCupom TIMESTAMP NULL,
          validoAteCupom TIMESTAMP NULL,
          maxUsosCupom INT,
          usosCupom INT NOT NULL DEFAULT 0,
          ativoCupom BOOLEAN NOT NULL DEFAULT TRUE,
          planosIdsCupom VARCHAR(500),
          criadoPorCupom INT,
          createdAtCupom TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAtCupom TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_cupons_ativo (ativoCupom)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      log.info("cupons criada (ou já existia)");
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.warn({ err: err.message }, "Falha ao criar cupons");
      }
    }

    // ─── agentes_admin: agentes de IA globais (admin-level) ───────────
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS agentes_admin (
          id INT NOT NULL AUTO_INCREMENT,
          nomeAgenteAdmin VARCHAR(128) NOT NULL,
          descricaoAgenteAdmin VARCHAR(512),
          areaConhecimentoAgente VARCHAR(128),
          modeloAgente VARCHAR(64) NOT NULL DEFAULT 'gpt-4o-mini',
          promptAgente TEXT NOT NULL,
          temperaturaAgente VARCHAR(10) NOT NULL DEFAULT '0.70',
          maxTokensAgente INT NOT NULL DEFAULT 800,
          ativoAgente BOOLEAN NOT NULL DEFAULT TRUE,
          modulosPermitidosAgente VARCHAR(500),
          criadoPorAgente INT,
          createdAtAgenteAdmin TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAtAgenteAdmin TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_agentes_admin_ativo (ativoAgente)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      log.info("agentes_admin criada (ou já existia)");
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.warn({ err: err.message }, "Falha ao criar agentes_admin");
      }
    }

    // ─── agente_documentos: training docs/links/texto por agente ──────
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS agente_documentos (
          id INT NOT NULL AUTO_INCREMENT,
          agenteIdDoc INT NOT NULL,
          nomeDoc VARCHAR(255) NOT NULL,
          tipoDoc ENUM('arquivo','link','texto') NOT NULL,
          urlDoc VARCHAR(1024),
          conteudoDoc TEXT,
          tamanhoDoc INT,
          mimeTypeDoc VARCHAR(128),
          createdAtDoc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_doc_agente (agenteIdDoc)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      log.info("agente_documentos criada (ou já existia)");
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.warn({ err: err.message }, "Falha ao criar agente_documentos");
      }
    }

    // ─── agentes_ia: adicionar colunas areaConhecimento + modulosPermitidos
    try {
      const [cols] = await connection.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agentes_ia'`,
      );
      const colSet = new Set(
        (cols as { COLUMN_NAME: string }[]).map((c) => c.COLUMN_NAME),
      );
      if (colSet.size > 0) {
        if (!colSet.has("areaConhecimentoAgenteIa")) {
          await connection
            .query("ALTER TABLE agentes_ia ADD COLUMN areaConhecimentoAgenteIa VARCHAR(128) NULL")
            .then(() => log.info("agentes_ia.areaConhecimentoAgenteIa adicionada"))
            .catch((err: any) => {
              if (!isHarmlessError(err.message || String(err)))
                log.warn({ err: err.message }, "Falha ao adicionar areaConhecimentoAgenteIa");
            });
        }
        if (!colSet.has("modulosPermitidosAgenteIa")) {
          await connection
            .query("ALTER TABLE agentes_ia ADD COLUMN modulosPermitidosAgenteIa VARCHAR(500) NULL")
            .then(() => log.info("agentes_ia.modulosPermitidosAgenteIa adicionada"))
            .catch((err: any) => {
              if (!isHarmlessError(err.message || String(err)))
                log.warn({ err: err.message }, "Falha ao adicionar modulosPermitidosAgenteIa");
            });
        }
      }
    } catch (err: any) {
      log.warn({ err: err.message }, "Falha ao atualizar agentes_ia columns");
    }

    // ─── agente_ia_documentos: training docs do escritório ─────────────
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS agente_ia_documentos (
          id INT NOT NULL AUTO_INCREMENT,
          agenteIdIaDoc INT NOT NULL,
          escritorioIdIaDoc INT NOT NULL,
          nomeIaDoc VARCHAR(255) NOT NULL,
          tipoIaDoc ENUM('arquivo','link','texto') NOT NULL,
          urlIaDoc VARCHAR(1024),
          conteudoIaDoc TEXT,
          tamanhoIaDoc INT,
          mimeTypeIaDoc VARCHAR(128),
          createdAtIaDoc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_iadoc_agente (agenteIdIaDoc),
          INDEX idx_iadoc_escritorio (escritorioIdIaDoc)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      log.info("agente_ia_documentos criada (ou já existia)");
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.warn({ err: err.message }, "Falha ao criar agente_ia_documentos");
      }
    }

    // ─── judit_monitoramentos: colunas novas (tipoMonitoramento, etc) ──
    try {
      const [tables] = await connection.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'judit_monitoramentos'`,
      );
      if ((tables as unknown[]).length > 0) {
        const [cols] = await connection.query(
          `SELECT COLUMN_NAME FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'judit_monitoramentos'`,
        );
        const colSet = new Set(
          (cols as { COLUMN_NAME: string }[]).map((c) => c.COLUMN_NAME),
        );
        if (!colSet.has("tipoMonitoramento")) {
          await connection
            .query(
              "ALTER TABLE judit_monitoramentos ADD COLUMN tipoMonitoramento ENUM('movimentacoes','novas_acoes') NULL",
            )
            .then(() => log.info("judit_monitoramentos.tipoMonitoramento adicionada"))
            .catch((err: any) => {
              if (!isHarmlessError(err.message || String(err)))
                log.warn({ err: err.message }, "Falha ao adicionar tipoMonitoramento");
            });
        }
        if (!colSet.has("credencialIdJuditMon")) {
          await connection
            .query("ALTER TABLE judit_monitoramentos ADD COLUMN credencialIdJuditMon INT NULL")
            .catch((err: any) => {
              if (!isHarmlessError(err.message || String(err)))
                log.warn({ err: err.message }, "Falha credencialIdJuditMon");
            });
        }
        if (!colSet.has("escritorioIdJuditMon")) {
          await connection
            .query("ALTER TABLE judit_monitoramentos ADD COLUMN escritorioIdJuditMon INT NULL")
            .catch((err: any) => {
              if (!isHarmlessError(err.message || String(err)))
                log.warn({ err: err.message }, "Falha escritorioIdJuditMon");
            });
        }
        if (!colSet.has("totalNovasAcoes")) {
          await connection
            .query("ALTER TABLE judit_monitoramentos ADD COLUMN totalNovasAcoes INT NOT NULL DEFAULT 0")
            .catch((err: any) => {
              if (!isHarmlessError(err.message || String(err)))
                log.warn({ err: err.message }, "Falha totalNovasAcoes");
            });
        }
        // Backfill: infere o tipo para rows antigas sem tipoMonitoramento
        try {
          await connection.query(
            `UPDATE judit_monitoramentos
             SET tipoMonitoramento = CASE
               WHEN searchType = 'lawsuit_cnj' THEN 'movimentacoes'
               ELSE 'novas_acoes'
             END
             WHERE tipoMonitoramento IS NULL`,
          );
        } catch {
          /* ignore backfill errors */
        }
      }
    } catch (err: any) {
      log.warn({ err: err.message }, "Falha ao atualizar judit_monitoramentos columns");
    }

    // ─── judit_credenciais: cofre de credenciais de tribunais ─────────
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS judit_credenciais (
          id INT NOT NULL AUTO_INCREMENT,
          escritorioIdJuditCred INT NOT NULL,
          customerKeyJuditCred VARCHAR(128) NOT NULL,
          systemNameJuditCred VARCHAR(64) NOT NULL,
          usernameJuditCred VARCHAR(64) NOT NULL,
          has2faJuditCred BOOLEAN NOT NULL DEFAULT FALSE,
          statusJuditCred ENUM('ativa','erro','expirada','removida') NOT NULL DEFAULT 'ativa',
          mensagemErroJuditCred TEXT,
          juditCredIdJuditCred VARCHAR(128),
          criadoPorJuditCred INT NOT NULL,
          createdAtJuditCred TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAtJuditCred TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_cred_escritorio (escritorioIdJuditCred),
          INDEX idx_cred_status (statusJuditCred)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      log.info("judit_credenciais criada (ou já existia)");
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.warn({ err: err.message }, "Falha ao criar judit_credenciais");
      }
    }

    // ─── judit_novas_acoes: ações novas detectadas ────────────────────
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS judit_novas_acoes (
          id INT NOT NULL AUTO_INCREMENT,
          monitoramentoIdNovaAcao INT NOT NULL,
          cnjNovaAcao VARCHAR(32) NOT NULL,
          tribunalNovaAcao VARCHAR(16),
          classeNovaAcao VARCHAR(255),
          areaDireitoNovaAcao VARCHAR(64),
          poloAtivoNovaAcao TEXT,
          poloPassivoNovaAcao TEXT,
          dataDistribuicaoNovaAcao VARCHAR(32),
          valorCausaNovaAcao BIGINT,
          payloadCompletoNovaAcao TEXT,
          lidoNovaAcao BOOLEAN NOT NULL DEFAULT FALSE,
          alertaEnviadoNovaAcao BOOLEAN NOT NULL DEFAULT FALSE,
          createdAtNovaAcao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_novaacao_mon (monitoramentoIdNovaAcao),
          INDEX idx_novaacao_lido (lidoNovaAcao),
          UNIQUE KEY uniq_novaacao_cnj_mon (cnjNovaAcao, monitoramentoIdNovaAcao)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      log.info("judit_novas_acoes criada (ou já existia)");
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.warn({ err: err.message }, "Falha ao criar judit_novas_acoes");
      }
    }
  } catch (err) {
    log.error({ err: String(err) }, "ensureClienteControlSchema: erro inesperado");
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
 * Adiciona a coluna `ultimaCobrancaMensal` em judit_monitoramentos.
 * Usada pelo cron mensal de cobrança recorrente de monitoramentos —
 * controla qual monitoramento já foi cobrado no ciclo atual e evita
 * cobrar duas vezes.
 */
async function ensureJuditMonitoramentoColumns(connection: mysql.Connection): Promise<void> {
  try {
    const [tables] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'judit_monitoramentos'`,
    );
    if ((tables as unknown[]).length === 0) {
      log.debug("Tabela 'judit_monitoramentos' ainda não existe — pulando");
      return;
    }

    const [cols] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'judit_monitoramentos'`,
    );
    const colSet = new Set(
      (cols as { COLUMN_NAME: string }[]).map((c) => c.COLUMN_NAME),
    );

    if (!colSet.has("ultimaCobrancaMensal")) {
      try {
        await connection.query(
          "ALTER TABLE judit_monitoramentos ADD COLUMN ultimaCobrancaMensal TIMESTAMP NULL",
        );
        log.info("ensureJuditMonitoramentoColumns: ultimaCobrancaMensal adicionada");
      } catch (err: any) {
        const msg = err.message || String(err);
        if (!isHarmlessError(msg)) {
          log.warn(
            { err: msg },
            "ensureJuditMonitoramentoColumns: falha ao adicionar ultimaCobrancaMensal",
          );
        }
      }
    }

    if (!colSet.has("tipoMonitoramento")) {
      try {
        await connection.query(
          "ALTER TABLE judit_monitoramentos ADD COLUMN tipoMonitoramento ENUM('movimentacoes','novas_acoes') NULL",
        );
        log.info("ensureJuditMonitoramentoColumns: tipoMonitoramento adicionada");
      } catch (err: any) {
        const msg = err.message || String(err);
        if (!isHarmlessError(msg)) {
          log.warn(
            { err: msg },
            "ensureJuditMonitoramentoColumns: falha ao adicionar tipoMonitoramento",
          );
        }
      }
    }
    // Adicionar "validando" ao enum statusJuditCred (se tabela judit_credenciais existe)
    const [credTables] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'judit_credenciais'`,
    );
    if ((credTables as unknown[]).length > 0) {
      try {
        await connection.query(
          `ALTER TABLE judit_credenciais MODIFY COLUMN statusJuditCred ENUM('ativa','validando','erro','expirada','removida') NOT NULL DEFAULT 'validando'`,
        );
        log.info("ensureJuditMonitoramentoColumns: enum statusJuditCred atualizado com 'validando'");
      } catch (err: any) {
        const msg = err.message || String(err);
        if (!isHarmlessError(msg)) {
          log.warn({ err: msg }, "ensureJuditMonitoramentoColumns: falha ao atualizar enum statusJuditCred");
        }
      }
    }
  } catch (err) {
    log.error({ err: String(err) }, "ensureJuditMonitoramentoColumns: erro inesperado");
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
    await ensureClienteControlSchema(connection);
    await ensureJuditMonitoramentoColumns(connection);

    // Atualizar enum tipoCanal para incluir calcom e chatgpt
    try {
      await connection.query(
        `ALTER TABLE canais_integrados MODIFY COLUMN tipoCanal ENUM('whatsapp_qr','whatsapp_api','instagram','facebook','telefone_voip','calcom','chatgpt','claude') NOT NULL`,
      );
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.warn({ err: err.message }, "Falha ao atualizar enum tipoCanal");
      }
    }

    // Criar tabela cliente_processos (processos vinculados a clientes)
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS cliente_processos (
          id INT NOT NULL AUTO_INCREMENT,
          escritorioIdCliProc INT NOT NULL,
          contatoIdCliProc INT NOT NULL,
          numeroCnjCliProc VARCHAR(30) NOT NULL,
          apelidoCliProc VARCHAR(255),
          monitoramentoIdCliProc INT,
          tribunalCliProc VARCHAR(16),
          classeCliProc VARCHAR(255),
          valorCausaCliProc INT,
          poloCliProc ENUM('ativo','passivo','interessado'),
          criadoPorCliProc INT,
          createdAtCliProc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAtCliProc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_cliproc_escritorio (escritorioIdCliProc),
          INDEX idx_cliproc_contato (contatoIdCliProc),
          INDEX idx_cliproc_cnj (numeroCnjCliProc)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.warn({ err: err.message }, "Falha ao criar cliente_processos");
      }
    }

    // SmartFlow tables
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS smartflow_cenarios (
          id INT NOT NULL AUTO_INCREMENT,
          escritorioIdSF INT NOT NULL,
          nomeSF VARCHAR(128) NOT NULL,
          descricaoSF VARCHAR(512),
          gatilhoSF ENUM('whatsapp_mensagem','novo_lead','agendamento_criado','manual') NOT NULL,
          ativoSF BOOLEAN NOT NULL DEFAULT TRUE,
          configSF TEXT,
          criadoPorSF INT,
          createdAtSF TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAtSF TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_sf_escritorio (escritorioIdSF)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await connection.query(`
        CREATE TABLE IF NOT EXISTS smartflow_passos (
          id INT NOT NULL AUTO_INCREMENT,
          cenarioIdPasso INT NOT NULL,
          ordemPasso INT NOT NULL DEFAULT 0,
          tipoPasso ENUM('ia_classificar','ia_responder','calcom_horarios','calcom_agendar','whatsapp_enviar','transferir','condicional','esperar','webhook') NOT NULL,
          configPasso TEXT,
          createdAtPasso TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_sfp_cenario (cenarioIdPasso)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await connection.query(`
        CREATE TABLE IF NOT EXISTS smartflow_execucoes (
          id INT NOT NULL AUTO_INCREMENT,
          cenarioIdExec INT NOT NULL,
          escritorioIdExec INT NOT NULL,
          contatoIdExec INT,
          conversaIdExec INT,
          statusExec ENUM('rodando','concluido','erro','cancelado') NOT NULL DEFAULT 'rodando',
          passoAtualExec INT NOT NULL DEFAULT 0,
          contextoExec TEXT,
          erroExec VARCHAR(512),
          createdAtExec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAtExec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_sfe_cenario (cenarioIdExec),
          INDEX idx_sfe_escritorio (escritorioIdExec)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) {
        log.warn({ err: err.message }, "Falha ao criar tabelas SmartFlow");
      }
    }

    // SmartFlow enum updates
    try {
      await connection.query(`ALTER TABLE smartflow_cenarios MODIFY COLUMN gatilhoSF ENUM('whatsapp_mensagem','novo_lead','agendamento_criado','pagamento_recebido','manual') NOT NULL`);
      await connection.query(`ALTER TABLE smartflow_passos MODIFY COLUMN tipoPasso ENUM('ia_classificar','ia_responder','calcom_horarios','calcom_agendar','whatsapp_enviar','transferir','condicional','esperar','webhook','kanban_criar_card') NOT NULL`);
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) log.warn({ err: err.message }, "Falha ao atualizar enums SmartFlow");
    }

    // Kanban tables
    try {
      await connection.query(`CREATE TABLE IF NOT EXISTS kanban_funis (id INT NOT NULL AUTO_INCREMENT, escritorioIdKF INT NOT NULL, nomeKF VARCHAR(128) NOT NULL, descricaoKF VARCHAR(512), corKF VARCHAR(16), criadoPorKF INT, createdAtKF TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAtKF TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), INDEX idx_kf_esc (escritorioIdKF)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await connection.query(`CREATE TABLE IF NOT EXISTS kanban_colunas (id INT NOT NULL AUTO_INCREMENT, funilIdKC INT NOT NULL, nomeKC VARCHAR(64) NOT NULL, corKC VARCHAR(16), ordemKC INT NOT NULL DEFAULT 0, createdAtKC TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), INDEX idx_kc_funil (funilIdKC)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await connection.query(`CREATE TABLE IF NOT EXISTS kanban_cards (id INT NOT NULL AUTO_INCREMENT, escritorioIdKCard INT NOT NULL, colunaIdKCard INT NOT NULL, tituloKCard VARCHAR(255) NOT NULL, descricaoKCard TEXT, cnjKCard VARCHAR(30), clienteIdKCard INT, responsavelIdKCard INT, prioridadeKCard ENUM('alta','media','baixa') NOT NULL DEFAULT 'media', prazoKCard TIMESTAMP NULL, tagsKCard VARCHAR(255), asaasPaymentIdKCard VARCHAR(64), ordemKCard INT NOT NULL DEFAULT 0, createdAtKCard TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAtKCard TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), INDEX idx_kcard_col (colunaIdKCard), INDEX idx_kcard_esc (escritorioIdKCard)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      // Add columns if tables already existed
      try { await connection.query(`ALTER TABLE kanban_cards ADD COLUMN asaasPaymentIdKCard VARCHAR(64) NULL`); } catch { /* exists */ }
      try { await connection.query(`ALTER TABLE kanban_cards ADD COLUMN atrasadoKCard BOOLEAN NOT NULL DEFAULT FALSE`); } catch { /* exists */ }
      try { await connection.query(`ALTER TABLE kanban_funis ADD COLUMN prazoPadraoDiasKF INT NOT NULL DEFAULT 15`); } catch { /* exists */ }
      await connection.query(`CREATE TABLE IF NOT EXISTS kanban_tags (id INT NOT NULL AUTO_INCREMENT, escritorioIdKTag INT NOT NULL, nomeKTag VARCHAR(32) NOT NULL, corKTag VARCHAR(16) NOT NULL, createdAtKTag TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), INDEX idx_ktag_esc (escritorioIdKTag)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await connection.query(`CREATE TABLE IF NOT EXISTS kanban_movimentacoes (id INT NOT NULL AUTO_INCREMENT, cardIdKMov INT NOT NULL, colunaOrigemIdKMov INT NOT NULL, colunaDestinoIdKMov INT NOT NULL, movidoPorIdKMov INT, createdAtKMov TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), INDEX idx_kmov_card (cardIdKMov)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    } catch (err: any) {
      if (!isHarmlessError(err.message || String(err))) log.warn({ err: err.message }, "Falha ao criar tabelas Kanban");
    }

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
