/**
 * Overflow + presença da fila de chamadas (Fase 2).
 *
 * Presença é EM MEMÓRIA (consistente com o SSE, que também é em-memória):
 * default = disponível, reseta no restart. Single-instance como o resto do SSE.
 *
 * Overflow: ao chegar uma chamada, o responsável toca primeiro. Se em N segundos
 * ninguém atendeu, ela "transborda" — toca (overlay) pros atendentes DISPONÍVEIS
 * (online ∩ presença disponível ∩ não em outra chamada).
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { chamadas, colaboradores } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import { usuariosConectados, emitirParaAtendente } from "../_core/sse-notifications";
import { montarSinalEntrante } from "../../shared/whatsapp-calling-types";

const log = createLogger("integracoes-whatsapp-calling-overflow");

/** Espera o responsável atender antes de transbordar pros disponíveis. */
const OVERFLOW_DELAY_MS = 15_000;

// ─── Presença (em memória) ───────────────────────────────────────────────────
const presenca = new Map<number, boolean>();

export function definirPresenca(colaboradorId: number, disponivel: boolean): void {
  presenca.set(colaboradorId, disponivel);
}
export function estaDisponivel(colaboradorId: number): boolean {
  return presenca.get(colaboradorId) ?? true;
}

// ─── Timers de overflow ──────────────────────────────────────────────────────
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export interface OverflowCtx {
  callId: string;
  escritorioId: number;
  responsavelId: number | null;
  sdpOffer: string;
  contatoId: number | null;
  contatoNome: string | null;
  telefone: string | null;
  conversaId: number | null;
}

/** Agenda o transbordo: sem atendimento em N s → toca pros disponíveis. */
export function agendarOverflow(ctx: OverflowCtx): void {
  cancelarOverflow(ctx.callId);
  const t = setTimeout(() => {
    timers.delete(ctx.callId);
    escalar(ctx).catch((e) => log.warn("[overflow] falha ao escalar:", e?.message));
  }, OVERFLOW_DELAY_MS);
  timers.set(ctx.callId, t);
}

/** Cancela o transbordo (chamada atendida/encerrada/recusada). */
export function cancelarOverflow(callId: string): void {
  const t = timers.get(callId);
  if (t) {
    clearTimeout(t);
    timers.delete(callId);
  }
}

/** Colaboradores DISPONÍVEIS: online (SSE) ∩ presença ∩ não em outra chamada. */
async function resolverDisponiveis(escritorioId: number, excluir: number | null): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const online = usuariosConectados();
  const colabs = await db
    .select({ id: colaboradores.id, userId: colaboradores.userId })
    .from(colaboradores)
    .where(and(eq(colaboradores.escritorioId, escritorioId), eq(colaboradores.ativo, true)));
  const emChamada = await db
    .select({ atendenteId: chamadas.atendenteId })
    .from(chamadas)
    .where(and(eq(chamadas.escritorioId, escritorioId), eq(chamadas.status, "em_andamento")));
  const ocupados = new Set(emChamada.map((c) => c.atendenteId).filter((x): x is number => x != null));

  return colabs
    .filter((c) => c.id !== excluir)
    .filter((c) => online.has(c.userId))
    .filter((c) => estaDisponivel(c.id))
    .filter((c) => !ocupados.has(c.id))
    .map((c) => c.id);
}

/** Toca (overlay) pros disponíveis, se a chamada ainda estiver tocando. */
async function escalar(ctx: OverflowCtx): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const [cham] = await db
    .select({ status: chamadas.status })
    .from(chamadas)
    .where(eq(chamadas.callIdExterno, ctx.callId))
    .limit(1);
  if (!cham || cham.status !== "tocando") return; // já atendida/encerrada

  const disponiveis = await resolverDisponiveis(ctx.escritorioId, ctx.responsavelId);
  if (disponiveis.length === 0) {
    log.info({ callId: ctx.callId }, "[overflow] ninguém disponível pra transbordar");
    return;
  }
  const sinal = montarSinalEntrante(ctx.callId, ctx.sdpOffer, {
    contatoId: ctx.contatoId,
    contatoNome: ctx.contatoNome,
    conversaId: ctx.conversaId,
    telefone: ctx.telefone,
  });
  for (const colabId of disponiveis) {
    await emitirParaAtendente(colabId, sinal);
  }
  log.info(
    { callId: ctx.callId, n: disponiveis.length },
    "[overflow] chamada transbordada pros disponíveis",
  );
}
