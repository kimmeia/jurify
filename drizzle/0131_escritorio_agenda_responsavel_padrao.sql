-- 0131_escritorio_agenda_responsavel_padrao: adiciona
-- `escritorios.agendaResponsavelPadraoId` — responsável padrão da agenda usado
-- como fallback pelo SmartFlow (Atendente IA / Agendar) quando não há atendente
-- na conversa nem responsável no contato.
--
-- Non-destrutivo: NULL = cai no colaborador "dono" em runtime (default seguro,
-- escritórios existentes continuam funcionando sem configurar nada).
-- Idempotente via INFORMATION_SCHEMA.

SET @ja_existe := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'escritorios'
    AND column_name = 'agendaResponsavelPadraoId'
);

SET @sql := IF(@ja_existe = 0,
  "ALTER TABLE escritorios ADD COLUMN agendaResponsavelPadraoId INT DEFAULT NULL",
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
