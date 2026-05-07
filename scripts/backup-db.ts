/**
 * Backup diário do MySQL → bucket S3-compatible (Backblaze B2 / R2 / S3).
 *
 * Como rodar:
 *   pnpm tsx scripts/backup-db.ts
 *
 * Roda no GitHub Actions pelo workflow `.github/workflows/backup-daily.yml`.
 * Pode rodar em qualquer máquina com `mysqldump` + `gzip` instalados.
 *
 * A lógica vive em `server/backup/admin-backup.ts` — esta CLI é só um
 * wrapper fino. A UI do admin reusa as mesmas funções pra disparar
 * backups sob demanda.
 *
 * Variáveis de ambiente exigidas:
 *   - DATABASE_URL              mysql://user:pass@host:port/db
 *   - BACKUP_BUCKET             nome do bucket
 *   - BACKUP_BUCKET_ENDPOINT    endpoint S3-compatible
 *   - BACKUP_BUCKET_REGION      região
 *   - BACKUP_ACCESS_KEY         keyID
 *   - BACKUP_SECRET_KEY         applicationKey
 *
 * Retenção: configure lifecycle no bucket (30 dias) — não fazemos limpeza.
 */
import mysql from "mysql2/promise";
import { executarBackupGlobal, obterConfigBackupDoEnv } from "../server/backup/admin-backup";

async function testarConexaoMysql(databaseUrl: string, timeoutMs = 30_000): Promise<void> {
  const u = new URL(databaseUrl);
  const conn = await mysql.createConnection({
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    connectTimeout: timeoutMs,
  });
  try {
    await conn.query("SELECT 1");
  } finally {
    await conn.end();
  }
}

async function main() {
  const inicio = Date.now();
  const cfg = obterConfigBackupDoEnv();
  if (!cfg) {
    throw new Error(
      "Backup não configurado: defina DATABASE_URL, BACKUP_BUCKET, BACKUP_BUCKET_ENDPOINT, BACKUP_BUCKET_REGION, BACKUP_ACCESS_KEY, BACKUP_SECRET_KEY",
    );
  }

  const u = new URL(cfg.databaseUrl);
  console.log(`[backup] target MySQL: ${u.hostname}:${u.port || 3306} db=${u.pathname.replace(/^\//, "")}`);
  console.log(`[backup] target S3: bucket=${cfg.bucket} endpoint=${cfg.endpoint} region=${cfg.region}`);

  console.log("[backup] testando conexão MySQL (timeout 30s)…");
  try {
    await testarConexaoMysql(cfg.databaseUrl);
    console.log("[backup] conexão MySQL OK");
  } catch (err) {
    console.error("[backup] FALHA NA CONEXÃO MySQL:", err);
    throw err;
  }

  console.log("[backup] iniciando dump…");
  // Heartbeat a cada 30s — confirma que o processo continua vivo durante
  // dump+upload longos. Sem isso, GitHub Actions vê tela em branco e
  // mata por timeout sem indicar onde travou.
  const heartbeat = setInterval(() => {
    const dur = Math.round((Date.now() - inicio) / 1000);
    console.log(`[backup] ainda rodando (${dur}s decorridos)…`);
  }, 30_000);

  try {
    const reg = await executarBackupGlobal(cfg);
    const dur = ((Date.now() - inicio) / 1000).toFixed(1);
    console.log(
      `[backup] OK em ${dur}s. Objeto: s3://${cfg.bucket}/${reg.key} (${(reg.tamanhoBytes / 1024 / 1024).toFixed(2)} MB)`,
    );
  } finally {
    clearInterval(heartbeat);
  }
}

main().catch((err) => {
  console.error("[backup] FALHOU:", err);
  process.exit(1);
});
