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

interface MetaStatusErro {
  code?: number | string;
  title?: string;
  message?: string;
  error_data?: { details?: string };
}

/**
 * Extrai o motivo legível de uma falha de entrega do `errors[]` que a Meta
 * manda no webhook de status `failed`. Ex: "131026: Message undeliverable".
 * Antes esse array era ignorado — a mensagem virava só status="falha" e o
 * operador ficava sem saber POR QUE não chegou. Exportada pra teste.
 */
export function extrairMotivoFalhaEntrega(status: { errors?: MetaStatusErro[] } | null | undefined): string {
  const e = Array.isArray(status?.errors) ? status!.errors![0] : undefined;
  if (!e) return "Falha na entrega (sem detalhe da Meta)";
  const detalhe = e.error_data?.details || e.message || e.title || "";
  return [e.code, detalhe].filter(Boolean).join(": ") || String(e.code ?? "falha");
}

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

/**
 * Lista de App Secrets aceitos na validação HMAC do webhook.
 *
 * Suporta MAIS DE UM app Meta entregando no mesmo callback — cenário real:
 * o app do Embedded Signup (principal, secret no painel Admin) e um segundo
 * app do BM do cliente (ex: quando o Login do app principal está suspenso
 * pela Meta e a recepção precisa fluir pelo app do próprio BM). Cada app
 * assina com o próprio secret; o evento vale se bater com qualquer um.
 *
 * Secrets extras via env `META_APP_SECRET_EXTRA` (separados por vírgula) —
 * sem env setada, comportamento idêntico ao anterior (só o secret do Admin).
 */
