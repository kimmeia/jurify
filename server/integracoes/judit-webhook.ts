/**
 * Webhook Judit.IO — Recebe notificações de monitoramentos e consultas.
 *
 * A Judit envia um POST com o payload completo do processo atualizado.
 * O webhook salva os dados na tabela judit_respostas e atualiza o monitoramento.
 *
 * Eventos:
 * - response_created (response_type=lawsuit) → atualização de processo
 * - response_created (response_type=application_info, code=600) → request_completed
 * - response_created (response_type=application_error) → erro na consulta
 */

import type { Express, Request, Response } from "express";
import { getDb } from "../db";
import { adminIntegracoes, juditMonitoramentos, juditRespostas } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../escritorio/crypto-utils";
import { JuditClient } from "./judit-client";

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: OBTER API KEY DECRIPTOGRAFADA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna a API key da Judit decriptografada, ou null se não conectada.
 * Usar apenas no backend — nunca expor a key para o frontend.
 */
export async function getJuditApiKey(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const reg = await db
    .select()
    .from(adminIntegracoes)
    .where(and(eq(adminIntegracoes.provedor, "judit"), eq(adminIntegracoes.status, "conectado")))
    .limit(1);

  if (reg.length === 0 || !reg[0].apiKeyEncrypted || !reg[0].apiKeyIv || !reg[0].apiKeyTag) {
    return null;
  }

  try {
    return decrypt(reg[0].apiKeyEncrypted, reg[0].apiKeyIv, reg[0].apiKeyTag);
  } catch {
    return null;
  }
}

/**
 * Retorna uma instância autenticada do JuditClient, ou null se não conectada.
 */
export async function getJuditClient(): Promise<JuditClient | null> {
  const apiKey = await getJuditApiKey();
  if (!apiKey) return null;
  return new JuditClient(apiKey);
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════════

interface JuditWebhookPayload {
  user_id: string;
  callback_id: string;
  event_type: string;
  reference_type: "request" | "tracking";
  reference_id: string;
  payload: {
    request_id: string;
    response_id: string;
    response_type: string;
    response_data: any;
    user_id: string;
    created_at: string;
    origin?: string;
    origin_id?: string;
    tags?: {
      cached_response?: boolean;
      [key: string]: any;
    };
  };
}

export function registerJuditWebhook(app: Express) {
  app.post("/api/webhooks/judit", async (req: Request, res: Response) => {
    try {
      const body = req.body as JuditWebhookPayload;

      if (!body || !body.event_type || !body.payload) {
        return res.status(400).json({ error: "Payload inválido" });
      }

      console.log(
        `[Judit Webhook] Evento: ${body.event_type} | Tipo: ${body.reference_type} | Ref: ${body.reference_id} | Response: ${body.payload.response_type}`
      );

      const db = await getDb();
      if (!db) {
        console.error("[Judit Webhook] Database indisponível");
        return res.status(500).json({ error: "Database indisponível" });
      }

      // Ignorar eventos que não são response_created
      if (body.event_type !== "response_created") {
        return res.status(200).json({ received: true, ignored: true });
      }

      const { payload } = body;

      // Identificar o monitoramento pelo origin_id (que é o tracking_id)
      // Em tracking, origin_id === tracking_id
      const trackingId = body.reference_type === "tracking" ? body.reference_id : null;

      if (!trackingId) {
        // Pode ser resposta de uma consulta avulsa, não de monitoramento
        console.log("[Judit Webhook] Resposta de consulta avulsa (não tracking), ignorando armazenamento");
        return res.status(200).json({ received: true });
      }

      // Buscar monitoramento local
      const monLocal = await db
        .select()
        .from(juditMonitoramentos)
        .where(eq(juditMonitoramentos.trackingId, trackingId))
        .limit(1);

      if (monLocal.length === 0) {
        console.warn(`[Judit Webhook] Tracking ${trackingId} não encontrado localmente`);
        return res.status(200).json({ received: true, warning: "tracking_not_found_locally" });
      }

      const mon = monLocal[0];

      // Tratar conforme o tipo de resposta
      if (payload.response_type === "lawsuit") {
        const data = payload.response_data;
        const cachedResponse = payload.tags?.cached_response ?? false;
        const stepsCount = data?.last_step?.steps_count ?? data?.steps?.length ?? 0;

        // Salvar resposta
        await db.insert(juditRespostas).values({
          monitoramentoId: mon.id,
          responseId: payload.response_id,
          requestId: payload.request_id,
          responseType: "lawsuit",
          responseData: JSON.stringify(data),
          cachedResponse,
          stepsCount,
        });

        // Atualizar monitoramento com dados da última movimentação
        const lastStep = data?.last_step;
        await db
          .update(juditMonitoramentos)
          .set({
            statusJudit: "updated",
            tribunal: data?.tribunal_acronym || mon.tribunal,
            nomePartes: data?.name || mon.nomePartes,
            ultimaMovimentacao: lastStep?.content || mon.ultimaMovimentacao,
            ultimaMovimentacaoData: lastStep?.step_date || mon.ultimaMovimentacaoData,
            totalAtualizacoes: mon.totalAtualizacoes + 1,
          })
          .where(eq(juditMonitoramentos.id, mon.id));

        console.log(
          `[Judit Webhook] Processo ${data?.code} atualizado. Última mov: ${lastStep?.content?.slice(0, 60)}...`
        );
      } else if (payload.response_type === "application_info") {
        // request_completed — a consulta do tracking terminou
        const code = payload.response_data?.code;
        if (code === 600) {
          console.log(`[Judit Webhook] Tracking ${trackingId} — consulta concluída`);
        }
      } else if (payload.response_type === "application_error") {
        const errMsg = payload.response_data?.message || "UNKNOWN_ERROR";
        console.warn(`[Judit Webhook] Tracking ${trackingId} — erro: ${errMsg}`);

        // Salvar resposta de erro
        await db.insert(juditRespostas).values({
          monitoramentoId: mon.id,
          responseId: payload.response_id,
          requestId: payload.request_id,
          responseType: "application_error",
          responseData: JSON.stringify(payload.response_data),
          stepsCount: 0,
        });
      }

      return res.status(200).json({ received: true });
    } catch (err: any) {
      console.error("[Judit Webhook] Erro:", err.message);
      return res.status(500).json({ error: "Erro interno" });
    }
  });
}
