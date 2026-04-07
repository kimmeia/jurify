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
const log = createLogger("_core-sse-notifications");

export interface Notificacao {
  tipo: "nova_mensagem" | "novo_lead" | "conversa_atribuida" | "assinatura_concluida" | "movimentacao_processo" | "info";
  titulo: string;
  mensagem: string;
  dados?: Record<string, any>;
  timestamp: string;
}

// Mapa de conexões SSE ativas: userId → Response[]
const conexoes = new Map<number, Response[]>();

/** Registra as rotas SSE no Express */
export function registrarSSE(app: Express) {
  app.get("/api/events", (req: Request, res: Response) => {
    const userId = parseInt(req.query.userId as string);
    if (!userId || isNaN(userId)) {
      res.status(400).json({ error: "userId obrigatório" });
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

/** Envia notificação para um usuário específico */
export function emitirNotificacao(userId: number, notificacao: Omit<Notificacao, "timestamp">) {
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

/** Retorna total de conexões ativas (para debug) */
export function totalConexoesSSE(): number {
  let total = 0;
  for (const conns of conexoes.values()) total += conns.length;
  return total;
}
