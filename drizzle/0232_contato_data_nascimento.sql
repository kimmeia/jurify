-- 0232_contato_data_nascimento: data de nascimento do cliente.
--
-- Coluna própria, e não campo personalizado, porque o valor precisa ser
-- PROCURADO ("quem faz aniversário hoje?"). Campo personalizado mora num JSON
-- em `camposPersonalizadosContato` e nenhuma consulta alcança o que está lá
-- dentro — ninguém seria lembrado de nada.
--
-- Aditiva: NULL para todo mundo que já existe, e NULL quer dizer "não sei",
-- não "não tem". Nenhuma tela passa a exigir o campo.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'contatos'
    AND column_name = 'dataNascimentoContato'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE contatos ADD COLUMN dataNascimentoContato DATE NULL DEFAULT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- O cron do aniversário varre por escritório e compara mês/dia. O índice
-- cobre o recorte (escritório + tem data), que é o que corta a varredura;
-- MONTH()/DAY() não são indexáveis sem coluna gerada, e na escala de uma
-- carteira de escritório a conta é barata.
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'contatos'
    AND index_name = 'idx_contato_nascimento'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX idx_contato_nascimento ON contatos (escritorioIdContato, dataNascimentoContato)',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
