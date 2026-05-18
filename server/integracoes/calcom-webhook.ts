/**
 * Webhook Cal.com — Recebe notificações de bookings
 * Etapa 2: Cria agendamentos no sistema quando booking é criado no Cal.com
 *
 * Segurança: valida o header `X-Cal-Signature-256` (HMAC SHA-256 do body
 * raw com o `webhookSecret` configurado no canal do escritório). Detalhes
 * em `./calcom-signature.ts`. Sem essa validação, qualquer pessoa poderia
 * forjar BOOKING_CREATED e disparar SmartFlow do escritório
 * (cobranças, leads, mensagens automáticas).
 *
 * Política de transição (legado → seguro):
 *  - Canais que JÁ definiram `webhookSecret` → header obrigatório.
 *  - Canais ainda sem secret cadastrado → aceita, loga warn pedindo
 *    pra cadastrar no painel. Quando cadastrado, validação passa
 *    a ser obrigatória.
 */

import type { Express, Request, Response } from "express";
import type { CalcomWebhookPayload } from "../../shared/calcom-types";
import { createLogger } from "../_core/logger";
import { verificarAssinaturaCalcom } from "./calcom-signature";
const log = createLogger("integracoes-calcom-webhook");

export function registerCalcomWebhook(app: Express) {
  app.post("/api/webhooks/calcom", async (req: Request, res: Response) => {
    try {
      const payload = req.body as CalcomWebhookPayload;

      if (!payload || !payload.triggerEvent) {
        return res.status(400).json({ error: "Payload inválido" });
      }

      // Resolve escritório ANTES de validar HMAC — precisa do email do
      // organizador pra buscar o canal certo e o secret correspondente.
      const organizerEmail = payload.payload?.organizer?.email;
      const canalInfo = await resolverCanalPorOrganizador(organizerEmail);
      if (!canalInfo) {
        // Sem canal correspondente: nada a disparar. Não é erro — Cal.com
        // pode enviar evento de booking que não pertence a nenhum
        // escritório do Jurify (multi-tenant, conta em outro app, etc).
        log.debug(
          { organizerEmail, evento: payload.triggerEvent },
          "[Cal.com Webhook] Booking sem canal correspondente — ignorando",
        );
        return res.status(200).json({ received: true, processed: false });
      }

      // Valida HMAC contra o secret do canal específico. Body raw foi
      // capturado em `req.rawBody` pelo middleware verify do express.json
      // (server/_core/index.ts).
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      const sigHeader = req.header("X-Cal-Signature-256");
      const verif = verificarAssinaturaCalcom(
        rawBody,
        sigHeader,
        canalInfo.webhookSecret,
      );

      if (!verif.ok) {
        log.warn(
          {
            canalId: canalInfo.canalId,
            escritorioId: canalInfo.escritorioId,
            mode: verif.mode,
            motivo: verif.motivo,
            evento: payload.triggerEvent,
          },
          "[Cal.com Webhook] Assinatura HMAC inválida — request rejeitada",
        );
        return res.status(401).json({
          error: "Assinatura inválida",
          mode: verif.mode,
        });
      }
      if (verif.mode === "no-secret") {
        log.warn(
          {
            canalId: canalInfo.canalId,
            escritorioId: canalInfo.escritorioId,
            evento: payload.triggerEvent,
          },
          "[Cal.com Webhook] Canal sem webhookSecret configurado — cadastre o segredo do webhook no painel Cal.com (Settings → Webhooks → Webhook Secret) e salve em Integrações pra ativar validação HMAC",
        );
      }

      log.info(
        {
          mode: verif.mode,
          evento: payload.triggerEvent,
          bookingUid: payload.payload?.uid,
          escritorioId: canalInfo.escritorioId,
        },
        `[Cal.com Webhook] Processando ${payload.triggerEvent}`,
      );

      switch (payload.triggerEvent) {
        case "BOOKING_CREATED":
          await handleBookingCreated(payload, canalInfo.escritorioId);
          break;
        case "BOOKING_CANCELLED":
          await handleBookingCancelled(payload, canalInfo.escritorioId);
          break;
        case "BOOKING_RESCHEDULED":
          await handleBookingRescheduled(payload, canalInfo.escritorioId);
          break;
        case "BOOKING_COMPLETED":
          // Marcar agendamento como concluído se existir
          log.info(`[Cal.com Webhook] Booking completado: ${payload.payload?.uid}`);
          break;
        default:
          log.info(`[Cal.com Webhook] Evento não tratado: ${payload.triggerEvent}`);
      }

      return res.status(200).json({ received: true });
    } catch (err: any) {
      log.error("[Cal.com Webhook] Erro:", err.message);
      return res.status(500).json({ error: "Erro interno" });
    }
  });

  log.info("[Cal.com Webhook] Registrado em POST /api/webhooks/calcom");
}

// ─── Resolução de canal ──────────────────────────────────────────────────────

