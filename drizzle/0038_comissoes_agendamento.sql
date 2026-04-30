-- 0038_comissoes_agendamento: lançamento automático de comissões por
-- cron. Cada escritório define dia + hora; um worker roda a cada 15min
-- e dispara fechamentos pendentes. Tabela de log com chave única
-- garante idempotência (deploy concorrente ou retry não duplica).

-- 1) Tabela `comissoes_agenda` — config por escritório
CREATE TABLE IF NOT EXISTS comissoes_agenda (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  escritorioIdComAg INT NOT NULL,
  ativoComAg TINYINT(1) NOT NULL DEFAULT 1,
  diaDoMesComAg INT NOT NULL,
  horaLocalComAg VARCHAR(5) NOT NULL,
  escopoPeriodoComAg ENUM('mes_anterior') NOT NULL DEFAULT 'mes_anterior',
  criadoPorUserIdComAg INT NOT NULL,
  criadoEmComAg TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizadoEmComAg TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY comissoes_agenda_escritorio_uq (escritorioIdComAg)
);

-- 2) Tabela `comissoes_lancamentos_log` — idempotência + auditoria
CREATE TABLE IF NOT EXISTS comissoes_lancamentos_log (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  escritorioIdComLog INT NOT NULL,
  agendaIdComLog INT NOT NULL,
  atendenteIdComLog INT NOT NULL,
  periodoInicioComLog VARCHAR(10) NOT NULL,
  periodoFimComLog VARCHAR(10) NOT NULL,
  statusComLog ENUM('em_andamento','concluido','falhou') NOT NULL,
  comissaoFechadaIdComLog INT NULL,
  mensagemErroComLog TEXT NULL,
  iniciadoEmComLog TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalizadoEmComLog TIMESTAMP NULL,
  UNIQUE KEY comissoes_log_execucao_uq (
    escritorioIdComLog, agendaIdComLog, atendenteIdComLog, periodoInicioComLog, periodoFimComLog
  ),
  KEY comissoes_log_escritorio_idx (escritorioIdComLog, iniciadoEmComLog)
);

-- 3) Coluna `origem` em `comissoes_fechadas`
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'comissoes_fechadas'
    AND column_name = 'origemComFech'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE comissoes_fechadas ADD COLUMN origemComFech ENUM('manual','automatico') NOT NULL DEFAULT 'manual'",
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) Coluna `agendaId` em `comissoes_fechadas`
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'comissoes_fechadas'
    AND column_name = 'agendaIdComFech'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE comissoes_fechadas ADD COLUMN agendaIdComFech INT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