async function getAppSecretsAceitos(): Promise<string[]> {
  const { appSecret } = await getMetaConfig();
  const extras = (process.env.META_APP_SECRET_EXTRA || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([appSecret, ...extras].filter(Boolean))];
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
 * Busca os canais de uma WABA (por wabaId). Diferente do roteamento de mensagem
 * (estrito por phone_number_id), eventos de CONTA (account_update, quality) são
 * WABA-scoped e devem afetar todo canal daquela WABA neste JuridFlow.
 */
async function findCanaisByWabaId(wabaId: string): Promise<CanalInfo[]> {
  const db = await getDb();
  if (!db || !wabaId) return [];
  const out: CanalInfo[] = [];
  try {
    const canais = await db.select().from(canaisIntegrados)
      .where(eq(canaisIntegrados.tipo, "whatsapp_api"));
    for (const canal of canais) {
      if (!canal.configEncrypted || !canal.configIv || !canal.configTag) continue;
      try {
        const config = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
        if (config.wabaId === wabaId) {
          out.push({
            canalId: canal.id,
            escritorioId: canal.escritorioId,
            accessToken: typeof config.accessToken === "string" ? config.accessToken : "",
          });
        }
      } catch { continue; }
    }
  } catch {}
  return out;
}

/**
 * Detecta se um evento `account_update` indica restrição/desativação da conta
 * (não só um update informativo). Cobre os eventos que precedem/são o ban:
 * DISABLED_UPDATE, ACCOUNT_RESTRICTION, ACCOUNT_VIOLATION, etc. Monta um motivo
 * legível a partir de ban_info/restriction_info/violation_info quando presentes.
 */
export function detectarRestricaoConta(value: any): { restritivo: boolean; motivo: string } {
  const event = String(value?.event || "").toUpperCase();
  const restritivo = /DISABLE|RESTRICT|VIOLAT|BAN/.test(event);
  if (!restritivo) return { restritivo: false, motivo: "" };
  const partes: string[] = [event];
  const restr = Array.isArray(value?.restriction_info) ? value.restriction_info : [];
  for (const r of restr) if (r?.restriction_type) partes.push(String(r.restriction_type));
  if (value?.violation_info?.violation_type) partes.push(String(value.violation_info.violation_type));
  if (value?.ban_info?.ban_state) partes.push(String(value.ban_info.ban_state));
  return { restritivo: true, motivo: partes.join(" · ").slice(0, 500) };
}

/**
 * Resolve o canal de uma mensagem recebida ESTRITAMENTE pelo phone_number_id.
 *
 * Sem fallback por wabaId de propósito: vários números podem dividir a MESMA
 * WABA e só alguns estarem conectados neste JuridFlow (ex.: o cliente usa um dos
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

export interface MensagemCloudParseada {
  conteudo: string;
  tipo: WhatsappMensagemRecebida["tipo"];
  mediaId: string;
  nomeOriginalArquivo: string | undefined;
  interactiveReply: { tipo: "button" | "list"; id: string; titulo: string } | undefined;
}

/**
 * Traduz o `message` cru do webhook Cloud API em {conteudo, tipo, mediaId, ...}.
 * Isolado do handler Express de propósito, pra ser testável. `telefone` entra só
 * pro log do evento `system` (ex: troca de número) — que NÃO é mensagem do
 * cliente e por isso vira tipo "sistema" (o handler não dispara bot pra ele).
 */
export function parseMensagemCloud(message: any, telefone: string): MensagemCloudParseada {
  let tipo: WhatsappMensagemRecebida["tipo"] = "texto";
  let conteudo = "";
  let mediaId = "";
  let nomeOriginalArquivo: string | undefined;
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
      // Conteúdo persistido = título do que foi clicado, pra UI do inbox mostrar
      // de forma humana o que o cliente escolheu (ex: "📅 Quero agendar").
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
    case "system": {
      // Evento do WhatsApp, NÃO mensagem do cliente. O caso comum é troca de
      // número: a Meta manda o número novo em system.new_wa_id/wa_id. Antes caía
      // no default e virava um cru "[system]" tratado como texto — o bot respondia
      // o evento e, como o número velho já estava morto, martelava 131026. Marcar
      // como tipo "sistema" tira do fluxo (textoFluxo fica "") e mostra legível.
      const sys = (message as any).system || {};
      const novoNumero = String(sys.new_wa_id || sys.wa_id || "").replace(/\D/g, "");
      conteudo = novoNumero
        ? `📱 Cliente mudou o número do WhatsApp (novo: ${formatPhone(novoNumero)})`
        : sys.body
          ? `📱 ${sys.body}`
          : "📱 Evento do sistema WhatsApp";
      tipo = "sistema";
      log.info(
        `[WhatsApp Cloud] Evento system de ${telefone}: type=${sys.type || "?"} novoNumero=${novoNumero || "-"} body="${sys.body || ""}"`,
      );
      break;
    }
    default:
      conteudo = `[${message.type}]`;
      tipo = "texto";
  }

  return { conteudo, tipo, mediaId, nomeOriginalArquivo, interactiveReply };
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
    const appSecrets = await getAppSecretsAceitos();
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const sigHeader = req.header("X-Hub-Signature-256");
    const verif = verificarAssinaturaMeta(rawBody, sigHeader, appSecrets);

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

      // Log de CHEGADA incondicional — 1 linha por POST, com o resumo do
      // evento. Sem isso, evento processado em silêncio e evento que nunca
      // chegou são indistinguíveis no log ("não sincroniza" vira caça às
      // cegas entre Meta e app — incidente do canal Bruno Boyadjian).
      const resumoEvento = (body.entry || []).flatMap((e: any) =>
        (e.changes || []).map((c: any) => ({
          waba: e.id,
          campo: c.field,
          phoneNumberId: c.value?.metadata?.phone_number_id,
          msgs: Array.isArray(c.value?.messages) ? c.value.messages.length : 0,
          statuses: Array.isArray(c.value?.statuses) ? c.value.statuses.length : 0,
        })),
      );
      log.info({ eventos: resumoEvento }, "[WhatsApp Cloud] webhook recebido");

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

          // Restrição/desativação da conta (nível WABA) — o evento que faltava:
          // antes o app só sabia de restrição quando um template individual
          // falhava com 131031. Agora, quando a Meta desativa/restringe a conta,
          // tripa o disjuntor de TODO canal da WABA e some da UI o "tudo certo".
          if (change.field === "account_update") {
            try {
              const { restritivo, motivo } = detectarRestricaoConta(change.value);
              if (restritivo) {
                const db = await getDb();
                const canais = await findCanaisByWabaId(wabaId);
                if (db && canais.length > 0) {
                  const guard = await import("./whatsapp-envio-guard");
                  for (const c of canais) {
                    await guard.marcarCanalRestrito(db, c.canalId, `Conta Meta: ${motivo}`);
                    await db.update(canaisIntegrados)
                      .set({ status: "banido", mensagemErro: `Conta restrita/desativada pela Meta: ${motivo}`.slice(0, 500) })
                      .where(eq(canaisIntegrados.id, c.canalId));
                  }
                  log.warn({ wabaId, motivo, canais: canais.length }, "[WhatsApp Cloud] conta restrita/desativada pela Meta — canais pausados");
                }
              }
            } catch (accErr: any) {
              log.error("[WhatsApp Cloud] Erro ao processar account_update:", accErr.message);
            }
            continue;
          }

          // Qualidade/tier do número — persiste pra UI e pro teto diário anti-ban.
          if (change.field === "phone_number_quality_update") {
            try {
              const db = await getDb();
              const canais = await findCanaisByWabaId(wabaId);
              const evento = String(change.value?.event || "").toUpperCase();
              const tier = change.value?.current_limit ? String(change.value.current_limit) : undefined;
              const qualidade = evento === "FLAGGED" ? "RED" : evento === "UNFLAGGED" ? "GREEN" : undefined;
              if (db && canais.length > 0 && (tier || qualidade)) {
                for (const c of canais) {
                  const [atual] = await db
                    .select({ q: canaisIntegrados.qualidadeMeta, t: canaisIntegrados.tierMensagens })
                    .from(canaisIntegrados)
                    .where(eq(canaisIntegrados.id, c.canalId))
                    .limit(1);
                  await db.update(canaisIntegrados)
                    .set({
                      ...(tier ? { tierMensagens: tier } : {}),
                      ...(qualidade ? { qualidadeMeta: qualidade } : {}),
                    })
                    .where(eq(canaisIntegrados.id, c.canalId));
                  // FLAGGED/tier rebaixado tem que chegar no dono na hora —
                  // é o último aviso útil antes de uma restrição.
                  try {
                    const { avaliarTransicaoSaude, notificarSaudeCanal } = await import("./whatsapp-alertas");
                    const alertas = avaliarTransicaoSaude({
                      qualidadeAnterior: atual?.q ?? null,
                      qualidadeNova: qualidade ?? atual?.q ?? null,
                      tierAnterior: atual?.t ?? null,
                      tierNovo: tier ?? atual?.t ?? null,
                    });
                    for (const a of alertas) {
                      await notificarSaudeCanal({ canalId: c.canalId, titulo: a.titulo, mensagem: a.mensagem });
                    }
                  } catch { /* best-effort */ }
                }
                log.info({ wabaId, evento, tier }, "[WhatsApp Cloud] qualidade/tier do número atualizado");
              }
            } catch (qErr: any) {
              log.error("[WhatsApp Cloud] Erro ao processar phone_number_quality_update:", qErr.message);
            }
            continue;
          }

          // Template pausado/desativado/rejeitado pela Meta: sem este aviso o
          // cenário que usa o template quebra em silêncio (erro 132015 síncrono
          // na execução, sem push) e, na 3ª pausa, a Meta DESATIVA o template
          // permanentemente. NÃO tripa disjuntor — é problema de 1 template,
          // não da conta.
          if (change.field === "message_template_status_update") {
            try {
              const evento = String(change.value?.event || "").toUpperCase();
              if (["PAUSED", "DISABLED", "REJECTED", "FLAGGED"].includes(evento)) {
                const nome =
                  change.value?.message_template_name || change.value?.template_name || "template";
                const motivo =
                  change.value?.reason ||
                  change.value?.other_info?.description ||
                  change.value?.disable_info?.disable_date ||
                  "";
                const canais = await findCanaisByWabaId(wabaId);
                const { notificarSaudeCanal } = await import("./whatsapp-alertas");
                const titulo =
                  evento === "DISABLED"
                    ? `🚫 Template "${nome}" DESATIVADO pela Meta`
                    : evento === "REJECTED"
                      ? `❌ Template "${nome}" rejeitado pela Meta`
                      : `⏸️ Template "${nome}" pausado pela Meta`;
                const mensagem =
                  evento === "DISABLED"
                    ? `A Meta desativou o template permanentemente (3ª pausa por qualidade). Cenários que o usam pararam de enviar — crie um template novo com conteúdo revisado.${motivo ? ` Detalhe: ${String(motivo).slice(0, 200)}` : ""}`
                    : `Cenários que usam este template vão falhar até ele ser liberado. Revise o conteúdo (a pausa vem de feedback negativo dos destinatários) — na 3ª pausa a Meta desativa em definitivo.${motivo ? ` Detalhe: ${String(motivo).slice(0, 200)}` : ""}`;
                for (const c of canais) {
                  await notificarSaudeCanal({ canalId: c.canalId, titulo, mensagem });
                }
                log.warn({ wabaId, evento, template: nome }, "[WhatsApp Cloud] status de template mudou — dono notificado");
              }
            } catch (tErr: any) {
              log.error("[WhatsApp Cloud] Erro ao processar message_template_status_update:", tErr.message);
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
              "[WhatsApp Cloud] Mensagem de número não conectado neste JuridFlow — ignorada",
            );
            continue;
          }

          // Processar mensagens recebidas
          for (const message of value.messages || []) {
            try {
              const contact = (value.contacts || []).find((c: any) => c.wa_id === message.from);
              const telefone = formatPhone(message.from);
              const nome = contact?.profile?.name || telefone;

              // Parsing isolado em parseMensagemCloud (testável). mediaUrl fica
              // aqui porque é preenchido só depois, pelo download da mídia.
              const { conteudo, tipo, mediaId, nomeOriginalArquivo, interactiveReply } =
                parseMensagemCloud(message, telefone);
              let mediaUrl = "";

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
                // `failed`: captura o motivo real da Meta (`errors[]`) — antes
                // era descartado, deixando o operador sem saber POR QUE a
                // mensagem não chegou (um template ficava "executado" mentindo).
                // Nos demais status limpamos o campo (auto-cura: reenvio que
                // passou volta a ficar "ok").
                const erroEntrega = newStatus === "falha" ? extrairMotivoFalhaEntrega(status) : null;
                await db.update(mensagens)
                  .set({ status: newStatus as any, erroEntrega })
                  .where(eq(mensagens.idExterno, status.id));
                // Disjuntor: se a Meta reportou restrição/spam (131031 e afins)
                // no webhook `failed`, PAUSA os templates deste canal — é por
                // aqui que o 131031 assíncrono chega. Sem isso o sistema seguia
                // martelando a Meta e agravando a reputação.
                if (erroEntrega) {
                  const guard = await import("./whatsapp-envio-guard");
                  await guard
                    .registrarFalhaTemplate({ db, canalId: canalInfo.canalId, erro: erroEntrega })
                    .catch(() => {});
                }
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
