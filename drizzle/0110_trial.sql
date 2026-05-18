-- Migration 0110: trial 14 dias sem cartão (Fase 3)
--
-- Adiciona campos em subscriptions pra suportar trial sem chamar Asaas:
--   - trial_iniciado_em / trial_expira_em: timestamps em ms (alinha com
--     padrão existente de currentPeriodEnd)
--   - trial_avisado_3d / trial_avisado_1d: flags pra cron não reenviar
--     o mesmo email
--   - trial_convertido: marca quando trial vira assinatura paga
--
-- Em escritorios:
--   - ja_usou_trial: anti-abuso (1 trial por escritório, never)
--   - trial_usado_em: auditável
--
-- Convenção:
--   - Subscription em trial: status='trialing', trial_iniciado_em=now,
--     trial_expira_em=now+plano.trial_dias, asaas_subscription_id=NULL
--   - Conversão trial → pago: cliente paga via Asaas, subscription local
--     ganha asaas_subscription_id, status muda pra 'active' (via webhook),
--     trial_convertido=true (auditável)
--   - Trial expira sem conversão: cron muda status='canceled' + dispara
--     email "trial expirou". SubscriptionGuard bloqueia próximo acesso.

ALTER TABLE subscriptions
  ADD COLUMN trial_iniciado_em BIGINT NULL,
  ADD COLUMN trial_expira_em BIGINT NULL,
  ADD COLUMN trial_avisado_3d BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN trial_avisado_1d BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN trial_convertido BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE escritorios
  ADD COLUMN ja_usou_trial BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN trial_usado_em TIMESTAMP NULL;
