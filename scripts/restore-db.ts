/**
 * Restore manual de um backup do MySQL.
 *
 *   pnpm tsx scripts/restore-db.ts <chave_no_bucket>
 *
 * Ex:
 *   pnpm tsx scripts/restore-db.ts mysql/jurify_prod/2026-04-29T03-00-00-000Z.sql.gz
 *
 * RESTAURA NO DATABASE_URL ATUAL — verifique a variável antes de rodar!
 *
 * Por segurança, se o nome do banco contém "prod", o script pede
 * confirmação interativa antes de executar.
 *
 * Variáveis de ambiente exigidas: as mesmas do backup-db.ts +
 * `RESTORE_CONFIRM=YES` pra pular o prompt em CI.
 */

import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline/promises";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

function parseDatabaseUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "3306",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
  };
}

function exigir(n: string) {
  const v = process.env[n];
  if (!v) throw new Error(`${n} não definida`);
  return v;
}

async function confirmar(db: string): Promise<boolean> {
  if (process.env.RESTORE_CONFIRM === "YES") return true;
  if (!db.toLowerCase().includes("prod")) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const r = await rl.question(`Banco "${db}" parece produção. Digite o nome do banco pra confirmar: `);
  rl.close();
  return r.trim() === db;
}

async function main() {
  const objKey = process.argv[2];
  if (!objKey) {
    console.error("Uso: tsx scripts/restore-db.ts <chave_no_bucket>");
    process.exit(2);
  }

  const conn = parseDatabaseUrl(exigir("DATABASE_URL"));

  if (!(await confirmar(conn.database))) {
    console.error("Confirmação negada. Abortando.");
    process.exit(1);
  }

  const s3 = new S3Client({
    endpoint: exigir("BACKUP_BUCKET_ENDPOINT"),
    region: exigir("BACKUP_BUCKET_REGION"),
    credentials: {
      accessKeyId: exigir("BACKUP_ACCESS_KEY"),
      secretAccessKey: exigir("BACKUP_SECRET_KEY"),
    },
    forcePathStyle: true,
  });

  console.log(`[restore] Baixando s3://${exigir("BACKUP_BUCKET")}/${objKey}`);
  const obj = await s3.send(new GetObjectCommand({
    Bucket: exigir("BACKUP_BUCKET"),
    Key: objKey,
  }));
  if (!obj.Body) throw new Error("Body vazio");

  const mysql = spawn(
    "mysql",
    [
      `--host=${conn.host}`,
      `--port=${conn.port}`,
      `--user=${conn.user}`,
      `--password=${conn.password}`,
      conn.database,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );

  await pipeline(
    obj.Body as Readable,
    createGunzip(),
    mysql.stdin,
  );

  const exit: number = await new Promise((resolve) => mysql.on("close", resolve));
  if (exit !== 0) {
    console.error(`[restore] mysql falhou (exit=${exit})`);
    process.exit(1);
  }
  console.log("[restore] OK");
}

main().catch((err) => {
  console.error("[restore] FALHOU:", err);
  process.exit(1);
});
