-- Migration 0080: adiciona FK opcional notificacoes.eventoId → eventos_processo.id
--
-- Por que existe: hoje o NotificacoesSino, ao clicar numa notif do
-- tipo 'movimentacao', redireciona pra /processos?tab=movimentacoes
-- (lista de cards de monitoramento). Usuário precisa abrir o card,
-- scrollar histórico e identificar a movimentação específica que
-- gerou aquela notificação. UX ruim, especialmente com volume alto.
--
-- Solução: notificação ganha referência opcional pro evento que a
-- gerou (eventos_processo.id). Frontend abre Drawer com o detalhe
-- direto: texto completo, data real, CNJ, monitoramento. Posterior
-- (PR 3) adiciona ações inline (criar prazo/tarefa).
--
-- Non-destrutivo: ALTER TABLE ADD COLUMN com default NULL. Linhas
-- antigas continuam válidas (sem eventoId → frontend cai no
-- comportamento legado de redirect pra /processos?tab=movimentacoes).
--
-- Tipo: BIGINT pra alinhar com eventos_processo.id (autoincrement
-- bigint pra suportar volume alto de eventos).
--
-- Sem FK constraint formal: simplificar drop/cleanup de
-- eventos_processo (que pode ser limpo periodicamente). FK semântica
-- ok no app — INSERT do cron sempre passa um eventoId que acabou de
-- ser criado.

ALTER TABLE notificacoes
  ADD COLUMN eventoId BIGINT DEFAULT NULL;
