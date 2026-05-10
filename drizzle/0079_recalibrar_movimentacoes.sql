-- Migration 0079: limpa lixo histórico do cron de movimentações sem
-- baseline silencioso (irmão do bug que tinha em pollMonitoramentosNovasAcoes)
--
-- Por que existe: pollMonitoramentosMovs em cron-monitoramento.ts não
-- tinha guard de primeira execução. Quando um monitoramento era
-- criado, a primeira passada do cron (~1h depois) tratava TODAS as
-- movimentações já existentes do processo como "novas" — incluindo
-- despachos de meses atrás. Cada uma virava evento `lido=false` +
-- notificação `tipo='movimentacao'` no sino e contador do dashboard.
--
-- Sintoma reportado em staging: dashboard mostrava "X movimentações
-- novas" todas com data de detecção 08/05 mas conteúdo de
-- movimentações reais antigas (datas reais espalhadas pelo histórico
-- do processo).
--
-- O fix do cron (guard `isPrimeiraExecucao`) impede contaminação
-- futura — esta migration limpa o lixo já gravado:
--
--   1. eventos_processo: marca todos `tipo='movimentacao' lido=false`
--      como lidos. O conteúdo fica acessível pra consulta histórica
--      via aba do monitoramento, só não polui badges/contadores.
--   2. notificacoes: marca todas `tipo='movimentacao'` ainda não-lidas
--      com título "Nova movimentação:" como lidas. Limpa o chip do
--      dashboard e o sino. Filtro pelo título evita pegar movs reais
--      que cheguem entre a deploy desta migration e o próximo tick.
--   3. motor_monitoramentos: zera hash_ultimas_movs pra forçar
--      re-baseline silencioso na próxima execução do cron — assim
--      qualquer mov aparecida desde o último tick (com bug) fica
--      capturada como baseline, sem virar notif.
--
-- Trade-off: se houver mov genuinamente nova ainda não vista pelo
-- usuário, vira parte do baseline silencioso. Aceitável dado o estado
-- atual contaminado e o cron rodar a cada 1h.

UPDATE eventos_processo
  SET lido = TRUE
  WHERE tipoEvento = 'movimentacao'
    AND lido = FALSE;

UPDATE notificacoes
  SET lida = TRUE
  WHERE tipoNotif = 'movimentacao'
    AND lida = FALSE
    AND titulo LIKE 'Nova movimentação:%';

UPDATE motor_monitoramentos
  SET hash_ultimas_movs = NULL
  WHERE tipo_monitoramento = 'movimentacoes';
