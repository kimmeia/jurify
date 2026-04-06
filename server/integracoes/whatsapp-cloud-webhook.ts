/**
 * WhatsApp Cloud API — Webhook Handler (CoEx)
 *
 * Recebe mensagens da Meta Cloud API e processa no CRM.
 * Endpoint: GET  /api/webhooks/whatsapp (verificacao)
 *           POST /api/webhooks/whatsapp (mensagens)
 *
 * O Meta envia webhooks com estrutura:
 * { object: "whatsapp_business_account", entry: [{ id, changes: [{ value, field }] }] }
 */

import type { Express, Request, Response } from "express";
import { getDb } from "../db";
import { canaisIntegrados, adminIntegracoes } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { processarMensagemRecebida } from "./whatsapp-handler";
import { decryptConfig } from "../escritorio/crypto-utils";
import type { WhatsappMensagemRecebida } from "../../shared/whatsapp-types";

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Busca o verify token configurado no admin (adminIntegracoes provedor=whatsapp_cloud) */
async function getVerifyToken(): Promise<string> {
  const db = await getDb();
  if (!db) return "";
  try {
    const [row] = await db.select().from(adminIntegracoes)
      .where(eq(adminIntegracoes.provedor, "whatsapp_cloud")).limit(1);
    if (!row?.apiKeyEncrypted || !row?.apiKeyIv || !row?.apiKeyTag) return "";
    // decryptConfig já retorna o objeto parseado: {appId, appSecret, webhookVerifyToken}
    const config = decryptConfig(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);
    return config.webhookVerifyToken || "";
  } catch { return ""; }
}

/** Busca canal CoEx pelo phoneNumberId ou wabaId */
async function findCanalByPhoneNumberId(phoneNumberId: string): Promise<{ canalId: number; escritorioId: number } | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const canais = await db.select().from(canaisIntegrados)
      .where(eq(canaisIntegrados.tipo, "whatsapp_api"));

    for (const canal of canais) {
      if (!canal.configEncrypted || !canal.configIv || !canal.configTag) continue;
      try {
        const config = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
        if (config.phoneNumberId === phoneNumberId || config.coexMode === "true") {
          return { canalId: canal.id, escritorioId: canal.escritorioId };
        }
      } catch { continue; }
    }
  } catch {}
  return null;
}

/** Busca canal CoEx pelo WABA ID (metadata do webhook) */
async function findCanalByWabaId(wabaId: string): Promise<{ canalId: number; escritorioId: number } | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const canais = await db.select().from(canaisIntegrados)
      .where(eq(canaisIntegrados.tipo, "whatsapp_api"));

    for (const canal of canais) {
      if (!canal.configEncrypted || !canal.configIv || !canal.configTag) continue;
      try {
        const config = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
        if (config.wabaId === wabaId) {
          return { canalId: canal.id, escritorioId: canal.escritorioId };
        }
      } catch { continue; }
    }
  } catch {}
  return null;
}

/** Extrai telefone do formato WhatsApp (5511999999999) */
function formatPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

