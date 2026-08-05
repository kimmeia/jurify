-- Envio programado de relatórios por e-mail.
--
-- Cada linha é um agendamento: qual relatório, com quais filtros, pra quem e
-- com que frequência. O cron roda de hora em hora e dispara os que batem com
-- a hora LOCAL do escritório — cron fixo em UTC mandaria relatório de
-- madrugada pra metade do país.

CREATE TABLE IF NOT EXISTS relatorios_programados (
  id INT NOT NULL AUTO_INCREMENT,
  escritorioIdRelProg INT NOT NULL,
  relatorioRelProg ENUM('atendimento','comercial','producao','agenda','financeiro') NOT NULL,
  -- diaria: todo dia; semanal: no diaSemana; mensal: no diaMes
  frequenciaRelProg ENUM('diaria','semanal','mensal') NOT NULL DEFAULT 'semanal',
  -- 0=domingo … 6=sábado. Só vale em frequencia='semanal'.
  diaSemanaRelProg TINYINT NOT NULL DEFAULT 1,
  -- 1-28. Limitado a 28 de propósito: dia 29/30/31 não existe em todo mês e
  -- o agendamento simplesmente não dispararia em fevereiro.
  diaMesRelProg TINYINT NOT NULL DEFAULT 1,
  -- Hora local do escritório (0-23).
  horaRelProg TINYINT NOT NULL DEFAULT 8,
  -- Janela coberta pelo relatório, em dias, contados pra trás a partir do
  -- disparo. 30 = "últimos 30 dias".
  janelaDiasRelProg SMALLINT NOT NULL DEFAULT 30,
  -- Filtros do relatório (setorId, funilId, etc). JSON pra não criar uma
  -- coluna por filtro de cada um dos cinco relatórios.
  filtrosRelProg TEXT DEFAULT NULL,
  -- Lista de e-mails separada por vírgula.
  destinatariosRelProg VARCHAR(1000) NOT NULL,
  ativoRelProg BOOLEAN NOT NULL DEFAULT TRUE,
  criadoPorRelProg INT DEFAULT NULL,
  -- Resultado do último disparo. Mesmo motivo de `resumo_diario_envios`:
  -- erro de integração que vive só no response some, e o painel fica
  -- mostrando "ativo" enquanto ninguém recebe nada.
  ultimoEnvioEmRelProg TIMESTAMP NULL DEFAULT NULL,
  ultimoStatusRelProg ENUM('enviado','falha','parcial') DEFAULT NULL,
  ultimoErroRelProg VARCHAR(500) DEFAULT NULL,
  criadoEmRelProg TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizadoEmRelProg TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_relprog_escritorio (escritorioIdRelProg, ativoRelProg)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Log de disparos. A chave de idempotência (agendamento, dia local) impede
-- que tick duplicado, reinício de processo ou redeploy no horário mandem o
-- mesmo relatório duas vezes.
CREATE TABLE IF NOT EXISTS relatorios_programados_envios (
  id INT NOT NULL AUTO_INCREMENT,
  programadoIdRelEnv INT NOT NULL,
  escritorioIdRelEnv INT NOT NULL,
  dataRefRelEnv VARCHAR(10) NOT NULL,
  statusRelEnv ENUM('enviado','falha','parcial','sem_dados') NOT NULL,
  destinatariosRelEnv VARCHAR(1000),
  erroRelEnv VARCHAR(500),
  criadoEmRelEnv TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_relprog_dia (programadoIdRelEnv, dataRefRelEnv),
  INDEX idx_relenv_escritorio (escritorioIdRelEnv, dataRefRelEnv)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
