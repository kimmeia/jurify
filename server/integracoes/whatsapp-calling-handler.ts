/**
 * WhatsApp Business Calling API — processamento dos eventos de chamada do webhook.
 *
 * Chega pelo MESMO webhook da mensageria, em `change.field === "calls"`, com um
 * envelope `value.calls[]`. Aqui a gente roteia pro canal certo (pelo
 * phone_number_id, igual mensagem) e faz upsert no log `chamadas` casando o
 * `terminate` com o `connect` pelo call_id da Meta.
 *
 * Persistência é best-effort: erro num evento não derruba o webhook (que já
 * respondeu 200) nem os outros eventos do mesmo lote.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { chamadas, conversas } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import { resolverCanalDaMensagem } from "./whatsapp-cloud-webhook";
import { buscarContatoPorTelefone } from "../escritorio/db-crm";
import { emitirParaEscritorio, emitirParaAtendente } from "../_core/sse-notifications";
import {
  montarSinalizacaoChamada,
  normalizarEventoChamada,
  type EventoChamadaMeta,
} from "../../shared/whatsapp-calling-types";

const log = createLogger("integracoes-whatsapp-calling");

interface CanalChamada {
  canalId: number;
  escritorioId: number;
}

/**
 * Processa o `value` de uma mudança `field: "calls"` do webhook. Resolve o
 * canal ESTRITAMENTE pelo phone_number_id (mesma regra anti-vazamento da
 * mensageria) e registra cada item de `value.calls[]`.
 */
export async function processarEventoChamada(value: any): Promise<void> {
  const phoneNumberId = value?.metadata?.phone_number_id;
  const canalInfo = await resolverCanalDaMensagem(phoneNumberId);
  if (!canalInfo) {
    log.warn({ phoneNumberId }, "[WA Calling] Evento de número não conectado — ignorado");
    return;
  }

  for (const call of (value?.calls || []) as EventoChamadaMeta[]) {
    try {
      await registrarEventoChamada(canalInfo, call);
    } catch (err: any) {
      log.error("[WA Calling] erro ao registrar evento de chamada:", err?.message);
    }
  }
}

/** Upsert de um evento no log `chamadas`, ligando contato/conversa best-effort. */
async function registrarEventoChamada(canalInfo: CanalChamada, call: EventoChamadaMeta): Promise<void> {
  const ev = normalizarEventoChamada(call);
  if (!ev.callId) return;

  const db = await getDb();
  if (!db) return;

  // Resolve contato pelo telefone (variantes BR) e a conversa mais recente
  // dele — pra chamada aparecer na timeline. Ausência não é erro: chamada de
  // número desconhecido ainda é logada (sem vínculo).
  let contatoId: number | null = null;
  let contatoNome: string | null = null;
  let conversaId: number | null = null;
  let conversaAtendenteId: number | null = null;
  if (ev.telefone) {
    const contato = await buscarContatoPorTelefone(canalInfo.escritorioId, ev.telefone);
    if (contato) {
      contatoId = contato.id;
      contatoNome = contato.nome;
      const [conv] = await db
        .select({ id: conversas.id, atendenteId: conversas.atendenteId })
        .from(conversas)
        .where(
          and(eq(conversas.escritorioId, canalInfo.escritorioId), eq(conversas.contatoId, contato.id)),
        )
        .orderBy(desc(conversas.updatedAt))
        .limit(1);
      conversaId = conv?.id ?? null;
      conversaAtendenteId = conv?.atendenteId ?? null;
    }
  }

  const [existente] = await db
    .select()
    .from(chamadas)
    .where(eq(chamadas.callIdExterno, ev.callId))
    .limit(1);

  if (!existente) {
    await db.insert(chamadas).values({
      escritorioId: canalInfo.escritorioId,
      canalId: canalInfo.canalId,
      contatoId,
      conversaId,
      callIdExterno: ev.callId,
      direcao: ev.direcao,
      status: ev.status,
      telefone: ev.telefone || null,
      duracaoSegundos: ev.duracaoSegundos,
      bizOpaqueCallbackData: ev.bizOpaqueCallbackData,
      encerradaEm: ev.evento === "terminate" ? new Date() : null,
    });
    log.info(
      { callId: ev.callId, evento: ev.evento, direcao: ev.direcao, status: ev.status },
      "[WA Calling] chamada registrada",
    );
  } else {
    // Já existe (ex.: connect inserido antes, agora chegou o terminate).
    // Atualiza status/duração e preenche vínculos que faltavam, sem sobrescrever
    // os já resolvidos por um comando do atendente (accept seta atendenteId).
    const patch: Record<string, unknown> = { status: ev.status };
    if (ev.duracaoSegundos != null) patch.duracaoSegundos = ev.duracaoSegundos;
    if (ev.bizOpaqueCallbackData && !existente.bizOpaqueCallbackData) {
      patch.bizOpaqueCallbackData = ev.bizOpaqueCallbackData;
    }
    if (contatoId && !existente.contatoId) patch.contatoId = contatoId;
    if (conversaId && !existente.conversaId) patch.conversaId = conversaId;
    if (ev.evento === "terminate" && !existente.encerradaEm) patch.encerradaEm = new Date();

    await db.update(chamadas).set(patch).where(eq(chamadas.id, existente.id));
    log.info({ callId: ev.callId, evento: ev.evento, status: ev.status }, "[WA Calling] chamada atualizada");
  }

  // Empurra o evento pro navegador do atendente (toca a chamada, repassa o SDP
  // answer da Meta, ou avisa o encerramento). Silencioso no sino de notificações
  // — a UI de chamada é quem reage. Best-effort: falha aqui não afeta o log.
  const sinal = montarSinalizacaoChamada(ev, { contatoId, contatoNome, conversaId });
  if (sinal) {
    // Toca só pro atendente certo: o da chamada (saída/iniciador ou quem
    // atendeu) ou, na entrada ainda não atendida, o responsável da conversa.
    // Sem responsável definido, cai pro escritório todo (senão ninguém atende).
    const alvoAtendente = existente?.atendenteId ?? conversaAtendenteId;
    if (alvoAtendente) {
      await emitirParaAtendente(alvoAtendente, sinal);
    } else {
      await emitirParaEscritorio(canalInfo.escritorioId, sinal);
    }
  }
}
