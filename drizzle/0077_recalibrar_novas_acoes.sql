-- Migration 0077: limpa lixo histórico do bug N+1 em monitoramentos de novas ações
--
-- Por que existe: antes do fix em consultarPorCpf (PR #205), o cron
-- pollMonitoramentosNovasAcoes capturava o CNJ "fantasma" do PJe TJCE
-- (header/breadcrumb/exemplo) junto com os reais. Quando esse fantasma
-- mudava entre execuções, o cron classificava como nova ação e:
--
--   1. INSERT em eventos_processo com tipo='nova_acao' e cnjAfetado=fantasma
--   2. Incremento em motor_monitoramentos.total_novas_acoes (badge na UI)
--   3. INSERT em notificacoes com tipo='movimentacao' (contador do dashboard)
--
-- O fix do adapter impede contaminação futura, mas não desfaz o que já
-- caiu no DB. Esta migration faz cleanup em 3 frentes pra rebaselinizar:
--
--   1. Marca todos os eventos nova_acao como lidos → zera badges/UI
--   2. Zera motor_monitoramentos.total_novas_acoes → zera contadores acumulados
--   3. Reseta cnjs_conhecidos pra forçar próxima execução do cron a
--      construir baseline limpo (apenas CNJs reais, sem fantasmas)
--   4. Marca notificacoes tipo='movimentacao' já lidas como referência
--      antiga (não toca não lidas — o cron real de movimentações pode
--      ter criado algumas legítimas misturadas)
--
-- Trade-off: a primeira "nova ação real" após esta migration vira parte
-- do baseline silencioso. Aceitável dado o estado atual estar
-- contaminado e não termos como distinguir fantasma de real
-- retroativamente.

UPDATE eventos_processo
  SET lido = TRUE
  WHERE tipoEvento = 'nova_acao';

UPDATE motor_monitoramentos
  SET total_novas_acoes = 0,
      cnjs_conhecidos = NULL
  WHERE tipo_monitoramento = 'novas_acoes';