interface CanalCalcomResolved {
  canalId: number;
  escritorioId: number;
  webhookSecret?: string;
}

/**
 * Mapeia o email do organizador do Cal.com para o canal integrado
 * correspondente, retornando também o `webhookSecret` configurado (se
 * houver) pra validação HMAC. Retorna null se não encontrar.
 *
 * Exportada para teste em
 * `server/__tests__/calcom-signature.test.ts`.
 */
export async function resolverCanalPorOrganizador(
  email?: string,
): Promise<CanalCalcomResolved | null> {
  if (!email) return null;
  try {
    const { getDb } = await import("../db");
    const { canaisIntegrados } = await import("../../drizzle/schema");
    const { eq, and, or: orOp, like } = await import("drizzle-orm");
    const { decryptConfig } = await import("../escritorio/crypto-utils");
    const db = await getDb();
    if (!db) return null;

    const canais = await db
      .select()
      .from(canaisIntegrados)
      .where(
        and(
          orOp(
            eq(canaisIntegrados.tipo, "calcom"),
            like(canaisIntegrados.nome, "%Cal.com%"),
          ),
        ),
      );

    for (const canal of canais) {
      if (!canal.configEncrypted || !canal.configIv || !canal.configTag) continue;
      try {
        const cfg = decryptConfig(
          canal.configEncrypted,
          canal.configIv,
          canal.configTag,
        );
        const emailCanal = String(
          cfg?.email || cfg?.organizerEmail || "",
        ).toLowerCase();
        if (emailCanal && emailCanal === email.toLowerCase()) {
          return {
            canalId: canal.id,
            escritorioId: canal.escritorioId,
            webhookSecret:
              typeof cfg?.webhookSecret === "string" && cfg.webhookSecret
                ? cfg.webhookSecret
                : undefined,
          };
        }
      } catch {
        /* config corrupta, pula */
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleBookingCreated(
  payload: CalcomWebhookPayload,
  escritorioId: number,
) {
  const { id, uid, title, startTime, endTime, attendees, organizer } = payload.payload;

  log.info(`[Cal.com] Novo booking: "${title}" em ${startTime}`);
  log.info(`[Cal.com]   Organizador: ${organizer?.name} (${organizer?.email})`);
  if (attendees?.length) {
    log.info(`[Cal.com]   Participante: ${attendees[0].name} (${attendees[0].email})`);
  }

  try {
    const { dispararAgendamentoCriado } = await import("../smartflow/dispatcher");
    await dispararAgendamentoCriado(escritorioId, {
      bookingId: uid || id,
      titulo: title,
      startTime,
      endTime,
      participanteNome: attendees?.[0]?.name,
      participanteEmail: attendees?.[0]?.email,
      organizadorEmail: organizer?.email,
    });
  } catch (e: any) {
    log.warn({ err: e.message }, "[SmartFlow] Falha ao disparar agendamento_criado");
  }
}

async function handleBookingCancelled(
  payload: CalcomWebhookPayload,
  escritorioId: number,
) {
  const { id, uid, title, startTime, endTime, attendees, organizer } = payload.payload;
  const motivo = (payload.payload as any).cancellationReason as string | undefined;
  log.info(`[Cal.com] Booking cancelado: "${title}" (${uid})`);

  try {
    const { dispararAgendamentoCancelado } = await import("../smartflow/dispatcher");
    await dispararAgendamentoCancelado(escritorioId, {
      bookingId: uid || id,
      titulo: title,
      startTime,
      endTime,
      participanteNome: attendees?.[0]?.name,
      participanteEmail: attendees?.[0]?.email,
      organizadorEmail: organizer?.email,
      motivo,
    });
  } catch (e: any) {
    log.warn({ err: e.message }, "[SmartFlow] Falha ao disparar agendamento_cancelado");
  }
}

async function handleBookingRescheduled(
  payload: CalcomWebhookPayload,
  escritorioId: number,
) {
  const { id, uid, title, startTime, endTime, attendees, organizer } = payload.payload;
  // Cal.com inclui `rescheduleStartTime` no payload antigo; nomes variam entre
  // versões, buscamos os dois shapes mais comuns.
  const startAntigo =
    (payload.payload as any).rescheduleStartTime ||
    (payload.payload as any).previousStartTime ||
    undefined;
  log.info(`[Cal.com] Booking reagendado: "${title}" → ${startTime}`);

  try {
    const { dispararAgendamentoRemarcado } = await import("../smartflow/dispatcher");
    await dispararAgendamentoRemarcado(escritorioId, {
      bookingId: uid || id,
      titulo: title,
      startTimeNovo: startTime,
      startTimeAntigo: startAntigo,
      endTimeNovo: endTime,
      participanteNome: attendees?.[0]?.name,
      participanteEmail: attendees?.[0]?.email,
      organizadorEmail: organizer?.email,
    });
  } catch (e: any) {
    log.warn({ err: e.message }, "[SmartFlow] Falha ao disparar agendamento_remarcado");
  }
}
