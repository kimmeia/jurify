/**
 * Cron de processamento de trials (Fase 3 do roadmap de Planos).
 *
 * Rodando a cada 1h via `_core/cron-jobs.ts`. Pra cada subscription em
 * `status='trialing'`:
 *   - Se faltam ≤ 3 dias e !trial_avisado_3d → email + marca flag
 *   - Se faltam ≤ 1 dia  e !trial_avisado_1d → email + marca flag
 *   - Se trial_expira_em <= now → status='canceled' + email "expirou"
 *
 * Idempotência: as flags `trial_avisado_*` impedem reenvio do mesmo email
 * dentro da janela. Status='canceled' impede re-processar trials expirados.
 *
 * Falhas no envio de email não revertem o cron — registra warning em
 * email_log (admin pode reenviar via /admin/email-log). Atualizar a flag
 * mesmo sem confirmação de delivery evita loop de reenvio (cliente que
 * não recebeu o aviso vai ser avisado no próximo email/login).
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { subscriptions, users } from "../../drizzle/schema";
import { getPlanoBySlug } from "./planos-repo";
import {
  enviarEmailTrialFaltam3Dias,
  enviarEmailTrialFaltam1Dia,
  enviarEmailTrialExpirou,
} from "../_core/email";
import { createLogger } from "../_core/logger";

const log = createLogger("trial-cron");

const DIA_MS = 24 * 60 * 60 * 1000;

export interface ResultadoCronTrial {
  avisos3d: number;
  avisos1d: number;
  expirados: number;
}

export async function processarTrials(): Promise<ResultadoCronTrial> {
  const db = await getDb();
  if (!db) return { avisos3d: 0, avisos1d: 0, expirados: 0 };

  const agora = Date.now();
  const tresDiasMs = 3 * DIA_MS;
  const umDiaMs = 1 * DIA_MS;

  // Busca subs em trial com dados do user numa única query
  const trials = await db
    .select({
      subId: subscriptions.id,
      userId: subscriptions.userId,
      planId: subscriptions.planId,
      trialExpiraEm: subscriptions.trialExpiraEm,
      avisado3d: subscriptions.trialAvisado3d,
      avisado1d: subscriptions.trialAvisado1d,
      userEmail: users.email,
      userNome: users.name,
    })
    .from(subscriptions)
    .leftJoin(users, eq(users.id, subscriptions.userId))
    .where(eq(subscriptions.status, "trialing"));

  let avisos3d = 0;
  let avisos1d = 0;
  let expirados = 0;

  for (const trial of trials) {
    if (!trial.trialExpiraEm || !trial.userEmail || !trial.planId) continue;

    const msRestantes = trial.trialExpiraEm - agora;

    // Expirou
    if (msRestantes <= 0) {
      await db.update(subscriptions)
        .set({ status: "canceled" })
        .where(eq(subscriptions.id, trial.subId));

      const plano = await getPlanoBySlug(trial.planId);
      const planoNome = plano?.nome ?? trial.planId;
      const r = await enviarEmailTrialExpirou({
        email: trial.userEmail,
        nome: trial.userNome ?? "",
        planoNome,
      });
      if (!r.success) {
        log.warn({ userId: trial.userId, error: r.error }, "Email 'trial expirou' falhou");
      }
      expirados++;
      log.info({ userId: trial.userId, planoSlug: trial.planId }, "Trial expirou — status='canceled'");
      continue;
    }

    // ≤ 1 dia
    if (msRestantes <= umDiaMs && !trial.avisado1d) {
      const plano = await getPlanoBySlug(trial.planId);
      const planoNome = plano?.nome ?? trial.planId;
      const r = await enviarEmailTrialFaltam1Dia({
        email: trial.userEmail,
        nome: trial.userNome ?? "",
        planoNome,
      });
      if (!r.success) {
        log.warn({ userId: trial.userId, error: r.error }, "Email 'trial 1 dia' falhou");
      }
      // Marca flag mesmo se email falhou — evita loop de reenvio.
      // O cliente pode acionar reenvio via UI futura ou admin/email-log.
      await db.update(subscriptions)
        .set({ trialAvisado1d: true, trialAvisado3d: true })
        .where(eq(subscriptions.id, trial.subId));
      avisos1d++;
      continue;
    }

    // ≤ 3 dias
    if (msRestantes <= tresDiasMs && !trial.avisado3d) {
      const plano = await getPlanoBySlug(trial.planId);
      const planoNome = plano?.nome ?? trial.planId;
      const r = await enviarEmailTrialFaltam3Dias({
        email: trial.userEmail,
        nome: trial.userNome ?? "",
        planoNome,
      });
      if (!r.success) {
        log.warn({ userId: trial.userId, error: r.error }, "Email 'trial 3 dias' falhou");
      }
      await db.update(subscriptions)
        .set({ trialAvisado3d: true })
        .where(eq(subscriptions.id, trial.subId));
      avisos3d++;
    }
  }

  return { avisos3d, avisos1d, expirados };
}
