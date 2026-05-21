/**
 * WhatsApp Cloud API — Download de mídia.
 *
 * Diferente do Baileys, a Cloud API entrega só o `media_id` no payload do
 * webhook. Pra obter o arquivo precisa:
 *   1. GET /v21.0/{media_id}        → retorna URL temporária (~5min validade)
 *   2. GET <URL retornada>          → baixa o binário (mesmo Bearer token)
 *
 * Persistimos em disco em `./uploads/whatsapp-cloud/{escritorioId}/canal_{id}/`
 * e devolvemos o path público pra UI renderizar via <img>/<audio>/<a>.
 *
 * Storage local é efêmero em ambientes como Railway (container recicla,
 * mídia some). Pra histórico de longo prazo migrar pra S3/R2 — o ponto
 * de extensão é `salvarBinario` (substituir fs.writeFile por upload).
 */

import axios from "axios";
import { promises as fs } from "fs";
import path from "path";
import { createLogger } from "../_core/logger";

const log = createLogger("integracoes-whatsapp-cloud-media");

/** Mapeia mime-type da Meta para extensão de arquivo legível. */
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/amr": "amr",
  "audio/aac": "aac",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};

function extDoMime(mime: string, fallbackName?: string): string {
  if (MIME_TO_EXT[mime]) return MIME_TO_EXT[mime];
  if (fallbackName) {
    const ext = path.extname(fallbackName).replace(/^\./, "").toLowerCase();
    if (ext) return ext;
  }
  return "bin";
}

export interface MidiaBaixada {
  /** Path público pro frontend (`/uploads/whatsapp-cloud/...`). */
  url: string;
  /** Mime-type retornado pela Meta. */
  mime: string;
  /** Tamanho do arquivo em bytes. */
  bytes: number;
}

/**
 * Baixa mídia da Cloud API e persiste no disco.
 * Retorna null em qualquer falha — handler segue salvando a mensagem
 * sem mídia visível (UI mostra ícone+label, igual ao comportamento atual
 * sem implementação de download).
 */
export async function baixarMidiaCloudApi(opts: {
  mediaId: string;
  accessToken: string;
  escritorioId: number;
  canalId: number;
  nomeOriginal?: string;
}): Promise<MidiaBaixada | null> {
  const { mediaId, accessToken, escritorioId, canalId, nomeOriginal } = opts;
  if (!mediaId || !accessToken) return null;

  try {
    const metaResp = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10_000,
    });
    const mediaUrl: string | undefined = metaResp.data?.url;
    const mime: string = metaResp.data?.mime_type || "application/octet-stream";
    if (!mediaUrl) {
      log.warn({ mediaId }, "Meta não retornou URL para mídia");
      return null;
    }

    const file = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: "arraybuffer",
      timeout: 30_000,
      maxContentLength: 100 * 1024 * 1024,
    });

    const buffer = Buffer.from(file.data as ArrayBuffer);
    const ext = extDoMime(mime, nomeOriginal);
    const fileName = `${mediaId}.${ext}`;
    const relDir = path.join("uploads", "whatsapp-cloud", String(escritorioId), `canal_${canalId}`);
    const absDir = path.join(process.cwd(), relDir);
    await fs.mkdir(absDir, { recursive: true });
    await fs.writeFile(path.join(absDir, fileName), buffer);

    const publicUrl = `/${relDir.replace(/\\/g, "/")}/${fileName}`;
    log.info({ mediaId, mime, bytes: buffer.byteLength, url: publicUrl }, "Mídia Cloud API baixada");
    return { url: publicUrl, mime, bytes: buffer.byteLength };
  } catch (err: any) {
    log.warn(
      {
        mediaId,
        status: err?.response?.status,
        fbError: err?.response?.data?.error,
        msg: err?.message,
      },
      "Falha ao baixar mídia Cloud API",
    );
    return null;
  }
}

export const __testing__ = { MIME_TO_EXT, extDoMime };
