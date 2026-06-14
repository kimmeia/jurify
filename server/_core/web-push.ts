/**
 * Web Push (PWA): notificação de nova mensagem/movimentação com o app fechado.
 *
 * Chaves VAPID: env (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) se setadas; senão
 * gera UMA vez e persiste em `web_push_keys`. Assim funciona zero-config,
 * mas o ops pode fixar por env se quiser.
 *
 * Envio é best-effort e fire-and-forget: nunca quebra o fluxo de mensagem.
 * Inscrições que voltam 404/410 (expiradas) são removidas na hora.
 */

import webpush from "web-push";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { pushSubscriptions, webPushKeys } from "../../drizzle/schema";
import { createLogger } from "./logger";

const log = createLogger("web-push");

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let vapidCache: VapidKeys | null = null;
let configurado = false;

/**
 * Subject do VAPID — contato exigido pela spec (mailto: ou https:).
 * web-push valida o prefixo, então normalizamos pra um dos dois.
 */
function vapidSubject(): string {
  const email = process.env.FROM_EMAIL;
  if (email && email.includes("@")) return `mailto:${email}`;
  const url = process.env.APP_URL || "https://juridflow.com.br";
  return url.startsWith("http") ? url : `https://${url}`;
}

/**
 * Resolve as chaves VAPID: env → DB → gera e persiste. Cacheia em memória.
 * Retorna null só se o DB estiver indisponível e não houver env.
 */
async function obterVapid(): Promise<VapidKeys | null> {
  if (vapidCache) return vapidCache;

  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;
  if (envPub && envPriv) {
    vapidCache = { publicKey: envPub, privateKey: envPriv };
    return vapidCache;
  }

  const db = await getDb();
  if (!db) return null;

  const [existente] = await db.select().from(webPushKeys).limit(1);
  if (existente?.publicKey && existente?.privateKey) {
    vapidCache = { publicKey: existente.publicKey, privateKey: existente.privateKey };
    return vapidCache;
  }

  // Gera e persiste (1ª vez).
  const novas = webpush.generateVAPIDKeys();
  try {
    await db.insert(webPushKeys).values({ publicKey: novas.publicKey, privateKey: novas.privateKey });
  } catch {
    // Corrida: outra instância pode ter inserido — relê.
    const [r] = await db.select().from(webPushKeys).limit(1);
    if (r?.publicKey && r?.privateKey) {
      vapidCache = { publicKey: r.publicKey, privateKey: r.privateKey };
      return vapidCache;
    }
  }
  vapidCache = novas;
  log.info("Chaves VAPID geradas e persistidas (web_push_keys)");
  return vapidCache;
}

/** Garante webpush.setVapidDetails configurado (uma vez). */
async function garantirConfig(): Promise<boolean> {
  if (configurado) return true;
  const vapid = await obterVapid();
  if (!vapid) return false;
  webpush.setVapidDetails(vapidSubject(), vapid.publicKey, vapid.privateKey);
  configurado = true;
  return true;
}

/** Chave pública VAPID (pro client se inscrever). Null se indisponível. */
export async function getVapidPublicKey(): Promise<string | null> {
  const vapid = await obterVapid();
  return vapid?.publicKey ?? null;
}

/** Salva (ou atualiza) a inscrição de um dispositivo. Idempotente por endpoint. */
export async function salvarInscricao(
  userId: number,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: userAgent?.slice(0, 255) ?? null,
    })
    .onDuplicateKeyUpdate({
      set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 255) ?? null },
    });
}

/** Remove uma inscrição pelo endpoint (logout/desativar). */
export async function removerInscricao(endpoint: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export interface PushPayload {
  titulo: string;
  corpo: string;
  /** Para onde a notificação leva ao ser tocada (ex: /atendimento). */
  url?: string;
  /** Agrupa/atualiza notificações do mesmo assunto (ex: conversa). */
  tag?: string;
  /** Dados livres pro service worker (ex: conversaId). */
  dados?: Record<string, unknown>;
}

/**
 * Envia push pra todos os dispositivos de um usuário. Fire-and-forget no
 * caller. Limpa inscrições expiradas (404/410). Retorna diagnóstico:
 * quantas inscrições existiam e quantas o envio aceitou.
 */
export async function enviarPushParaUsuario(
  userId: number,
  payload: PushPayload,
): Promise<{ inscricoes: number; enviados: number }> {
  try {
    if (!(await garantirConfig())) return { inscricoes: 0, enviados: 0 };
    const db = await getDb();
    if (!db) return { inscricoes: 0, enviados: 0 };

    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    if (subs.length === 0) return { inscricoes: 0, enviados: 0 };

    const body = JSON.stringify({
      title: payload.titulo,
      body: payload.corpo,
      url: payload.url ?? "/atendimento",
      tag: payload.tag,
      dados: payload.dados ?? {},
    });

    let enviados = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
          );
          enviados++;
        } catch (err: any) {
          const status = err?.statusCode;
          if (status === 404 || status === 410) {
            // Inscrição morta — remove.
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).catch(() => {});
          } else {
            log.warn({ userId, status, err: err?.message }, "Falha ao enviar push (não-fatal)");
          }
        }
      }),
    );
    return { inscricoes: subs.length, enviados };
  } catch (err: any) {
    log.warn({ userId, err: err?.message }, "enviarPushParaUsuario falhou (não-fatal)");
    return { inscricoes: 0, enviados: 0 };
  }
}
