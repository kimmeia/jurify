-- Onboarding processual (mockup aprovado 24/08, implementado 25/08).
--
-- "Avisar quando chegar": tribunal que ainda não cobrimos vira registro de
-- interesse em vez de cadastro perdido — é a fila de prioridade de quais
-- adapters construir primeiro. Nunca é sobrescrito; cada clique é um voto.
CREATE TABLE IF NOT EXISTS interesse_tribunais (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdIntTrib INT NOT NULL,
  userIdIntTrib INT NOT NULL,
  tribunalIntTrib VARCHAR(120) NOT NULL,
  criadoEmIntTrib TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_interesse_tribunais_trib (tribunalIntTrib),
  INDEX idx_interesse_tribunais_esc (escritorioIdIntTrib)
);
