-- Migration 0082: desativa customers Asaas que dão 403 sistematicamente
--
-- Por que existe: cron syncCobrancasEscritorio itera por cada vinculo
-- em asaas_clientes e chama GET /payments?customer=X. Se a key Asaas
-- não tem permissão pra ler aquele customer (situação real reportada
-- com customers existentes em prod + key prod, mas erro 403
-- recorrente no log), o cron continua tentando todo tick (10min) sem
-- efeito útil — só consome cota do Asaas.
--
-- Fix: tag de "ativo" por vinculo. Quando 403 acontece, marca a row
-- inativa + grava timestamp/mensagem pra UI mostrar e admin
-- reativar quando o problema for resolvido (ex: re-conectou key,
-- restaurou permissão no painel Asaas).
--
-- Default ativo=TRUE: rows existentes continuam sendo sincronizadas
-- (não muda comportamento), só novas falhas marcam inativo.
--
-- ultimoErro403Mensagem (255 chars): suficiente pra mensagem do
-- Axios + status code, sem inflar o tamanho da row.

ALTER TABLE asaas_clientes
  ADD COLUMN ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN ultimoErro403Em TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN ultimoErro403Mensagem VARCHAR(255) NULL DEFAULT NULL;
