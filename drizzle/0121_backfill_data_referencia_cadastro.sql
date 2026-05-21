-- Backfill de `data_referencia_cadastro` em monitoramentos antigos.
--
-- A coluna foi adicionada na migration 0113 (19/05/2026) sem backfill —
-- linhas pré-existentes ficaram NULL. Sem o valor, o filtro de data no
-- cron (`cron-monitoramento.ts:623`) é pulado, e CNJs antigos viram
-- alerta de "nova ação" mesmo tendo sido distribuídos anos antes do
-- cliente entrar no escritório.
--
-- Esta migration aplica a MESMA regra de `criarMonitoramentoNovasAcoes`
-- (`server/routers/processos.ts:1670-1686`): lookup pelo CPF sanitizado
-- na tabela `contatos` do mesmo escritório, pegando `createdAt` do
-- contato como referência.
--
-- MIN(createdAt) garante determinismo caso (rarissimamente) exista mais
-- de um contato com o mesmo CPF no mesmo escritório — usa a entrada
-- mais antiga.
--
-- Idempotente: só toca monitoramentos onde data_referencia_cadastro
-- ainda está NULL e o tipo é "novas_acoes". Re-execução é no-op.

UPDATE motor_monitoramentos m
SET m.data_referencia_cadastro = (
  SELECT MIN(c.createdAtContato)
  FROM contatos c
  WHERE c.escritorioIdContato = m.escritorio_id
    AND REPLACE(REPLACE(REPLACE(REPLACE(c.cpfCnpj, '.', ''), '-', ''), '/', ''), ' ', '') = m.search_key
)
WHERE m.tipo_monitoramento = 'novas_acoes'
  AND m.data_referencia_cadastro IS NULL;
