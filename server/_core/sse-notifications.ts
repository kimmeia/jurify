/**
 * Sistema de Notificações em Tempo Real via Server-Sent Events (SSE)
 * 
 * Backend:
 *   - Clientes SSE se conectam via GET /api/events?userId=X
 *   - Quando algo acontece, chama emitirNotificacao(userId, tipo, dados)
 *   - A notificação é enviada via SSE para o cliente conectado
 * 
 * Frontend:
 *   - EventSource("/api/events?userId=X") escuta eventos
 *   - Exibe toast/badge quando recebe notificação
 * 
 * Tipos de notificação:
 *   - nova_mensagem: nova mensagem WhatsApp recebida
 *   - novo_lead: lead criado
 *   - conversa_atribuida: conversa atribuída ao atendente
 *   - assinatura_concluida: documento assinado pelo cliente
 *   - movimentacao_processo: nova movimentação em processo monitorado
 */

import type { Express, Request, Response } from "express";
import { createLogger } from "./logger";
import { sdk } from "./sdk";
const log = createLogger("_core-sse-notifications");

export interface Notificacao {
  tipo:
    | "nova_mensagem"
    | "novo_lead"
    | "conversa_atribuida"
    | "assinatura_concluida"
    | "movimentacao_processo"
    | "nova_acao"
    | "credencial_erro"
    | "credencial_recuperada"
    // Sinalização da ligação WhatsApp (Calling API). Carregam SDP/callId em
    // `dados` e são silenciosas no hook (kind: "sinalizacao_chamada").
    | "chamada_entrante"
    | "chamada_resposta"
    | "chamada_encerrada"
    | "chamada_fila"
    | "info";
  titulo: string;
  mensagem: string;
  dados?: Record<string, any>;
  timestamp: string;
}

// Mapa de conexões SSE ativas: userId → Response[]
const conexoes = new Map<number, Response[]>();

/** Registra as rotas SSE no Express */
export function registrarSSE(app: Express) {
  app.get("/api/events", async (req: Request, res: Response) => {
    // Autentica pela sessão (cookie) — NUNCA confia no `userId` da query.
    // O EventSource do browser envia o cookie de sessão automaticamente em
    // requests same-origin, então derivamos o usuário do próprio cookie.
    // Sem isso, qualquer um abriria /api/events?userId=N (IDs sequenciais) e
    // receberia em tempo real as notificações de outro usuário — vazamento
    // entre escritórios (mensagens, leads, movimentações de processo) e
    // violação de LGPD.
    let userId: number;
    try {
      const user = await sdk.authenticateRequest(req);
      userId = user.id;
    } catch {
      res.status(401).json({ error: "não autenticado" });
      return;
    }

    // Configurar headers SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Nginx
    });

    // Enviar heartbeat inicial
    res.write(`data: ${JSON.stringify({ tipo: "conectado", timestamp: new Date().toISOString() })}\n\n`);

    // Registrar conexão
    const atual = conexoes.get(userId) || [];
    atual.push(res);
    conexoes.set(userId, atual);

    log.info(`[SSE] Usuário ${userId} conectado (${atual.length} conexão(ões))`);

    // Heartbeat a cada 30s para manter conexão viva
    const heartbeat = setInterval(() => {
      try { res.write(`: heartbeat\n\n`); }
      catch { clearInterval(heartbeat); }
    }, 30000);

    // Cleanup ao desconectar
    req.on("close", () => {
      clearInterval(heartbeat);
      const conns = conexoes.get(userId) || [];
      const idx = conns.indexOf(res);
      if (idx >= 0) conns.splice(idx, 1);
      if (conns.length === 0) conexoes.delete(userId);
      else conexoes.set(userId, conns);
      log.info(`[SSE] Usuário ${userId} desconectado`);
    });
  });
}

// Tipos que viram Web Push (notificação com o app fechado). "info" e a
// sinalização de chamada ficam de fora — são silenciosos / ruído.
const TIPOS_PUSH = new Set<Notificacao["tipo"]>([
  "nova_mensagem",
  "novo_lead",
  "conversa_atribuida",
  "assinatura_concluida",
  "movimentacao_processo",
  "nova_acao",
]);

/** Rota que a notificação abre ao ser tocada. */
function rotaPush(n: Omit<Notificacao, "timestamp">): string {
  const conversaId = n.dados?.conversaId;
  if (conversaId) return `/atendimento?conversa=${conversaId}`;
  if (n.tipo === "movimentacao_processo" || n.tipo === "nova_acao" || n.tipo === "assinatura_concluida") {
    return "/processos";
  }
  return "/atendimento";
}

