/**
 * Transcrição de áudio via OpenAI (Whisper) — usado quando o escritório liga
 * "Whisper" no card do ChatGPT (Configurações → Apps externos). Converte notas
 * de voz do WhatsApp em texto pro agente entender.
 */
import fs from "fs/promises";
import path from "path";
import { createLogger } from "../_core/logger";

const log = createLogger("openai-audio");

const TIMEOUT_MS = 30000;

/** Lê os bytes de uma fonte de mídia: URL pública (/uploads/...), caminho
 *  absoluto no disco, ou http(s). Cobre os formatos que os adapters (Baileys /
 *  Cloud API) gravam em `mediaUrl`. */
export async function lerBytesDeMedia(fonte: string): Promise<Buffer | null> {
  try {
    if (/^https?:\/\//i.test(fonte)) {
      const r = await fetch(fonte, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    }
    const abs = path.isAbsolute(fonte) ? fonte : path.join(process.cwd(), fonte.replace(/^\/+/, ""));
    return await fs.readFile(abs);
  } catch (e: any) {
    log.warn({ err: e?.message, fonte }, "Whisper: falha ao ler o arquivo de áudio");
    return null;
  }
}

function nomeArquivoDe(fonte: string): string {
  const base = (fonte.split("?")[0].split("/").pop() || "audio.ogg").trim();
  return base.includes(".") ? base : `${base}.ogg`;
}

/** Transcreve um áudio via Whisper. Retorna o texto, ou null em qualquer falha
 *  (sem transcrição o áudio simplesmente não dispara o fluxo — igual a antes). */
export async function transcreverAudioOpenAI(apiKey: string, fonteMedia: string): Promise<string | null> {
  const bytes = await lerBytesDeMedia(fonteMedia);
  if (!bytes) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)]), nomeArquivoDe(fonteMedia));
    form.append("model", "whisper-1");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const t = await res.text();
      log.warn({ status: res.status, t: t.slice(0, 200) }, "Whisper: API retornou erro");
      return null;
    }
    const data = (await res.json()) as { text?: string };
    return (data.text || "").trim() || null;
  } catch (e: any) {
    log.warn({ err: e?.message }, "Whisper: chamada falhou");
    return null;
  }
}
