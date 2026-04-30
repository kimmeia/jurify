-- 0042_asaas_config_cobranca_pai: persiste config de comissão pra
-- parcelamento e assinatura. Quando o Asaas dispara webhook criando
-- uma cobrança filha (parcela ou recorrência), o handler lê esta
-- tabela pelo ID do pai e aplica os flags de comissão na nova
-- cobrança. Cobranças avulsas continuam usando o path antigo.

CREATE TABLE IF NOT EXISTS asaas_config_cobranca_pai (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  escritorioIdAcCp INT NOT NULL,
  tipoAcCp ENUM('parcelamento','assinatura') NOT NULL,
  asaasParentIdAcCp VARCHAR(64) NOT NULL,
  atendenteIdAcCp INT NULL,
  categoriaIdAcCp INT NULL,
  comissionavelOverrideAcCp BOOLEAN NULL,
  createdAtAcCp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ac_cp_esc_parent_uq (escritorioIdAcCp, asaasParentIdAcCp),
  INDEX ac_cp_esc_idx (escritorioIdAcCp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
