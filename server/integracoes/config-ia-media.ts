/**
 * Config de mídia da IA por escritório — flags "Whisper" (áudio→texto) e
 * "Vision" (imagem) que ficam no card do ChatGPT (Configurações → Apps
 * externos), guardadas no config do canal `chatgpt` junto com a chave OpenAI.
 */
import { getDb } from "../db";
import { canaisIntegrados } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { obterConfigCanal } from "../escritorio/db-canais";
import { transcreverAudioOpenAI } from "./openai-audio";
import { createLogger } from "../_core/logger";

const log = createLogger("config-ia-media");

export interface ConfigIAMedia {
  canalId: number;
  openaiApiKey?: string;
  whisperAtivo: boolean;
  visionAtivo: boolean;
}

function flagOn(v: unknown): boolean {
  return v === true || v === "true";
}

/** Lê o canal `chatgpt` do escritório e devolve a chave + flags de mídia.
 *  Null se o escritório não configurou o card do ChatGPT. */
export async function obterConfigIAMedia(escritorioId: number): Promise<ConfigIAMedia | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: canaisIntegrados.id })
    .from(canaisIntegrados)
    .where(and(eq(canaisIntegrados.escritorioId, escritorioId), eq(canaisIntegrados.tipo, "chatgpt")))
    .limit(1);
  if (!row) return null;
  const cfg = await obterConfigCanal(row.id, escritorioId);
  return {
    canalId: row.id,
    openaiApiKey: cfg?.openaiApiKey,
    whisperAtivo: flagOn(cfg?.whisperAtivo),
    visionAtivo: flagOn(cfg?.visionAtivo),
  };
}

/** Transcreve um áudio do WhatsApp se o escritório tem Whisper ligado e uma
 *  chave OpenAI configurada. Retorna o texto ou null (silencioso). */
export async function transcreverAudioWhatsapp(escritorioId: number, mediaUrl: string): Promise<string | null> {
  try {
    const c = await obterConfigIAMedia(escritorioId);
    if (!c?.whisperAtivo || !c.openaiApiKey) return null;
    return await transcreverAudioOpenAI(c.openaiApiKey, mediaUrl);
  } catch (e: any) {
    log.warn({ err: e?.message, escritorioId }, "transcrição de áudio falhou");
    return null;
  }
}
