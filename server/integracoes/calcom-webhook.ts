/**
 * Webhook Cal.com — Recebe notificações de bookings
 * Etapa 2: Cria agendamentos no sistema quando booking é criado no Cal.com
 */

import type { Express, Request, Response } from "express";
import type { CalcomWebhookPayload } from "../../shared/calcom-types";

export function registerCalcomWebhook(app: Express) {
  app.post("/api/webhooks/calcom", async (req: Request, res: Response) => {
    try {
      const payload = req.body as CalcomWebhookPayload;

      if (!payload || !payload.triggerEvent) {
        return res.status(400).json({ error: "Payload inválido" });
      }

      console.log(`[Cal.com Webhook] Evento: ${payload.triggerEvent} — Booking: ${payload.payload?.uid}`);

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
          console.log(`[Cal.com Webhook] Booking completado: ${payload.payload?.uid}`);
          break;
        default:
          console.log(`[Cal.com Webhook] Evento não tratado: ${payload.triggerEvent}`);
      }

      return res.status(200).json({ received: true });
    } catch (err: any) {
      console.error("[Cal.com Webhook] Erro:", err.message);
      return res.status(500).json({ error: "Erro interno" });
    }
  });

  console.log("[Cal.com Webhook] Registrado em POST /api/webhooks/calcom");
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleBookingCreated(payload: CalcomWebhookPayload) {
  const { id, uid, title, startTime, endTime, attendees, organizer } = payload.payload;

  console.log(`[Cal.com] Novo booking: "${title}" em ${startTime}`);
  console.log(`[Cal.com]   Organizador: ${organizer?.name} (${organizer?.email})`);
  if (attendees?.length) {
    console.log(`[Cal.com]   Participante: ${attendees[0].name} (${attendees[0].email})`);
  }

  // TODO: Quando o escritorioId estiver no metadata do booking,
  // criar automaticamente um agendamento no sistema:
  //
  // const escritorioId = payload.payload.metadata?.escritorioId;
  // if (escritorioId) {
  //   await criarAgendamento({
  //     escritorioId,
  //     criadoPorId: ..., // colaborador que configurou Cal.com
  //     responsavelId: ...,
  //     tipo: "reuniao_comercial",
  //     titulo: title,
  //     dataInicio: startTime,
  //     dataFim: endTime,
  //     descricao: `Booking Cal.com: ${uid}\nParticipante: ${attendees?.[0]?.name} (${attendees?.[0]?.email})`,
  //   });
  // }
}

async function handleBookingCancelled(payload: CalcomWebhookPayload) {
  const { uid, title } = payload.payload;
  console.log(`[Cal.com] Booking cancelado: "${title}" (${uid})`);

  // TODO: Buscar agendamento pelo uid do Cal.com e cancelar
}

async function handleBookingRescheduled(payload: CalcomWebhookPayload) {
  const { uid, title, startTime, endTime } = payload.payload;
  console.log(`[Cal.com] Booking reagendado: "${title}" → ${startTime}`);

  // TODO: Buscar agendamento pelo uid e atualizar data
}
