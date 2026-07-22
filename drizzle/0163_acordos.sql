-- Módulo Acordos: tratativas extrajudiciais de negociação com a parte
-- contrária. Visão global do escritório. Valores em centavos (int).
CREATE TABLE IF NOT EXISTS acordos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdAcordo INT NOT NULL,
  contatoIdAcordo INT NOT NULL,
  processoIdAcordo INT NULL,
  parteContrariaAcordo VARCHAR(255) NOT NULL,
  contatoContrarioNomeAcordo VARCHAR(255) NULL,
  contatoContrarioTelAcordo VARCHAR(20) NULL,
  responsavelIdAcordo INT NULL,
  valorPropostaAcordo INT NULL,
  valorFechadoAcordo INT NULL,
  statusAcordo ENUM('negociando','proposta_enviada','fechado','cancelado') NOT NULL DEFAULT 'negociando',
  motivoCancelamentoAcordo VARCHAR(512) NULL,
  criadoPorAcordo INT NULL,
  createdAtAcordo TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtAcordo TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX acordo_esc_idx (escritorioIdAcordo),
  INDEX acordo_contato_idx (contatoIdAcordo)
);

CREATE TABLE IF NOT EXISTS acordo_tratativas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  acordoIdTrat INT NOT NULL,
  autorUserIdTrat INT NULL,
  autorLabelTrat VARCHAR(255) NULL,
  tipoTrat ENUM('proposta','contraproposta','nota','fechamento','cancelamento') NOT NULL DEFAULT 'nota',
  valorTrat INT NULL,
  conteudoTrat TEXT NOT NULL,
  createdAtTrat TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX trat_acordo_idx (acordoIdTrat)
);
