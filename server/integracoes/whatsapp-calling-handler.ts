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
import { chamadas, conversas, mensagens, contatos, colaboradores, users } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import { resolverCanalDaMensagem } from "./whatsapp-cloud-webhook";
import {
  buscarContatoPorTelefone,
  criarConversa,
  criarOuReutilizarContato,
  distribuirLead,
} from "../escritorio/db-crm";
import { obterConfigCanal } from "../escritorio/db-canais";
import { WhatsAppCloudClient } from "./whatsapp-cloud";
import { emitirParaEscritorio, emitirParaAtendente } from "../_core/sse-notifications";
import { agendarOverflow, cancelarOverflow } from "./whatsapp-calling-overflow";
import { obterConfigChamada } from "./whatsapp-calling-config";
import {
  descreverLigacao,
  montarSinalizacaoChamada,
  montarSinalFila,
  normalizarEventoChamada,
  type EventoChamadaMeta,
  type EventoChamadaNormalizado,
} from "../../shared/whatsapp-calling-types";

/** Mensagem automática enviada quando uma chamada recebida é perdida. */
const TEXTO_PERDIDA =
  "Olá! Vimos que você tentou nos ligar e não conseguimos atender. Já vamos te retornar. Se preferir, pode escrever sua dúvida por aqui. 🙏";

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

  // Chamada recebida nova = interação real: garante conversa, atribui atendente
  // (mesma distribuição da mensagem) e abre no Inbox com ícone de ligação — sem
  // isso, ligação direta nunca ganhava responsável (não passa pelo SmartFlow).
  if (ev.evento === "connect" && ev.direcao === "entrada" && !existente) {
    const r = await garantirConversaEAtribuir(canalInfo, ev.telefone, {
      contatoId,
      contatoNome,
      conversaId,
      conversaAtendenteId,
    });
    contatoId = r.contatoId;
    contatoNome = r.contatoNome;
    conversaId = r.conversaId;
    conversaAtendenteId = r.conversaAtendenteId;
  }

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

  // Cartão de ligação na conversa (timeline). Entrada nova (connect) cria o
  // cartão "em andamento"; o terminate finaliza com resultado + duração (de
  // qualquer direção). Saída só ganha cartão no terminate — ao vivo, quem
  // mostra é o overlay.
  if ((ev.evento === "connect" && ev.direcao === "entrada") || ev.evento === "terminate") {
    const conversaCartao = existente?.conversaId ?? conversaId;
    const atendenteId = existente?.atendenteId ?? conversaAtendenteId;
    await upsertCartaoLigacao(conversaCartao, ev, await nomeAtendente(atendenteId));
  }

  // Empurra o evento pro navegador do atendente (toca a chamada, repassa o SDP
  // answer da Meta, ou avisa o encerramento). Silencioso no sino de notificações
  // — a UI de chamada é quem reage. Best-effort: falha aqui não afeta o log.
  const sinal = montarSinalizacaoChamada(ev, { contatoId, contatoNome, conversaId });
  if (sinal) {
    const alvoAtendente = existente?.atendenteId ?? conversaAtendenteId;
    if (alvoAtendente) {
      // Toca só pro atendente certo: o da chamada (saída/iniciador ou quem
      // atendeu) ou, na entrada ainda não atendida, o responsável da conversa.
      await emitirParaAtendente(alvoAtendente, sinal);
    } else if (sinal.tipo !== "chamada_entrante") {
      // resposta/encerrada sem atendente resolvido → escritório (raro).
      await emitirParaEscritorio(canalInfo.escritorioId, sinal);
    }
    // Chamada recebida SEM responsável não dá overlay pra todos — vai só pra
    // fila do escritório (abaixo), pra alguém assumir.
  }

  // ── Fila / transbordo ─────────────────────────────────────────────────────
  const ctxFila = {
    contatoId,
    contatoNome,
    telefone: ev.telefone || null,
    conversaId,
    responsavelId: conversaAtendenteId,
  };
  if (ev.evento === "connect" && ev.direcao === "entrada" && ev.sdp) {
    const filaSinal = montarSinalFila(ev.callId, "tocando", ctxFila, ev.sdp);
    if (conversaAtendenteId) {
      // Cliente que já tem atendente: a chamada fica só na fila DELE.
      await emitirParaAtendente(conversaAtendenteId, filaSinal);
    } else {
      // Sem responsável: cai na fila do escritório (qualquer um assume).
      await emitirParaEscritorio(canalInfo.escritorioId, filaSinal);
    }
    // Transbordo: só se ligado na config do escritório e houver responsável.
    const cfg = await obterConfigChamada(canalInfo.escritorioId);
    if (cfg.transbordoAtivo && conversaAtendenteId) {
      agendarOverflow({
        callId: ev.callId,
        escritorioId: canalInfo.escritorioId,
        responsavelId: conversaAtendenteId,
        sdpOffer: ev.sdp,
        contatoId,
        contatoNome,
        telefone: ev.telefone || null,
        conversaId,
      });
    }
  } else if (ev.evento === "terminate") {
    cancelarOverflow(ev.callId);
    // Remove de qualquer fila (responsável ou escritório).
    await emitirParaEscritorio(canalInfo.escritorioId, montarSinalFila(ev.callId, "removida", ctxFila));
  }

  // ── Chamada recebida perdida (ninguém atendeu, não foi recusa) → WhatsApp ──
  if (
    ev.evento === "terminate" &&
    ev.direcao === "entrada" &&
    existente &&
    !existente.atendidaEm &&
    existente.status !== "rejeitada"
  ) {
    await avisarPerdidaPorWhatsapp(canalInfo, ev.telefone, conversaId);
  }
}