/** Envia notificação para um usuário específico (SSE em tempo real + Web Push). */
export function emitirNotificacao(userId: number, notificacao: Omit<Notificacao, "timestamp">) {
  // Web Push: independente de o user estar com o app aberto (é justamente
  // pra quando está fechado). Fire-and-forget — nunca bloqueia o SSE.
  if (TIPOS_PUSH.has(notificacao.tipo)) {
    (async () => {
      try {
        const { enviarPushParaUsuario } = await import("./web-push");
        const conversaId = notificacao.dados?.conversaId;
        await enviarPushParaUsuario(userId, {
          titulo: notificacao.titulo,
          corpo: notificacao.mensagem,
          url: rotaPush(notificacao),
          tag: conversaId ? `conversa-${conversaId}` : notificacao.tipo,
          dados: { ...(notificacao.dados ?? {}), tipo: notificacao.tipo },
        });
      } catch {
        /* push é best-effort */
      }
    })();
  }

  const conns = conexoes.get(userId);
  if (!conns || conns.length === 0) return;

  const payload = JSON.stringify({ ...notificacao, timestamp: new Date().toISOString() });
  const dead: number[] = [];

  conns.forEach((res, idx) => {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      dead.push(idx);
    }
  });

  // Limpar conexões mortas
  if (dead.length > 0) {
    const alive = conns.filter((_, i) => !dead.includes(i));
    if (alive.length === 0) conexoes.delete(userId);
    else conexoes.set(userId, alive);
  }
}

/** Envia notificação para todos os colaboradores de um escritório */
export async function emitirParaEscritorio(escritorioId: number, notificacao: Omit<Notificacao, "timestamp">) {
  try {
    const { getDb } = await import("../db");
    const { colaboradores } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");

    const db = await getDb();
    if (!db) return;

    const colabs = await db.select({ userId: colaboradores.userId })
      .from(colaboradores)
      .where(eq(colaboradores.escritorioId, escritorioId));

    for (const c of colabs) {
      emitirNotificacao(c.userId, notificacao);
    }
  } catch (err: any) {
    log.error("[SSE] Erro ao emitir para escritório:", err.message);
  }
}

/** Envia notificação para um atendente específico (pelo colaboradorId) */
export async function emitirParaAtendente(colaboradorId: number, notificacao: Omit<Notificacao, "timestamp">) {
  try {
    const { getDb } = await import("../db");
    const { colaboradores } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");

    const db = await getDb();
    if (!db) return;

    const [colab] = await db.select({ userId: colaboradores.userId })
      .from(colaboradores)
      .where(eq(colaboradores.id, colaboradorId))
      .limit(1);

    if (colab) emitirNotificacao(colab.userId, notificacao);
  } catch (err: any) {
    log.error("[SSE] Erro ao emitir para atendente:", err.message);
  }
}

/** Envia notificação APENAS para o atendente responsável da conversa
 *  + dono e gestores do escritório. Usado em eventos como "nova mensagem"
 *  que só interessam a quem cuida do atendimento (não a todos os
 *  colaboradores, como acontecia com emitirParaEscritorio antes).
 */
export async function emitirParaResponsaveisEMaster(
  escritorioId: number,
  atendenteResponsavelId: number | null | undefined,
  notificacao: Omit<Notificacao, "timestamp">,
) {
  try {
    const { getDb } = await import("../db");
    const { colaboradores } = await import("../../drizzle/schema");
    const { eq, and, or, inArray } = await import("drizzle-orm");

    const db = await getDb();
    if (!db) return;

    // Dono + gestores sempre. E o atendente responsável (se houver).
    const conds: any[] = [
      eq(colaboradores.cargo, "dono"),
      eq(colaboradores.cargo, "gestor"),
    ];
    if (atendenteResponsavelId) {
      conds.push(eq(colaboradores.id, atendenteResponsavelId));
    }

    const alvos = await db
      .select({ userId: colaboradores.userId })
      .from(colaboradores)
      .where(and(
        eq(colaboradores.escritorioId, escritorioId),
        eq(colaboradores.ativo, true),
        or(...conds),
      ));

    // Dedup por userId (dono pode estar em múltiplas listas)
    const seen = new Set<number>();
    for (const a of alvos) {
      if (!a.userId || seen.has(a.userId)) continue;
      seen.add(a.userId);
      emitirNotificacao(a.userId, notificacao);
    }
  } catch (err: any) {
    log.error("[SSE] Erro ao emitir para responsáveis:", err.message);
  }
}

/** Conjunto de userIds com pelo menos uma conexão SSE ativa (online agora). */
export function usuariosConectados(): Set<number> {
  return new Set(conexoes.keys());
}

/** Retorna total de conexões ativas (para debug) */
export function totalConexoesSSE(): number {
  let total = 0;
  for (const conns of conexoes.values()) total += conns.length;
  return total;
}
