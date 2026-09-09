-- O porteiro de módulos contratados passou a valer em TODAS as chamadas
-- (antes, planos.modulos_liberados só era conferido em 3 procedures). Os
-- planos existentes foram criados quando a lista era decorativa — vários
-- não listam módulos que os escritórios usam todo dia. Pra ninguém perder
-- acesso no deploy, todo plano existente é promovido à lista completa
-- (comportamento de fato de hoje). Restringir vira decisão consciente do
-- admin no painel — e aí o porteiro obedece.
UPDATE planos SET modulos_liberados = JSON_ARRAY(
  'dashboard','configuracoes','clientes','atendimento','kanban','agenda',
  'processos','smartflow','agentes_ia','calculos','jurisia','financeiro',
  'comissoes','contratos','relatorios','backups','ponto'
);
