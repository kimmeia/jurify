-- Migration 0078: migra notificações antigas do cron de novas ações
-- para o tipo correto ('nova_acao' em vez de 'movimentacao').
--
-- Por que existe: a migration 0076 adicionou 'nova_acao' ao enum e o
-- cron passou a usar o tipo correto, mas notificações JÁ INSERIDAS
-- antes do deploy continuam com tipoNotif='movimentacao' — somando no
-- contador `movimentacoesNaoLidas` do dashboard
-- (routers/dashboard.ts:resumoEscritorio) e gerando o sintoma "X
-- movimentações novas" mesmo quando /processos está vazio.
--
-- Heurística de identificação: o cron pollMonitoramentosNovasAcoes
-- gera SEMPRE título no formato "N nova(s) ação(ões) detectada(s)"
-- (cron-monitoramento.ts:493 antes do fix). O cron de movimentações
-- reais usa "Nova movimentação: <apelido>" — disjunto, sem ambiguidade.
--
-- Idempotente: se rodar 2x, a segunda passada não encontra mais linhas
-- com tipo='movimentacao' + título matching (já mudaram pra 'nova_acao'
-- na primeira passada).

UPDATE notificacoes
  SET tipoNotif = 'nova_acao'
  WHERE tipoNotif = 'movimentacao'
    AND titulo LIKE '% nova(s) ação(ões) detectada(s)';
