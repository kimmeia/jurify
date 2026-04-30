-- 0039_modelos_contrato: modelos de contrato com placeholders numerados
-- ({{1}}, {{2}}...). Cada placeholder pode ser de tipo "variavel" (resolve
-- automático de cliente/escritorio/data) ou "manual" (operador preenche
-- na hora de gerar). Inspirado nos templates do WhatsApp.

CREATE TABLE IF NOT EXISTS modelos_contrato (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  escritorioIdModCt INT NOT NULL,
  nomeModCt VARCHAR(150) NOT NULL,
  descricaoModCt VARCHAR(500),
  -- Path interno do arquivo (ex: /uploads/modelos-contrato/escritorio_1/abc.docx)
  arquivoUrlModCt VARCHAR(512) NOT NULL,
  -- Nome original do arquivo (preservado pra exibir + download)
  arquivoNomeModCt VARCHAR(255) NOT NULL,
  tamanhoModCt INT,
  -- JSON: [{numero:1, tipo:"variavel", variavel:"cliente.nome"}, ...]
  -- ou:    [{numero:2, tipo:"manual", label:"Valor da causa", dica:"Ex: R$ 10k"}]
  placeholdersModCt TEXT NOT NULL,
  criadoPorUserIdModCt INT NOT NULL,
  createdAtModCt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtModCt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_modct_esc (escritorioIdModCt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
