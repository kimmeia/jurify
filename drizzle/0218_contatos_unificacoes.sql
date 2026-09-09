-- Um número, um cadastro (mockup aprovado em 09/09/2026).
--
-- Registro de cada unificação de fichas: a ficha absorvida inteira, os ids
-- de tudo que mudou de dono e o que a ficha sobrevivente tinha antes. É o
-- que permite "Desfazer" por 7 dias, tanto a unificação automática (ficha
-- magra do WhatsApp absorvida pelo cadastro completo com o mesmo número)
-- quanto o "Mesclar" manual.
CREATE TABLE IF NOT EXISTS contatos_unificacoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdUnif INT NOT NULL,
  principalIdUnif INT NOT NULL,
  duplicadoIdUnif INT NOT NULL,
  origemUnif ENUM('automatica','manual') NOT NULL DEFAULT 'manual',
  duplicadoSnapshotUnif JSON NOT NULL,
  principalAntesUnif JSON NOT NULL,
  movidosUnif JSON NOT NULL,
  executadoPorUnif INT DEFAULT NULL,
  desfeitaEmUnif TIMESTAMP NULL DEFAULT NULL,
  desfeitaPorUnif INT DEFAULT NULL,
  createdAtUnif TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_unif_principal (escritorioIdUnif, principalIdUnif),
  INDEX idx_unif_esc_data (escritorioIdUnif, createdAtUnif)
);
