-- 0037_campos_personalizados_cliente: cada escritório define seus campos
-- extras pra capturar no cadastro do cliente (ex: "Número OAB", "Data
-- audiência"). Os valores ficam em contatos.camposPersonalizadosContato
-- (JSON) e o catálogo de definições na tabela `campos_personalizados_cliente`.
-- No SmartFlow ficam disponíveis como {{cliente.campos.<chave>}}.

-- 1) Tabela do catálogo de campos
CREATE TABLE IF NOT EXISTS campos_personalizados_cliente (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  escritorioIdCpc INT NOT NULL,
  chaveCpc VARCHAR(48) NOT NULL,
  labelCpc VARCHAR(64) NOT NULL,
  tipoCpc ENUM('texto','numero','data','textarea','select','boolean') NOT NULL DEFAULT 'texto',
  opcoesCpc TEXT NULL,
  ajudaCpc VARCHAR(200) NULL,
  obrigatorioCpc TINYINT(1) NOT NULL DEFAULT 0,
  ordemCpc INT NOT NULL DEFAULT 0,
  createdAtCpc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY campos_personalizados_unq (escritorioIdCpc, chaveCpc),
  KEY campos_personalizados_esc_idx (escritorioIdCpc, ordemCpc)
);

-- 2) Coluna de valores em contatos
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'contatos'
    AND column_name = 'camposPersonalizadosContato'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE contatos ADD COLUMN camposPersonalizadosContato TEXT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
