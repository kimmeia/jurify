-- WhatsApp Business Calling API (Meta Cloud API): log de chamadas de voz.
-- Cada linha é uma chamada recebida (entrada) ou feita pela empresa (saída)
-- pelo MESMO número já usado na mensageria (phone_number_id). callIdExternoCham
-- é o id opaco da Meta (único por chamada). conversaId/contatoId são
-- best-effort pra amarrar a chamada na timeline do atendimento.
CREATE TABLE IF NOT EXISTS chamadas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdCham INT NOT NULL,
  canalIdCham INT NOT NULL,
  contatoIdCham INT NULL,
  conversaIdCham INT NULL,
  atendenteIdCham INT NULL,
  callIdExternoCham VARCHAR(128) NOT NULL,
  direcaoCham ENUM('entrada','saida') NOT NULL,
  statusCham ENUM('tocando','conectando','em_andamento','encerrada','rejeitada','perdida','falha') NOT NULL DEFAULT 'tocando',
  telefoneCham VARCHAR(20) NULL,
  duracaoSegundosCham INT NULL,
  atendidaEmCham TIMESTAMP NULL DEFAULT NULL,
  encerradaEmCham TIMESTAMP NULL DEFAULT NULL,
  bizOpaqueCham VARCHAR(255) NULL,
  createdAtCham TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtCham TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY chamadas_callid_uq (callIdExternoCham),
  KEY chamadas_escritorio_idx (escritorioIdCham, createdAtCham),
  KEY chamadas_conversa_idx (conversaIdCham)
);
