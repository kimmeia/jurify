-- Histórico do robô de jornada.
--
-- O robô já existia, mas rodava só por comando de terminal — então ninguém
-- rodava, e o que ele achava morria no console de quem executou. Guardar cada
-- execução é o que transforma "roda quando alguém lembra" em "está de pé e eu
-- sei quando foi a última vez".
--
-- Mesma forma da tabela do robô auditor: resumo em colunas pra listar rápido,
-- detalhe em JSON porque o formato do achado ainda vai mudar e migração por
-- causa de campo de relatório não se paga.

CREATE TABLE IF NOT EXISTS jornada_varreduras (
  id INT NOT NULL AUTO_INCREMENT,
  runId VARCHAR(64) NOT NULL,
  -- 'manual' = alguém clicou no painel; 'cron' = agendada.
  origemJV ENUM('manual','cron') NOT NULL DEFAULT 'manual',
  -- Onde ela rodou. Guardado porque o mesmo painel dispara contra ambientes
  -- diferentes, e um achado sem saber de onde veio não serve pra nada.
  baseUrlJV VARCHAR(255) NOT NULL,
  -- 'rodando' existe pra tela poder mostrar progresso: a execução leva
  -- minutos, e sem estado intermediário o botão ficaria mudo até o fim.
  statusJV ENUM('rodando','concluida','falhou') NOT NULL DEFAULT 'rodando',
  iniciadoEmJV TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  terminadoEmJV TIMESTAMP NULL DEFAULT NULL,
  duracaoMsJV INT DEFAULT NULL,
  rotasVisitadasJV INT NOT NULL DEFAULT 0,
  rotasComAchadoJV INT NOT NULL DEFAULT 0,
  conferenciasTotalJV INT NOT NULL DEFAULT 0,
  conferenciasFalhasJV INT NOT NULL DEFAULT 0,
  -- Se o escritório descartável foi mesmo apagado. É o campo que o dono vai
  -- olhar: execução que termina sem limpar deixa dado de mentira no banco.
  escritorioLimpoJV BOOLEAN NOT NULL DEFAULT FALSE,
  erroJV VARCHAR(500) DEFAULT NULL,
  detalheJson JSON DEFAULT NULL,
  createdAtJV TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jornada_run (runId),
  INDEX idx_jornada_recentes (iniciadoEmJV)
);
