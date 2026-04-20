/**
 * Webhook Cal.com — Recebe notificações de bookings
 * Etapa 2: Cria agendamentos no sistema quando booking é criado no Cal.com
 */

import type { Express, Request, Response } from "express";
import type { CalcomWebhookPayload } from "../../shared/calcom-types";
import { createLogger } from "../_core/logger";
const log = createLogger("integracoes-calcom-webhook");

export function registerCalcomWebhook(app: Express) {
  app.post("/api/webhooks/calcom", async (req: Request, res: Response) => {
    try {
      const payload = req.body as CalcomWebhookPayload;

      if (!payload || !payload.triggerEvent) {
        return res.status(400).json({ error: "Payload inválido" });
      }

      log.info(`[Cal.com Webhook] Evento: ${payload.triggerEvent} — Booking: ${payload.payload?.uid}`);

      switch (payload.triggerEvent) {
        case "BOOKING_CREATED":
          await handleBookingCreated(payload);
          break;
        case "BOOKING_CANCELLED":
          await handleBookingCancelled(payload);
          break;
        case "BOOKING_RESCHEDULED":
          await handleBookingRescheduled(payload);
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

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleBookingCreated(payload: CalcomWebhookPayload) {
  const { id, uid, title, startTime, endTime, attendees, organizer } = payload.payload;

  log.info(`[Cal.com] Novo booking: "${title}" em ${startTime}`);
  log.info(`[Cal.com]   Organizador: ${organizer?.name} (${organizer?.email})`);
  if (attendees?.length) {
    log.info(`[Cal.com]   Participante: ${attendees[0].name} (${attendees[0].email})`);
  }

  // Dispara cenários SmartFlow com gatilho "agendamento_criado".
  // Resolve escritório via e-mail do organizador (canal Cal.com registrado).
  const escritorioId = await resolverEscritorioPorOrganizador(organizer?.email);
  if (escritorioId) {
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
  } else {
    log.debug(
      { organizadorEmail: organizer?.email },
      "[Cal.com] Booking sem escritório correspondente — SmartFlow não acionado",
    );
  }
}

/**
 * Mapeia o email do organizador do Cal.com para um escritorioId, via canal
 * integrado do tipo "calcom". Retorna null se não encontrar.
 */
async function resolverEscritorioPorOrganizador(email?: string): Promise<number | null> {
  if (!email) return null;
  try {
    const { getDb } = await import("../db");
    const { canaisIntegrados } = await import("../../drizzle/schema");
    const { eq, and, or: orOp, like } = await import("drizzle-orm");
    const { decryptConfig } = await import("../escritorio/crypto-utils");
    const db = await getDb();
    if (!db) return null;

    // Busca canais Cal.com ativos. Decodifica config pra comparar com email
    // do organizador (Cal.com armazena email na config do canal).
    const canais = await db
      .select()
      .from(canaisIntegrados)
      .where(and(
        orOp(eq(canaisIntegrados.tipo, "calcom"), like(canaisIntegrados.nome, "%Cal.com%")),
      ));

    for (const canal of canais) {
      if (!canal.configEncrypted || !canal.configIv || !canal.configTag) continue;
      try {
        const cfg = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
        const emailCanal = String(cfg?.email || cfg?.organizerEmail || "").toLowerCase();
        if (emailCanal && emailCanal === email.toLowerCase()) {
          return canal.escritorioId;
        }
      } catch { /* config corrupta, pula */ }
    }
    return null;
  } catch {
    return null;
  }
}

async function handleBookingCancelled(payload: CalcomWebhookPayload) {
  const { uid, title } = payload.payload;
  log.info(`[Cal.com] Booking cancelado: "${title}" (${uid})`);

  // TODO: Buscar agendamento pelo uid do Cal.com e cancelar
}

async function handleBookingRescheduled(payload: CalcomWebhookPayload) {
  const { uid, title, startTime, endTime } = payload.payload;
  log.info(`[Cal.com] Booking reagendado: "${title}" → ${startTime}`);

  // TODO: Buscar agendamento pelo uid e atualizar data
}
