/**
 * Backup global do MySQL — listar, gerar e baixar dumps salvos em S3.
 *
 * Refatora `scripts/backup-db.ts`: a CLI continua funcional (chama
 * `executarBackupGlobal`), e a UI admin reusa as mesmas helpers pra
 * disparar backups sob demanda + listar/baixar os existentes.
 *
 * Restore NÃO é feito por aqui — é destrutivo demais pra "botão". A UI
 * admin mostra instruções pra rodar `mysql < dump.sql` manualmente.
 */
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { ListObjectsV2Command, S3Client, type _Object } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface ConexaoMysql {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface BackupGlobalConfig {
  databaseUrl: string;
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface BackupGlobalRegistro {
  key: string;
  database: string;
  tamanhoBytes: number;
  criadoEm: Date;
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

/**
 * Lê config do ENV. Retorna null se algo essencial faltar — UI mostra
 * warning ("backup não configurado") em vez de quebrar.
 */
export function obterConfigBackupDoEnv(): BackupGlobalConfig | null {
  const exigir = (n: string) => process.env[n];
  const databaseUrl = exigir("DATABASE_URL");
  const bucket = exigir("BACKUP_BUCKET");
  const endpoint = exigir("BACKUP_BUCKET_ENDPOINT");
  const region = exigir("BACKUP_BUCKET_REGION");
  const accessKeyId = exigir("BACKUP_ACCESS_KEY");
  const secretAccessKey = exigir("BACKUP_SECRET_KEY");
  if (!databaseUrl || !bucket || !endpoint || !region || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return { databaseUrl, bucket, endpoint, region, accessKeyId, secretAccessKey };
}

function montarS3Client(cfg: BackupGlobalConfig): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: true,
  });
}

/**
 * Lista os dumps disponíveis no S3 sob `mysql/<database>/`. Ordena do
 * mais recente pro mais antigo.
 */
export async function listarBackupsGlobais(cfg: BackupGlobalConfig): Promise<BackupGlobalRegistro[]> {
  const conn = parseDatabaseUrl(cfg.databaseUrl);
  const s3 = montarS3Client(cfg);
  const prefix = `mysql/${conn.database}/`;

  const out: BackupGlobalRegistro[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key || !obj.LastModified || obj.Size == null) continue;
      out.push({
        key: obj.Key,
        database: conn.database,
        tamanhoBytes: obj.Size,
        criadoEm: obj.LastModified,
      });
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  out.sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
  return out;
}

/**
 * URL S3 pré-assinada pra download direto pelo navegador (15 min). O
 * admin clica e baixa do bucket sem passar pelo servidor.
 */
export async function urlAssinadaDownload(
  cfg: BackupGlobalConfig,
  key: string,
  expiraEmSegundos = 15 * 60,
): Promise<string> {
  const s3 = montarS3Client(cfg);
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), {
    expiresIn: expiraEmSegundos,
  });
}

/**
 * Dispara `mysqldump` sob demanda → gzip → upload streaming pro S3.
 * Retorna o registro criado quando termina.
 *
 * Observabilidade:
 *  - stderr do mysqldump pipado pra `process.stderr` em tempo real (com
 *    `--verbose`, mostra `Dumping table X` por tabela).
 *  - console.log marca início/fim de cada fase pra timeline clara nos
 *    logs do Railway, mesmo se o cliente HTTP cair antes do fim.
 *
 * Compatibilidade MariaDB-client × MySQL 8 server:
 *  No container Railway o `default-mysql-client` aponta pro MariaDB.
 *  MariaDB mysqldump NÃO conhece `--column-statistics=0` (flag exclusiva
 *  do MySQL 8 client) e morre com `unknown option`. Removida — sem essa
 *  flag o conteúdo do dump não muda; ela só servia pra silenciar warning
 *  específico de MySQL 8 client contra MySQL 5.x server.
 */
export async function executarBackupGlobal(cfg: BackupGlobalConfig): Promise<BackupGlobalRegistro> {
  const inicio = Date.now();
  const conn = parseDatabaseUrl(cfg.databaseUrl);
  const s3 = montarS3Client(cfg);
  const stamp = new Date(inicio).toISOString().replace(/[:.]/g, "-");
  const key = `mysql/${conn.database}/${stamp}.sql.gz`;

  console.log(
    `[backup-admin] iniciando: ${conn.host}:${conn.port}/${conn.database} -> s3://${cfg.bucket}/${key}`,
  );

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
      // --verbose imprime "Dumping table_name (rows)" no stderr a cada
      // tabela. Combinado com o stream de stderr no handler abaixo, dá
      // progresso real-time nos logs do GitHub Actions.
      "--verbose",
      conn.database,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let stderr = "";
  dump.stderr.on("data", (chunk: Buffer) => {
    const str = chunk.toString();
    stderr += str;
    // Stream stderr pro stdout do processo pai pra ficar visível em tempo
    // real nos logs (GitHub Actions). Sem isso, erros do mysqldump só
    // aparecem após exit — se o processo trava, fica invisível.
    process.stderr.write(`[mysqldump] ${str}`);
  });
  dump.on("error", (err) => {
    // Spawn falhou (binário não existe, permissão negada, etc). dump.on("close")
    // ainda dispara depois com exit code -2, mas logamos aqui pra a causa
    // raiz aparecer nos logs antes do erro genérico.
    console.error(`[backup-admin] erro ao spawnar mysqldump: ${err.message}`);
  });

  const gz = createGzip({ level: 9 });
  dump.stdout.pipe(gz);

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: cfg.bucket,
      Key: key,
      Body: gz,
      ContentType: "application/gzip",
      Metadata: {
        database: conn.database,
        host: conn.host,
        startedAt: new Date(inicio).toISOString(),
        origin: "ui-admin",
      },
    },
  });

  const dumpExit: number = await new Promise((resolve) => dump.on("close", resolve));
  const dumpDur = Math.round((Date.now() - inicio) / 1000);
  console.log(`[backup-admin] mysqldump terminou (exit=${dumpExit}) após ${dumpDur}s`);
  if (dumpExit !== 0) {
    upload.abort().catch(() => {});
    throw new Error(`mysqldump falhou (exit=${dumpExit}). stderr (últimos 2KB):\n${stderr.slice(-2000)}`);
  }

  console.log(`[backup-admin] aguardando upload finalizar em s3://${cfg.bucket}/${key}…`);
  const result = await upload.done();
  console.log(`[backup-admin] upload OK em ${Math.round((Date.now() - inicio) / 1000)}s totais.`);
  // Tamanho não vem direto — fazemos um HEAD pra obter (rápido, sem custo).
  // Se falhar, cai pra estimativa baseada nos bytes que o gzip reportou.
  let tamanhoBytes = 0;
  try {
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: key }),
    );
    const obj = list.Contents?.[0];
    if (obj?.Size != null) tamanhoBytes = obj.Size;
  } catch {
    // best effort
  }

  return {
    key: result.Key ?? key,
    database: conn.database,
    tamanhoBytes,
    criadoEm: new Date(inicio),
  };
}
