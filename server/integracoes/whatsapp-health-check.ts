/**
 * Health-check periódico dos canais WhatsApp oficiais (Cloud API).
 *
 * Lê na Meta, por canal conectado: quality_rating (GREEN/YELLOW/RED), tier
 * de mensagens (TIER_250/1K/...) e o status do número. Três efeitos:
 *
 *  1. Persiste qualidade/tier em `canais_integrados` — alimenta o badge da
 *     UI e o teto diário anti-ban (limiteDiarioPorTier).
 *  2. Detecção PRECOCE de degradação: qualidade caindo (YELLOW/RED) gera
 *     warn ANTES do ban — o incidente de jul/2026 só foi percebido depois
 *     do 131031, quando já era tarde.
 *  3. Número restrito/desativado na Meta → tripa o disjuntor e marca o
 *     canal `banido` proativamente (sem esperar um envio falhar).
 *
 * Registrado em `_core/cron-jobs.ts` (1×/hora). Best-effort: falha em um
 * canal não derruba o ciclo dos demais.
 */

import { getDb } from "../db";
import { canaisIntegrados } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "../_core/logger";

const log = createLogger("whatsapp-health-check");

const PAUSA_ENTRE_CANAIS_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SaudeNumero {
  qualityRating: string | null;
  tier: string | null;
  contaOk: boolean;
  motivo: string | null;
}

export interface AcaoSaude {
  /** Campos a persistir no canal (vazio = nada a atualizar). */
  updates: Record<string, unknown>;
  /** Tripa o disjuntor + marca banido (número restrito/desativado na Meta). */
  marcarRestrito: boolean;
  /** Qualidade degradada (YELLOW/RED) — vale warn/alerta, sem pausar. */
  alertaQualidade: boolean;
}

/**
 * Decide o que fazer com o resultado do health-check. Pura — testável sem
 * DB/rede. Não LIMPA restrição automaticamente (a reativação é decisão
 * humana via "Já resolvi": durante uma apelação, auto-religar atrapalha).
 */
export function avaliarSaude(saude: SaudeNumero): AcaoSaude {
  const updates: Record<string, unknown> = {};
  if (saude.qualityRating) updates.qualidadeMeta = saude.qualityRating;
  if (saude.tier) updates.tierMensagens = saude.tier;

  if (!saude.contaOk) {
    return { updates, marcarRestrito: true, alertaQualidade: false };
  }
  const q = (saude.qualityRating || "").toUpperCase();
  return {
    updates,
    marcarRestrito: false,
    alertaQualidade: q === "RED" || q === "YELLOW",
  };
}

/**
 * Roda o health-check em todos os canais whatsapp_api CONECTADOS.
 * Retorna contadores pra log/teste.
 */
export async function verificarSaudeCanaisWhatsApp(): Promise<{
  verificados: number;
  degradados: number;
  restritos: number;
}> {
  const db = await getDb();
  if (!db) return { verificados: 0, degradados: 0, restritos: 0 };

  const canais = await db
    .select()
    .from(canaisIntegrados)
    .where(eq(canaisIntegrados.tipo, "whatsapp_api"));

  let verificados = 0;
  let degradados = 0;
  let restritos = 0;

  for (const canal of canais) {
    if (canal.status !== "conectado") continue;
    if (!canal.configEncrypted || !canal.configIv || !canal.configTag) continue;
    try {
      const { decryptConfig } = await import("../escritorio/crypto-utils");
      const config = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
      if (!config?.accessToken || !config?.phoneNumberId) continue;

      const { WhatsAppCloudClient } = await import("./whatsapp-cloud");
      const client = new WhatsAppCloudClient({
        accessToken: config.accessToken,
        phoneNumberId: config.phoneNumberId,
      });
      const saude = await client.getSaudeNumero();
      verificados++;

      const acao = avaliarSaude(saude);

      if (acao.marcarRestrito) {
        restritos++;
        const { marcarCanalRestrito } = await import("./whatsapp-envio-guard");
        await marcarCanalRestrito(db, canal.id, saude.motivo || "Número restrito/desativado na Meta (health-check)");
        await db
          .update(canaisIntegrados)
          .set({
            ...acao.updates,
            status: "banido",
            mensagemErro: (saude.motivo || "Número restrito/desativado na Meta").slice(0, 500),
          })
          .where(eq(canaisIntegrados.id, canal.id));
        log.warn(
          { canalId: canal.id, escritorioId: canal.escritorioId, motivo: saude.motivo },
          "[HealthCheck] número restrito/desativado na Meta — canal pausado proativamente",
        );
      } else if (Object.keys(acao.updates).length > 0) {
        await db.update(canaisIntegrados).set(acao.updates).where(eq(canaisIntegrados.id, canal.id));
        if (acao.alertaQualidade) {
          degradados++;
          log.warn(
            { canalId: canal.id, escritorioId: canal.escritorioId, qualidade: saude.qualityRating, tier: saude.tier },
            "[HealthCheck] qualidade do número DEGRADADA — reduza volume/revise templates antes que a Meta restrinja",
          );
        }
        // Transição de qualidade/tier vira notificação ativa pro dono —
        // warn no deploy log ninguém vê a tempo (lição dos bans de jul/2026).
        try {
          const { avaliarTransicaoSaude, notificarSaudeCanal } = await import("./whatsapp-alertas");
          const alertas = avaliarTransicaoSaude({
            qualidadeAnterior: canal.qualidadeMeta,
            qualidadeNova: saude.qualityRating,
            tierAnterior: canal.tierMensagens,
            tierNovo: saude.tier,
          });
          for (const a of alertas) {
            await notificarSaudeCanal({ canalId: canal.id, titulo: a.titulo, mensagem: a.mensagem });
          }
        } catch { /* best-effort */ }
      }
    } catch (err: any) {
      log.warn({ canalId: canal.id, err: err?.message }, "[HealthCheck] falha ao verificar canal (não-fatal)");
    }
    await sleep(PAUSA_ENTRE_CANAIS_MS);
  }

  if (verificados > 0) {
    log.info({ verificados, degradados, restritos }, "[HealthCheck] ciclo concluído");
  }
  return { verificados, degradados, restritos };
}
