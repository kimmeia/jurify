-- Base de conhecimento jurídico (RAG) do Agente Jurídico.
-- escritorioId NULL = base global da plataforma (súmulas/leis compartilhadas).
-- embedding = vetor (JSON de floats) pra busca por similaridade; NULL = ainda
-- não indexado (a indexação roda em app, precisa de chave de IA).
CREATE TABLE IF NOT EXISTS fontes_juridicas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioId INT NULL,
  tipo ENUM('sumula', 'lei', 'precedente', 'tese') NOT NULL,
  identificador VARCHAR(160) NOT NULL,
  orgao VARCHAR(60) NULL,
  area VARCHAR(80) NOT NULL DEFAULT 'geral',
  titulo VARCHAR(255) NULL,
  texto TEXT NOT NULL,
  tags VARCHAR(500) NULL,
  embedding TEXT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX fontes_jur_area_idx (area),
  INDEX fontes_jur_esc_idx (escritorioId)
);
