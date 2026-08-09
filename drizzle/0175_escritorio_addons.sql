-- Add-ons contratados à parte, por escritório.
--
-- O JurisIA é vendido fora do plano, e até aqui a única forma de liberar era
-- mexer na cota do plano — o que atinge todos os clientes daquela faixa de uma
-- vez e impede cortesia, piloto e contrato avulso.
--
-- `produto` é varchar em vez de enum de propósito: o segundo add-on não deve
-- exigir ALTER TABLE numa tabela que já tem contrato de cliente dentro.
CREATE TABLE IF NOT EXISTS escritorio_addons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdAddon INT NOT NULL,
  produtoAddon VARCHAR(48) NOT NULL,
  statusAddon ENUM('ativo','suspenso','cancelado') NOT NULL DEFAULT 'ativo',
  limiteMensalAddon INT NOT NULL DEFAULT 0,
  inicioEmAddon TIMESTAMP NULL DEFAULT NULL,
  expiraEmAddon TIMESTAMP NULL DEFAULT NULL,
  precoCentavosAddon INT NOT NULL DEFAULT 0,
  observacaoAddon VARCHAR(500) DEFAULT NULL,
  concedidoPorAddon INT DEFAULT NULL,
  criadoEmAddon TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizadoEmAddon TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY escritorio_addon_unico (escritorioIdAddon, produtoAddon),
  KEY idx_addon_produto_status (produtoAddon, statusAddon)
);
