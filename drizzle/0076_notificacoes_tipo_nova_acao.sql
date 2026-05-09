-- Migration 0076: separa notificações de novas ações das de movimentações
--
-- Por que existe: o cron de novas ações (pollMonitoramentosNovasAcoes)
-- inseria notif com tipo='movimentacao' por falta de opção no enum, o
-- que misturava no contador do dashboard (que conta exatamente
-- tipo='movimentacao' em routers/dashboard.ts:resumoEscritorio). Quando
-- o cron com bug N+1 detectava CNJ fantasma como "novo", criava notif
-- 'movimentacao' órfã que ficava acumulando — usuário via "6
-- movimentações novas" no dashboard mas /processos vazio.
--
-- Adicionar 'nova_acao' ao enum permite o cron usar valor próprio,
-- sem contaminar o contador de movimentações reais. Migration 0077
-- limpa o lixo histórico em paralelo.
--
-- Non-destrutivo: ALTER MODIFY com superset do enum existente. Linhas
-- antigas com tipo='movimentacao'/'sistema'/'plano' continuam válidas.

ALTER TABLE notificacoes
  MODIFY COLUMN tipoNotif ENUM('movimentacao', 'sistema', 'plano', 'nova_acao')
  NOT NULL DEFAULT 'sistema';