/**
 * Manda o WhatsApp automático de "já te retornamos" quando a chamada recebida
 * é perdida, e registra na conversa pra o atendente ver. Best-effort.
 */
async function avisarPerdidaPorWhatsapp(
  canalInfo: CanalChamada,
  telefone: string,
  conversaId: number | null,
): Promise<void> {
  if (!telefone) return;
  try {
    const cfg = await obterConfigCanal(canalInfo.canalId, canalInfo.escritorioId);
    if (!cfg?.accessToken || !cfg?.phoneNumberId) return;
    const client = new WhatsAppCloudClient({
      accessToken: cfg.accessToken,
      phoneNumberId: cfg.phoneNumberId,
      wabaId: cfg.wabaId,
    });
    const messageId = await client.enviarTexto(telefone, TEXTO_PERDIDA);

    const db = await getDb();
    if (db && conversaId) {
      await db.insert(mensagens).values({
        conversaId,
        direcao: "saida",
        tipo: "texto",
        conteudo: TEXTO_PERDIDA,
        status: "enviada",
        idExterno: messageId || null,
      });
      await db
        .update(conversas)
        .set({ ultimaMensagemAt: new Date(), ultimaMensagemPreview: TEXTO_PERDIDA.slice(0, 250) })
        .where(eq(conversas.id, conversaId));
    }
    log.info({ telefone, conversaId }, "[WA Calling] chamada perdida — WhatsApp automático enviado");
  } catch (err: any) {
    log.warn("[WA Calling] falha ao enviar WhatsApp de chamada perdida:", err?.message);
  }
}

/** Nome do atendente (users.name) a partir do id de colaborador. Best-effort. */
async function nomeAtendente(atendenteId: number | null): Promise<string | null> {
  if (!atendenteId) return null;
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ nome: users.name })
    .from(colaboradores)
    .innerJoin(users, eq(colaboradores.userId, users.id))
    .where(eq(colaboradores.id, atendenteId))
    .limit(1);
  return row?.nome ?? null;
}

/**
 * Registra/atualiza o cartão de ligação na conversa — UM por callId. Criado
 * quando a chamada aparece e FINALIZADO com resultado + duração no terminate.
 * Os dados estruturados vão no `payload` (JSON) pro frontend desenhar o cartão;
 * o `conteudo` é o texto legível (e vira preview da lista). A duração usada é a
 * que a Meta reporta no terminate — fonte da verdade. Best-effort.
 */
