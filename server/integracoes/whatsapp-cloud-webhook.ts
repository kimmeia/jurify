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
import { createLogger } from "../_core/logger";
import { verificarAssinaturaMeta } from "./meta-signature";
const log = createLogger("integracoes-whatsapp-cloud-webhook");

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lê a config Meta decriptada de `admin_integracoes` (provedor='whatsapp_cloud').
 * Retorna `{verifyToken, appSecret}` — campos individuais existem na mesma
 * config, então combinar ambos numa só leitura economiza chamadas. Vazio
 * em qualquer campo significa "não configurado" (modo legado).
 */
async function getMetaConfig(): Promise<{
  verifyToken: string;
  appSecret: string;
}> {
  const db = await getDb();
  if (!db) return { verifyToken: "", appSecret: "" };
  try {
    const [row] = await db
      .select()
      .from(adminIntegracoes)
      .where(eq(adminIntegracoes.provedor, "whatsapp_cloud"))
      .limit(1);
    if (!row?.apiKeyEncrypted || !row?.apiKeyIv || !row?.apiKeyTag) {
      return { verifyToken: "", appSecret: "" };
    }
    const config = decryptConfig(
      row.apiKeyEncrypted,
      row.apiKeyIv,
      row.apiKeyTag,
    );
    return {
      verifyToken: typeof config?.webhookVerifyToken === "string" ? config.webhookVerifyToken : "",
      appSecret: typeof config?.appSecret === "string" ? config.appSecret : "",
    };
  } catch {
    return { verifyToken: "", appSecret: "" };
  }
}

/** Mantido por compat — usado só no GET de verificação. */
async function getVerifyToken(): Promise<string> {
  return (await getMetaConfig()).verifyToken;
}

interface CanalInfo {
  canalId: number;
  escritorioId: number;
  accessToken: string;
}

/** Busca canal CoEx pelo phoneNumberId ou wabaId */
async function findCanalByPhoneNumberId(phoneNumberId: string): Promise<CanalInfo | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const canais = await db.select().from(canaisIntegrados)
      .where(eq(canaisIntegrados.tipo, "whatsapp_api"));

    for (const canal of canais) {
      if (!canal.configEncrypted || !canal.configIv || !canal.configTag) continue;
      try {
        const config = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
        // Match exato pelo phoneNumberId — crucial pra multi-tenant.
        // Antes tinha um fallback "|| config.coexMode === 'true'" que
        // dava match liberal e podia rotear mensagem do número A pro
        // canal do número B no mesmo (ou em outro) escritório.
        if (config.phoneNumberId === phoneNumberId) {
          return {
            canalId: canal.id,
            escritorioId: canal.escritorioId,
            accessToken: typeof config.accessToken === "string" ? config.accessToken : "",
          };
        }
      } catch { continue; }
    }
  } catch {}
  return null;
}

/**
 * Resolve o canal de uma mensagem recebida ESTRITAMENTE pelo phone_number_id.
 *
 * Sem fallback por wabaId de propósito: vários números podem dividir a MESMA
 * WABA e só alguns estarem conectados neste JuriFy (ex.: o cliente usa um dos
 * números em outro sistema). Cair no wabaId entregava a mensagem de um número
 * NÃO-conectado pro canal de outro número da mesma WABA — vazamento real entre
 * sistemas/escritórios. O phone_number_id é único por número e sempre presente
 * em eventos de mensagem, então é a única autoridade segura de roteamento.
 */
