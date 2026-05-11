/**
 * Storage de anexos do módulo financeiro. Reutiliza o bucket S3 do
 * backup global (env BACKUP_*), apenas com prefixo `anexos/`.
 *
 * Decisões:
 *  - Sem bucket próprio: pra escritórios pequenos não vale segregar
 *  - Sem ACL pública: download via URL assinada (GET temporário, 5min)
 *  - Sem multipart upload (lib-storage): anexos são pequenos, base64
 *    via tRPC chega no servidor já em memória e PutObject simples
 *  - Quando BACKUP_* não está configurado, `obterAnexosConfig()` retorna
 *    null e as procedures falham com mensagem clara
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";

export interface AnexosConfig {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Prefixo dentro do bucket. Sempre termina com '/'. */
  prefixo: string;
}

const PREFIXO_ANEXOS = "anexos/";

export function obterAnexosConfig(): AnexosConfig | null {
  const bucket = process.env.BACKUP_BUCKET;
  const endpoint = process.env.BACKUP_BUCKET_ENDPOINT;
  const region = process.env.BACKUP_BUCKET_REGION;
  const accessKeyId = process.env.BACKUP_ACCESS_KEY;
  const secretAccessKey = process.env.BACKUP_SECRET_KEY;
  if (!bucket || !endpoint || !region || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return {
    bucket,
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    prefixo: PREFIXO_ANEXOS,
  };
}

function montarClient(cfg: AnexosConfig): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: true,
    // 30s por request: cobre upload de 5MB em rede ~2Mbps sem travar
    // indefinidamente em rede lenta. Retry 3x cobre flapping de rede.
    requestHandler: { requestTimeout: 30_000 } as any,
    maxAttempts: 3,
  });
}

/**
 * Gera storage key estável e único:
 *   anexos/{escritorioId}/{tipoEntidade}/{entidadeId}/{rand}_{filename}
 * O randomHex evita conflito quando o user sobe 2 arquivos com mesmo nome.
 */
export function montarStorageKey(
  escritorioId: number,
  tipoEntidade: "despesa" | "cobranca",
  entidadeId: number,
  filename: string,
): string {
  const randHex = randomBytes(6).toString("hex");
  // Sanitiza filename: remove path separators e caracteres problemáticos
  const safeName = filename
    .replace(/[\\/]/g, "_")
    .replace(/[^\w.\- ]/g, "_")
    .slice(0, 200);
  return `${PREFIXO_ANEXOS}${escritorioId}/${tipoEntidade}/${entidadeId}/${randHex}_${safeName}`;
}

/** Sobe um anexo no S3. Buffer já deve estar em memória. */
export async function uploadAnexo(
  cfg: AnexosConfig,
  storageKey: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  const client = montarClient(cfg);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
  } finally {
    client.destroy();
  }
}

/** Apaga um anexo do S3. Erros são propagados (caller decide retry). */
export async function deleteAnexo(cfg: AnexosConfig, storageKey: string): Promise<void> {
  const client = montarClient(cfg);
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: cfg.bucket, Key: storageKey }),
    );
  } finally {
    client.destroy();
  }
}

/**
 * Gera URL temporária pra GET. Expira em 5 minutos. Suficiente pra
 * abrir/baixar; expiração curta limita compartilhamento acidental.
 */
export async function gerarUrlDownload(
  cfg: AnexosConfig,
  storageKey: string,
): Promise<string> {
  const client = montarClient(cfg);
  try {
    const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: storageKey });
    return await getSignedUrl(client, cmd, { expiresIn: 300 });
  } finally {
    client.destroy();
  }
}
