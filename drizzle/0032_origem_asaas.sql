-- 0032_origem_asaas: adiciona valor "asaas" no enum origemContato.
-- Quando contato é criado pela sincronização com Asaas (webhook ou
-- script de sync), passa a registrar origem="asaas" em vez de "manual",
-- pra ficar claro de onde veio.
--
-- ALTER MODIFY COLUMN com novo enum funciona em qualquer MySQL.
-- Idempotente (rodar 2x não dá erro). Itens existentes mantêm valor.

ALTER TABLE contatos
  MODIFY COLUMN origemContato
  ENUM('whatsapp','instagram','facebook','telefone','manual','site','asaas')
  NOT NULL DEFAULT 'manual';
