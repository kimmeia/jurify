-- 0129_smartflow_layout: adiciona a coluna `layoutSF` (JSON) em
-- `smartflow_cenarios` para persistir as posições x/y dos nós no editor
-- visual do SmartFlow. As posições são keyed por `clienteId` do passo e por
-- "__gatilho__" pro nó de gatilho. Puramente visual — o engine ignora.
--
-- Non-destrutivo (coluna nullable) e idempotente (detecta via INFORMATION_SCHEMA).

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'smartflow_cenarios'
    AND column_name = 'layoutSF'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE smartflow_cenarios ADD COLUMN layoutSF TEXT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
