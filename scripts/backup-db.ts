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
import { executarBackupGlobal, obterConfigBackupDoEnv } from "../server/backup/admin-backup";

async function main() {
  const inicio = Date.now();
  const cfg = obterConfigBackupDoEnv();
  if (!cfg) {
    throw new Error(
      "Backup não configurado: defina DATABASE_URL, BACKUP_BUCKET, BACKUP_BUCKET_ENDPOINT, BACKUP_BUCKET_REGION, BACKUP_ACCESS_KEY, BACKUP_SECRET_KEY",
    );
  }
  console.log(`[backup] iniciando…`);
  const reg = await executarBackupGlobal(cfg);
  const dur = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(
    `[backup] OK em ${dur}s. Objeto: s3://${cfg.bucket}/${reg.key} (${(reg.tamanhoBytes / 1024 / 1024).toFixed(2)} MB)`,
  );
}

main().catch((err) => {
  console.error("[backup] FALHOU:", err);
  process.exit(1);
});
