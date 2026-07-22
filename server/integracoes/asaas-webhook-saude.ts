/**
 * Health-check da fila de webhooks do Asaas.
 *
 * Quando entregas falham repetidamente (ex.: token divergente → 401), o
 * Asaas seta `interrupted: true` na config e PARA de enviar eventos — sem
 * nenhum aviso. O escritório segue "conectado", cobranças são pagas e nada
 * chega em tempo real (SmartFlow de pagamento não dispara; o catch-up
 * diário mascara com até 24h de atraso). Este cron:
 *
 *   1. lê `GET /webhook` de cada escritório conectado;
 *   2. fila interrompida → re-arma (POST com o MESMO token salvo) e
 *      notifica o dono (in-app + SSE);
 *   3. falha de re-arme vira `mensagemErro` persistida (nunca só log).
 */

import { getDb } from "../db";
import { asaasConfig, escritorios, notificacoes } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "../_core/logger";

const log = createLogger("asaas-webhook-saude");

const PAUSA_ENTRE_ESCRITORIOS_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function notificarDono(db: any, escritorioId: number, titulo: string, mensagem: string): Promise<void> {
  try {
    const [esc] = await db
      .select({ ownerId: escritorios.ownerId })
      .from(escritorios)
      .where(eq(escritorios.id, escritorioId))
      .limit(1);
    if (!esc?.ownerId) return;
    await db.insert(notificacoes).values({ userId: esc.ownerId, titulo, mensagem, tipo: "sistema" });
    const { emitirNotificacao } = await import("../_core/sse-notifications");
    emitirNotificacao(esc.ownerId, { tipo: "info", titulo, mensagem });
  } catch { /* best-effort */ }
}

export async function verificarWebhooksAsaas(): Promise<{
  verificados: number;
  rearmados: number;
  falhas: number;
}> {
  const db = await getDb();
  if (!db) return { verificados: 0, rearmados: 0, falhas: 0 };

  const configs = await db
    .select({
      id: asaasConfig.id,
      escritorioId: asaasConfig.escritorioId,
      webhookToken: asaasConfig.webhookToken,
    })
    .from(asaasConfig)
    .where(eq(asaasConfig.status, "conectado"));

  let verificados = 0;
  let rearmados = 0;
  let falhas = 0;

  for (const cfg of configs) {
    if (!cfg.webhookToken) continue;
    try {
      const { getAsaasClientForEscritorio } = await import("./asaas-sync");
      const client = await getAsaasClientForEscritorio(cfg.escritorioId);
      if (!client) continue;

      const wh = await client.obterWebhook();
      verificados++;
      // Sem webhook configurado ou apontando pra outro sistema: nada a
      // re-armar daqui (o registro exige a URL pública, que só o `conectar`
      // conhece).
      if (!wh?.url || !wh.url.includes("/api/webhooks/asaas")) continue;

      if (wh.interrupted) {
        try {
          await client.configurarWebhook(wh.url, cfg.webhookToken, wh.email || "noreply@calcsaas.app");
          rearmados++;
          log.warn(
            { escritorioId: cfg.escritorioId },
            "[Asaas WebhookSaude] fila estava INTERROMPIDA — re-armada com o token salvo",
          );
          await notificarDono(
            db,
            cfg.escritorioId,
            "⚠️ Fila de webhooks do Asaas estava interrompida",
            "O Asaas tinha parado de enviar eventos de pagamento (falhas de entrega acumuladas). A fila foi re-armada automaticamente — pagamentos do período interrompido entram pela sincronização diária.",
          );
        } catch (rearmErr: any) {
          falhas++;
          const msg = `webhook_interrompido: fila do Asaas interrompida e o re-arme automático falhou (${String(rearmErr?.message || rearmErr).slice(0, 160)})`;
          await db.update(asaasConfig).set({ mensagemErro: msg }).where(eq(asaasConfig.id, cfg.id));
          await notificarDono(
            db,
            cfg.escritorioId,
            "🔴 Webhooks do Asaas interrompidos",
            "O Asaas parou de enviar eventos de pagamento e o re-arme automático falhou. Vá em Financeiro → Conexão Asaas e reconecte para restabelecer.",
          );
        }
      }
    } catch (err: any) {
      // GET /webhook indisponível (rate limit/rede) — não é fatal; próximo
      // ciclo re-verifica.
      falhas++;
      log.warn({ escritorioId: cfg.escritorioId, err: err?.message }, "[Asaas WebhookSaude] verificação falhou (não-fatal)");
    }
    await sleep(PAUSA_ENTRE_ESCRITORIOS_MS);
  }

  if (verificados > 0 || falhas > 0) {
    log.info({ verificados, rearmados, falhas }, "[Asaas WebhookSaude] ciclo concluído");
  }
  return { verificados, rearmados, falhas };
}
