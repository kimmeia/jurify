-- Bloqueios da agenda (feriados + indisponibilidades pontuais).
-- Usado pelo gerador de slots livres da IA (server/smartflow/engine.ts)
-- pra pular dias/intervalos que a IA não pode oferecer ao cliente.
--
-- Campos:
--   data: YYYY-MM-DD no fuso do escritório
--   horaInicio: NULL = dia inteiro bloqueado; senão HH:MM
--   horaFim: exigido se horaInicio !== NULL
--   recorrenteAnual: TRUE = bloqueia todo ano nessa data (ex: 25/12)
CREATE TABLE IF NOT EXISTS agenda_bloqueios (
  id            INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  escritorioId  INT NOT NULL,
  data          VARCHAR(10) NOT NULL,
  horaInicio    VARCHAR(5) NULL,
  horaFim       VARCHAR(5) NULL,
  motivo        VARCHAR(200) NULL,
  recorrenteAnual BOOLEAN NOT NULL DEFAULT FALSE,
  criadoPorId   INT NULL,
  createdAt     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agenda_bloqueios_esc_data (escritorioId, data)
);
