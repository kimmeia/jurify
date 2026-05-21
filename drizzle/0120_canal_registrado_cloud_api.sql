-- 0120_canal_registrado_cloud_api: WhatsApp Cloud API exige POST
-- /{phone-number-id}/register após Embedded Signup. Sem essa chamada o
-- número fica "Pendente" no gerenciador da Meta e POST /messages falha
-- com "phone number not registered for Cloud API". Esta flag rastreia
-- se a chamada já foi feita — UI mostra "Registrar" enquanto false.
--
-- Compatível com qualquer MySQL via INFORMATION_SCHEMA (evita
-- ADD COLUMN IF NOT EXISTS que só funciona no 8.0.29+).

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'canais_integrados'
    AND column_name = 'registradoCloudApi'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE canais_integrados ADD COLUMN registradoCloudApi TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
