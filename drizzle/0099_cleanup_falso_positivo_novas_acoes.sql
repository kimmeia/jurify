-- Cleanup operacional do falso-positivo de novas ações.
--
-- Contexto: até o commit 767d391 (fix do baseline silencioso em
-- pollMonitoramentosNovasAcoes), o cron inseria TODOS os CNJs retornados
-- pelo scraper na primeira execução com lido=false + notificação no sino.
-- Bug em cron-monitoramento.ts:574-660 — ramo de baseline ficava no else
-- de cnjsNovos.length>0, que era inalcançável quando cnjsConhecidos=[].
--
-- Resultado em produção: usuários viam "N nova(s) ação(ões) detectada(s)"
-- para processos PRÉ-EXISTENTES ao monitoramento. Falso-positivo.
--
-- Esta migration cura o estado:
--
--   1. Marca como lidos todos os eventos `nova_acao` criados antes do
--      deploy do fix. Inclui FPs do baseline e eventuais alertas
--      legítimos antigos que o usuário ainda não tinha visto — todos
--      ficam acessíveis no histórico do monitoramento (que mostra
--      eventos por cnjAfetado, não por lido).
--
--   2. Zera o contador acumulativo `total_novas_acoes` nos
--      monitoramentos tipo `novas_acoes`. O contador era inflado pelo
--      bug — zerar restaura precisão. Próximas detecções legítimas
--      voltam a incrementar normalmente.
--
-- Idempotente: aplicar 2× não tem efeito além da primeira aplicação.

UPDATE eventos_processo
SET lido = TRUE
WHERE tipoEvento = 'nova_acao'
  AND lido = FALSE
  AND createdAtEvento < NOW();

UPDATE motor_monitoramentos
SET total_novas_acoes = 0
WHERE tipo_monitoramento = 'novas_acoes';
