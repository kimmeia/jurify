/**
 * SmartFlow Cal.com Lembretes Scheduler — cron de 15min que dispara o
 * gatilho `agendamento_lembrete` antes de bookings Cal.com.
 *
 * Pra cada cenário ativo com esse gatilho, o scheduler:
 *   1. Lista bookings upcoming do escritório via `calcomClient.listarBookings`.
 *   2. Pra cada booking, calcula o momento do lembrete
 *      (`startTime − diasAntes` dias no `horario` configurado).
 *   3. Se o momento cai na janela de 15min do ciclo atual, dispara o
 *      cenário via `dispararAgendamentoLembrete`.
 *
 * Dedupe: 48h por `(cenário, bookingId)` — cada booking recebe 1 lembrete
 * só, mesmo se o scheduler rodar várias vezes dentro da janela de tolerância.
 *
 * Registrado em `_core/cron-jobs.ts` via dynamic import.
 */

import { getDb } from "../db";
import { smartflowCenarios, escritorios } from "../../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { dispararAgendamentoLembrete } from "./dispatcher";
import { deveDispararLembrete } from "./dispatcher-helpers";
import { obterCalcomClient } from "./executores";
import { createLogger } from "../_core/logger";
import type { ConfigGatilhoAgendamentoLembrete } from "../../shared/smartflow-types";
import { FUSO_HORARIO_PADRAO } from "../../shared/escritorio-types";

const log = createLogger("smartflow-calcom-lembretes-scheduler");

const INTERVALO_MS = 15 * 60 * 1000;
const TOLERANCIA_MIN = 15;

let intervalo: ReturnType<typeof setInterval> | null = null;

interface CenarioLembrete {
  id: number;
  escritorioId: number;
  configGatilho: ConfigGatilhoAgendamentoLembrete;
}

async function carregarCenarios(): Promise<CenarioLembrete[]> {
  const db = await getDb();
  if (!db) return [];
  const linhas = await db
    .select()
    .from(smartflowCenarios)
    .where(
      and(
        eq(smartflowCenarios.ativo, true),
        eq(smartflowCenarios.gatilho, "agendamento_lembrete"),
      ),
    );
  return linhas.map((l) => {
    let cfg: ConfigGatilhoAgendamentoLembrete = {};
    if (l.configGatilho) {
      try {
        const parsed = JSON.parse(l.configGatilho);
        if (parsed && typeof parsed === "object") cfg = parsed;
      } catch {
        /* ignore */
      }
    }
    return { id: l.id, escritorioId: l.escritorioId, configGatilho: cfg };
  });
}

export async function rodarCicloCalcomLembretes(): Promise<{ disparados: number }> {
  const db = await getDb();
  if (!db) return { disparados: 0 };

  try {
    const cenarios = await carregarCenarios();
    if (cenarios.length === 0) return { disparados: 0 };

    const agora = new Date();
    let disparados = 0;

    // Agrupa por escritorio pra chamar o Cal.com 1 vez por escritório.
    const porEscritorio = new Map<number, CenarioLembrete[]>();
    for (const c of cenarios) {
      const list = porEscritorio.get(c.escritorioId) ?? [];
      list.push(c);
      porEscritorio.set(c.escritorioId, list);
    }

    // Fuso de cada escritório — o horário do lembrete ("18:00") só faz
    // sentido no TZ local do escritório. Em deploy UTC a diferença é
    // drástica (3h para Brasília).
    const fusoPorEscritorio = new Map<number, string>();
    const rowsFuso = await db
      .select({ id: escritorios.id, fusoHorario: escritorios.fusoHorario })
      .from(escritorios)
      .where(inArray(escritorios.id, Array.from(porEscritorio.keys())));
    for (const r of rowsFuso) fusoPorEscritorio.set(r.id, r.fusoHorario || FUSO_HORARIO_PADRAO);

    for (const [escritorioId, cenariosDoEscritorio] of porEscritorio) {
      const client = await obterCalcomClient(escritorioId);
      if (!client) continue;
      const tz = fusoPorEscritorio.get(escritorioId) || FUSO_HORARIO_PADRAO;

      // Pega janela suficiente pra cobrir o maior `diasAntes` configurado.
      const maxDiasAntes = cenariosDoEscritorio.reduce(
        (m, c) => Math.max(m, Math.floor(Number(c.configGatilho.diasAntes ?? 1))),
        1,
      );

      let bookings;
      try {
        bookings = await client.listarBookings({ status: "upcoming" });
      } catch (err: any) {
        log.warn({ err: err.message, escritorioId }, "[Lembretes] Falha ao listar bookings");
        continue;
      }

      for (const b of bookings) {
        if (!b.startTime) continue;
        const startTime = new Date(b.startTime);
        if (Number.isNaN(startTime.getTime())) continue;

        // Filtro inicial: booking longe demais, não vale iterar cenários.
        const diffMs = startTime.getTime() - agora.getTime();
        if (diffMs < 0) continue; // já passou
        if (diffMs > (maxDiasAntes + 1) * 24 * 60 * 60 * 1000) continue;

        for (const cen of cenariosDoEscritorio) {
          if (!deveDispararLembrete(startTime, cen.configGatilho, agora, TOLERANCIA_MIN, tz)) continue;

          const r = await dispararAgendamentoLembrete(escritorioId, {
            bookingId: b.id,
            titulo: b.title,
            startTime: b.startTime,
            endTime: b.endTime,
            participanteNome: b.attendees?.[0]?.name,
            participanteEmail: b.attendees?.[0]?.email,
          });
          if (r.executou) disparados++;
        }
      }
    }

    if (disparados > 0) {
      log.info({ disparados }, "[Lembretes] Ciclo concluído");
    }
    return { disparados };
  } catch (err: any) {
    log.error({ err: err.message }, "[Lembretes] Erro no ciclo");
    return { disparados: 0 };
  }
}

export function iniciarCalcomLembretesScheduler() {
  if (intervalo) return;
  log.info({ intervaloMs: INTERVALO_MS }, "[Lembretes] Scheduler SmartFlow iniciado");
  setTimeout(() => rodarCicloCalcomLembretes().catch(() => {}), 3 * 60_000);
  intervalo = setInterval(() => rodarCicloCalcomLembretes().catch(() => {}), INTERVALO_MS);
}

export function pararCalcomLembretesScheduler() {
  if (!intervalo) return;
  clearInterval(intervalo);
  intervalo = null;
}