async function upsertCartaoLigacao(
  conversaId: number | null,
  ev: EventoChamadaNormalizado,
  atendenteNome: string | null,
): Promise<void> {
  if (!conversaId) return;
  const db = await getDb();
  if (!db) return;
  try {
    const conteudo = `📞 ${descreverLigacao(ev.direcao, ev.status, ev.duracaoSegundos)}`;
    const payload = JSON.stringify({
      kind: "ligacao",
      callId: ev.callId,
      direcao: ev.direcao,
      status: ev.status,
      duracaoSegundos: ev.duracaoSegundos ?? null,
      atendenteNome: atendenteNome ?? null,
    });
    const [card] = await db
      .select({ id: mensagens.id })
      .from(mensagens)
      .where(
        and(
          eq(mensagens.conversaId, conversaId),
          eq(mensagens.tipo, "ligacao"),
          eq(mensagens.idExterno, ev.callId),
        ),
      )
      .limit(1);
    if (card) {
      await db.update(mensagens).set({ conteudo, payload }).where(eq(mensagens.id, card.id));
    } else {
      await db.insert(mensagens).values({
        conversaId,
        direcao: ev.direcao,
        tipo: "ligacao",
        conteudo,
        payload,
        idExterno: ev.callId,
        status: "enviada",
      });
    }
    await db
      .update(conversas)
      .set({ ultimaMensagemAt: new Date(), ultimaMensagemPreview: conteudo.slice(0, 250) })
      .where(eq(conversas.id, conversaId));
  } catch (err: any) {
    log.warn("[WA Calling] falha ao registrar cartão de ligação:", err?.message);
  }
}

/**
 * Chamada recebida = interação real: garante contato + conversa, atribui
 * atendente por rodízio (MESMA distribuição da mensagem — `distribuirLead`:
 * carga, online, horário, stickiness) e abre no Inbox com ícone de ligação.
 * Best-effort: falha aqui não derruba o log da chamada.
 */
async function garantirConversaEAtribuir(
  canalInfo: CanalChamada,
  telefone: string,
  atual: {
    contatoId: number | null;
    contatoNome: string | null;
    conversaId: number | null;
    conversaAtendenteId: number | null;
  },
): Promise<typeof atual> {
  const db = await getDb();
  if (!db || !telefone) return atual;
  let { contatoId, contatoNome, conversaId, conversaAtendenteId } = atual;
  try {
    if (!contatoId) {
      const c = await criarOuReutilizarContato({
        escritorioId: canalInfo.escritorioId,
        nome: telefone,
        telefone,
        // "telefone" é o valor válido do enum de origem (ligação de voz);
        // "ligacao" cairia no fallback "manual" do validarOrigem.
        origem: "telefone",
      });
      contatoId = c.id;
      contatoNome = telefone;
    }
    if (!conversaId) {
      conversaId = await criarConversa({
        escritorioId: canalInfo.escritorioId,
        contatoId,
        canalId: canalInfo.canalId,
        assunto: `Ligação: ${contatoNome || telefone}`,
      });
    }
    // Atribui só se ainda não tem responsável (preserva stickiness).
    if (!conversaAtendenteId) {
      const atendente = await distribuirLead(canalInfo.escritorioId, contatoId, canalInfo.canalId);
      if (atendente) {
        conversaAtendenteId = atendente;
        await db.update(contatos).set({ responsavelId: atendente }).where(eq(contatos.id, contatoId));
      }
    }
    // Abre no Inbox: status + preview. O cartão de ligação em si (tipo
    // "ligacao") é inserido por upsertCartaoLigacao logo após esta função.
    await db
      .update(conversas)
      .set({
        atendenteId: conversaAtendenteId ?? undefined,
        status: conversaAtendenteId ? "em_atendimento" : "aguardando",
        ultimaMensagemAt: new Date(),
        ultimaMensagemPreview: "📞 Chamada recebida",
      })
      .where(eq(conversas.id, conversaId));
  } catch (err: any) {
    log.warn("[WA Calling] falha ao abrir conversa/atribuir da chamada:", err?.message);
  }
  return { contatoId, contatoNome, conversaId, conversaAtendenteId };
}
