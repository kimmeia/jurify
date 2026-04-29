/**
 * Backup diário do MySQL → bucket S3-compatible (Backblaze B2 / R2 / S3).
 *
 * Como rodar:
 *   pnpm tsx scripts/backup-db.ts
 *
 * Roda no GitHub Actions pelo workflow `.github/workflows/backup-daily.yml`.
 * Pode rodar em qualquer máquina com `mysqldump` + `gzip` instalados.
 *
 * Estratégia: spawna mysqldump, pipa stdout pro gzip, pipa o gzip pro upload
 * S3 streaming via `@aws-sdk/lib-storage`. Sem buffer intermediário em
 * memória — funciona pra DBs de qualquer tamanho dentro do timeout do
 * Actions (6h).
 *
 * Variáveis de ambiente exigidas:
 *   - DATABASE_URL              mysql://user:pass@host:port/db (igual à app)
 *   - BACKUP_BUCKET             nome do bucket (ex: "jurify-backups")
 *   - BACKUP_BUCKET_ENDPOINT    endpoint S3-compatible (ex: B2:
 *                               "https://s3.us-west-002.backblazeb2.com")
 *   - BACKUP_BUCKET_REGION      ex: "us-west-002"
 *   - BACKUP_ACCESS_KEY         keyID do bucket
 *   - BACKUP_SECRET_KEY         applicationKey
 *
 * Retenção: configure lifecycle no bucket pra expirar objetos com mais de
 * 30 dias automaticamente. Não fazemos limpeza no script.
 */

import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

interface ConexaoMysql {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function parseDatabaseUrl(url: string): ConexaoMysql {
  const u = new URL(url);
  if (!u.protocol.startsWith("mysql")) {
    throw new Error(`DATABASE_URL não é MySQL: ${u.protocol}`);
  }
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
  };
}

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ${nome} não definida`);
  return v;
}

async function main() {
  const inicio = Date.now();
  const conn = parseDatabaseUrl(exigir("DATABASE_URL"));
  const bucket = exigir("BACKUP_BUCKET");
  const endpoint = exigir("BACKUP_BUCKET_ENDPOINT");
  const region = exigir("BACKUP_BUCKET_REGION");
  const accessKeyId = exigir("BACKUP_ACCESS_KEY");
  const secretAccessKey = exigir("BACKUP_SECRET_KEY");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `mysql/${conn.database}/${stamp}.sql.gz`;

  console.log(`[backup] DB=${conn.database} host=${conn.host} → s3://${bucket}/${key}`);

  const s3 = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  // mysqldump em streaming
  const dump = spawn(
    "mysqldump",
    [
      `--host=${conn.host}`,
      `--port=${conn.port}`,
      `--user=${conn.user}`,
      `--password=${conn.password}`,
      "--single-transaction",
      "--quick",
      "--routines",
      "--triggers",
      "--events",
      "--set-gtid-purged=OFF",
      "--column-statistics=0",
      conn.database,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let stderr = "";
  dump.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(`[mysqldump] ${text}`);
  });

  dump.on("error", (err) => {
    console.error(`[backup] Erro spawnando mysqldump:`, err.message);
    process.exit(1);
  });

  const gz = createGzip({ level: 9 });
  dump.stdout.pipe(gz);

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: gz,
      ContentType: "application/gzip",
      Metadata: {
        database: conn.database,
        host: conn.host,
        startedAt: new Date(inicio).toISOString(),
      },
    },
  });

  upload.on("httpUploadProgress", (p) => {
    if (p.loaded) console.log(`[backup] enviado ${(p.loaded / 1024 / 1024).toFixed(1)} MB`);
  });

  // Espera o dump terminar; se falhar, o gzip fecha sozinho e o Upload falha.
  const dumpExit: number = await new Promise((resolve) => dump.on("close", resolve));
  if (dumpExit !== 0) {
    console.error(`[backup] mysqldump falhou (exit=${dumpExit}). stderr:\n${stderr}`);
    upload.abort().catch(() => {});
    process.exit(1);
  }

  await upload.done();
  const dur = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`[backup] OK em ${dur}s. Objeto: s3://${bucket}/${key}`);
}

main().catch((err) => {
  console.error("[backup] FALHOU:", err);
  process.exit(1);
});
