-- Comissão de gestão: faixas progressivas e valor mínimo, por gestor.
--
-- Pedido do dono (01/09): a comissão de gestão é gradativa "igual a dos SDRs"
-- e tem um valor mínimo de cobrança pra contar. A trilha nasceu com alíquota
-- fixa e usando o mínimo do escritório; agora cada gestor tem a sua tabela.
--
-- Por que por gestor e não uma só: `regra_comissao` já é singleton por
-- escritório justamente porque a venda tem uma regra só. Na gestão cada
-- pessoa negocia a sua — dois sócios com percentuais diferentes é o caso
-- comum — então as faixas penduram no gestor, não no escritório.
--
-- Aditiva: os defaults reproduzem o que está no ar hoje (flat, base
-- comissionável). O mínimo entra como 0 e passa a valer no lugar do mínimo
-- do escritório para esta trilha — a tela mostra o valor em uso.

ALTER TABLE comissao_gestao
  ADD COLUMN modoComGest ENUM('flat', 'faixas') NOT NULL DEFAULT 'flat';

ALTER TABLE comissao_gestao
  ADD COLUMN baseFaixaComGest ENUM('bruto', 'comissionavel') NOT NULL DEFAULT 'comissionavel';

ALTER TABLE comissao_gestao
  ADD COLUMN valorMinimoComGest DECIMAL(12, 2) NOT NULL DEFAULT '0';

-- Mesma convenção da tabela de faixas da venda: lidas em ordem crescente de
-- `ordem`, a faixa encaixa quando a base é <= `limiteAte`, e a última pode ter
-- `limiteAte` NULL pra representar "sem teto".
CREATE TABLE IF NOT EXISTS comissao_gestao_faixas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  comissaoGestaoIdFaixa INT NOT NULL,
  ordemFaixaGest INT NOT NULL,
  limiteAteFaixaGest DECIMAL(14, 2),
  aliquotaPercentFaixaGest DECIMAL(5, 2) NOT NULL,
  createdAtFaixaGest TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX comissao_gestao_faixa_idx (comissaoGestaoIdFaixa, ordemFaixaGest)
);