export async function resolverCanalDaMensagem(
  phoneNumberId: string | undefined,
): Promise<CanalInfo | null> {
  if (!phoneNumberId) return null;
  return findCanalByPhoneNumberId(phoneNumberId);
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

    log.info({ mode, hasToken: !!token }, "Verificação webhook recebida");

    if (mode === "subscribe") {
      const verifyToken = await getVerifyToken();
      if (verifyToken && token === verifyToken) {
        log.info("[WhatsApp Cloud] Webhook verificado com sucesso!");
        return res.status(200).send(challenge);
      }
      log.warn("[WhatsApp Cloud] Token de verificação inválido");
      return res.status(403).send("Forbidden");
    }

    res.status(400).send("Bad Request");
  });

  // ─── POST: Receber mensagens e status updates ────────────────────────
  app.post("/api/webhooks/whatsapp", async (req: Request, res: Response) => {
    // Valida HMAC ANTES de responder/processar. Atacante na internet
    // podia forjar mensagens recebidas (criar conversas fake, disparar
    // SmartFlow, transferir conversas) sem essa proteção. Body raw foi
    // capturado em `req.rawBody` pelo middleware verify do express.json
    // (server/_core/index.ts) pra paths /api/webhooks/.
    const { appSecret } = await getMetaConfig();
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const sigHeader = req.header("X-Hub-Signature-256");
    const verif = verificarAssinaturaMeta(rawBody, sigHeader, appSecret);

    if (!verif.ok) {
      log.warn(
        {
          mode: verif.mode,
          motivo: verif.motivo,
          hasHeader: !!sigHeader,
        },
        "[WhatsApp Cloud] Assinatura HMAC inválida — request rejeitada",
      );
      // 401 não 200: Meta vai retentar (configurável no painel). Atacante
      // recebe rejeição clara em vez de ack silencioso.
      return res.status(401).json({ error: "Assinatura inválida" });
    }
    if (verif.mode === "no-secret") {
      log.warn(
        "[WhatsApp Cloud] appSecret não configurado em admin_integracoes — cadastre o App Secret do Facebook App pra ativar validação HMAC. Sem isso, qualquer um pode forjar mensagens recebidas.",
      );
    }

    // Meta espera 200 dentro de ~20s. HMAC já validado em <1ms; resto
    // do processamento (DB, SmartFlow) roda em background.
    res.status(200).send("OK");

    try {
      const body = req.body;
      if (body.object !== "whatsapp_business_account") return;

      for (const entry of body.entry || []) {
        const wabaId = entry.id;

        for (const change of entry.changes || []) {
          // Eventos da Calling API chegam no MESMO webhook, em field "calls"
          // (HMAC já validado acima). Import dinâmico evita ciclo com o handler,
          // que importa resolverCanalDaMensagem deste arquivo.
          if (change.field === "calls") {
            try {
              const { processarEventoChamada } = await import("./whatsapp-calling-handler");
              await processarEventoChamada(change.value);
            } catch (callErr: any) {
              log.error("[WhatsApp Cloud] Erro ao processar evento de chamada:", callErr.message);
            }
            continue;
          }
          if (change.field !== "messages") continue;

          const value = change.value;
          const phoneNumberId = value?.metadata?.phone_number_id;

          // Resolve o canal ESTRITAMENTE pelo número (phone_number_id), sem
          // fallback por wabaId — ver resolverCanalDaMensagem. Mensagem de um
          // número não-conectado é ignorada (não vaza pro canal de outro número
          // que divida a mesma WABA).
          const canalInfo = await resolverCanalDaMensagem(phoneNumberId);
          if (!canalInfo) {
            log.warn(
              { phoneNumberId, wabaId },
              "[WhatsApp Cloud] Mensagem de número não conectado neste JuriFy — ignorada",
            );
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
              // mediaId: ID opaco da Meta (usado pra baixar). mediaUrl: path
              // público local após download (vai pro DB).
              let mediaId = "";
              let mediaUrl = "";
              let nomeOriginalArquivo: string | undefined;
              // Preenchido SÓ pra type=interactive (resposta a botão/lista
              // enviada via `enviarBotoes`/`enviarLista`). Vai pro contexto
              // SmartFlow pra roteamento por id (sem ambiguidade de texto).
              let interactiveReply: { tipo: "button" | "list"; id: string; titulo: string } | undefined;

              switch (message.type) {
                case "text":
                  conteudo = message.text?.body || "";
                  tipo = "texto";
                  break;
                case "interactive": {
                  const inter = (message as any).interactive;
                  if (inter?.type === "button_reply" && inter.button_reply) {
                    interactiveReply = {
                      tipo: "button",
                      id: String(inter.button_reply.id || ""),
                      titulo: String(inter.button_reply.title || ""),
                    };
                  } else if (inter?.type === "list_reply" && inter.list_reply) {
                    interactiveReply = {
                      tipo: "list",
                      id: String(inter.list_reply.id || ""),
                      titulo: String(inter.list_reply.title || ""),
                    };
                  }
                  // Conteúdo da mensagem persistida = título do que foi clicado,
                  // pra UI do inbox mostrar de forma humana o que o cliente
                  // escolheu (ex: "📅 Quero agendar") em vez de "[interactive]".
                  conteudo = interactiveReply?.titulo || "[interactive]";
                  tipo = "texto";
                  break;
                }
                case "image":
                  conteudo = message.image?.caption || "Imagem";
                  mediaId = message.image?.id || "";
                  tipo = "imagem";
                  break;
                case "audio":
                  conteudo = "Audio";
                  mediaId = message.audio?.id || "";
                  tipo = "audio";
                  break;
                case "video":
                  conteudo = message.video?.caption || "Video";
                  mediaId = message.video?.id || "";
                  tipo = "video";
                  break;
                case "document":
                  conteudo = message.document?.filename || "Documento";
                  mediaId = message.document?.id || "";
                  nomeOriginalArquivo = message.document?.filename;
                  tipo = "documento";
                  break;
                case "sticker":
                  conteudo = "Sticker";
                  mediaId = message.sticker?.id || "";
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

              // Baixa mídia da Cloud API e persiste local. Sem isso, o
              // frontend renderiza só o ícone/label (regex de [media:/path]
              // exige path começando com "/").
              if (mediaId && canalInfo.accessToken) {
                const { baixarMidiaCloudApi } = await import("./whatsapp-cloud-media");
                const baixada = await baixarMidiaCloudApi({
                  mediaId,
                  accessToken: canalInfo.accessToken,
                  escritorioId: canalInfo.escritorioId,
                  canalId: canalInfo.canalId,
                  nomeOriginal: nomeOriginalArquivo,
                });
                if (baixada) mediaUrl = baixada.url;
              }

              const msg: WhatsappMensagemRecebida = {
                chatId: message.from + "@s.whatsapp.net",
                nome,
                telefone,
                conteudo,
                tipo,
                mediaUrl,
                interactiveReply,
                timestamp: parseInt(message.timestamp) || Math.floor(Date.now() / 1000),
                messageId: message.id,
                isGroup: false,
              };

              log.info(`[WhatsApp Cloud] Mensagem de ${nome} (${telefone}): ${conteudo.slice(0, 50)}`);
              await processarMensagemRecebida(canalInfo.canalId, canalInfo.escritorioId, msg);

            } catch (msgErr: any) {
              log.error(`[WhatsApp Cloud] Erro ao processar mensagem:`, msgErr.message);
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
      log.error("[WhatsApp Cloud] Erro geral no webhook:", err.message);
    }
  });

  log.info("[WhatsApp Cloud] Webhook registrado: GET/POST /api/webhooks/whatsapp");
}
