-- Migration 0089: polimento da Fase 4 do módulo financeiro.
--
-- 1) `ofx_importacoes_fitid`: rastreia FITIDs já conciliados pra impedir
--    duplicação. Cada transação OFX tem um FITID único pelo banco. Se
--    o usuário importar o mesmo extrato 2x (acidente comum), o INSERT
--    falha com violação UNIQUE e a procedure pula silenciosamente.
--
--    Sem isso, despesa "Aluguel maio" R$ 3000 que já foi marcada paga
--    em conciliação anterior seria sobreposta — perda de auditoria.

CREATE TABLE ofx_importacoes_fitid (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  escritorioIdOfx INT NOT NULL,
  fitidOfx VARCHAR(255) NOT NULL,
  tipoEntidadeOfx ENUM('despesa', 'cobranca') NOT NULL,
  entidadeIdOfx INT NOT NULL,
  valorOfx DECIMAL(12, 2) NOT NULL,
  dataPagamentoOfx DATE NOT NULL,
  importadoEmOfx TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  importadoPorUserIdOfx INT NULL DEFAULT NULL,
  UNIQUE KEY ofx_escr_fitid_uq (escritorioIdOfx, fitidOfx),
  INDEX ofx_entidade_idx (escritorioIdOfx, tipoEntidadeOfx, entidadeIdOfx)
);