export function registerWhatsAppCloudWebhook(app: Express) {
  // ─── GET: Verificação do webhook pela Meta ───────────────────────────
  app.get("/api/webhooks/whatsapp", async (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("[WhatsApp Cloud] Verificação webhook recebida:", { mode, token: token ? "***" : "vazio" });

    if (mode === "subscribe") {
      const verifyToken = await getVerifyToken();
      if (verifyToken && token === verifyToken) {
        console.log("[WhatsApp Cloud] Webhook verificado com sucesso!");
        return res.status(200).send(challenge);
      }
      console.warn("[WhatsApp Cloud] Token de verificação inválido");
      return res.status(403).send("Forbidden");
    }

    res.status(400).send("Bad Request");
  });

  // ─── POST: Receber mensagens e status updates ────────────────────────
  app.post("/api/webhooks/whatsapp", async (req: Request, res: Response) => {
    // Meta espera 200 imediatamente
    res.status(200).send("OK");

    try {
      const body = req.body;
      if (body.object !== "whatsapp_business_account") return;

      for (const entry of body.entry || []) {
        const wabaId = entry.id;

        for (const change of entry.changes || []) {
          if (change.field !== "messages") continue;

          const value = change.value;
          const phoneNumberId = value?.metadata?.phone_number_id;

          // Encontrar canal associado
          let canalInfo = phoneNumberId ? await findCanalByPhoneNumberId(phoneNumberId) : null;
          if (!canalInfo && wabaId) canalInfo = await findCanalByWabaId(wabaId);
          if (!canalInfo) {
            console.warn(`[WhatsApp Cloud] Canal não encontrado para phoneNumberId=${phoneNumberId} wabaId=${wabaId}`);
            continue;
          }

          // Processar mensagens recebidas
          for (const message of value.messages || []) {
            try {
              const contact = (value.contacts || []).find((c: any) => c.wa_id === message.from);
              const telefone = formatPhone(message.from);
              const nome = contact?.profile?.name || telefone;

              let tipo: WhatsappMensagemRecebida["tipo"] = "texto";
              let conteudo = "";
              let mediaUrl = "";

              switch (message.type) {
                case "text":
                  conteudo = message.text?.body || "";
                  tipo = "texto";
                  break;
                case "image":
                  conteudo = message.image?.caption || "Imagem";
                  mediaUrl = message.image?.id || "";
                  tipo = "imagem";
                  break;
                case "audio":
                  conteudo = "Audio";
                  mediaUrl = message.audio?.id || "";
                  tipo = "audio";
                  break;
                case "video":
                  conteudo = message.video?.caption || "Video";
                  mediaUrl = message.video?.id || "";
                  tipo = "video";
                  break;
                case "document":
                  conteudo = message.document?.filename || "Documento";
                  mediaUrl = message.document?.id || "";
                  tipo = "documento";
                  break;
                case "sticker":
                  conteudo = "Sticker";
                  mediaUrl = message.sticker?.id || "";
                  tipo = "sticker";
                  break;
                case "location":
                  conteudo = `Localização: ${message.location?.latitude},${message.location?.longitude}`;
                  tipo = "localizacao";
                  break;
                case "contacts":
                  conteudo = message.contacts?.[0]?.name?.formatted_name || "Contato";
                  tipo = "contato";
                  break;
                default:
                  conteudo = `[${message.type}]`;
                  tipo = "texto";
              }

              const msg: WhatsappMensagemRecebida = {
                chatId: message.from + "@s.whatsapp.net",
                nome,
                telefone,
                conteudo,
                tipo,
                mediaUrl,
                timestamp: parseInt(message.timestamp) || Math.floor(Date.now() / 1000),
                messageId: message.id,
                isGroup: false,
              };

              console.log(`[WhatsApp Cloud] Mensagem de ${nome} (${telefone}): ${conteudo.slice(0, 50)}`);
              await processarMensagemRecebida(canalInfo.canalId, canalInfo.escritorioId, msg);

            } catch (msgErr: any) {
              console.error(`[WhatsApp Cloud] Erro ao processar mensagem:`, msgErr.message);
            }
          }

          // Processar status updates (entregue, lida, etc)
          for (const status of value.statuses || []) {
            try {
              const db = await getDb();
              if (!db) continue;
              const { mensagens } = await import("../../drizzle/schema");
              const newStatus = status.status === "read" ? "lida"
                : status.status === "delivered" ? "entregue"
                : status.status === "sent" ? "enviada"
                : status.status === "failed" ? "falha"
                : null;

              if (newStatus && status.id) {
                await db.update(mensagens)
                  .set({ status: newStatus as any })
                  .where(eq(mensagens.idExterno, status.id));
              }
            } catch { /* ignore status update errors */ }
          }
        }
      }
    } catch (err: any) {
      console.error("[WhatsApp Cloud] Erro geral no webhook:", err.message);
    }
  });

  console.log("[WhatsApp Cloud] Webhook registrado: GET/POST /api/webhooks/whatsapp");
}
