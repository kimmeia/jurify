-- Comissão de GESTÃO: uma segunda trilha de comissão, ao lado da de venda.
--
-- Regra do dono (01/09): o gestor ganha um percentual sobre o RECEBIDO de
-- todos os clientes que fecharam contrato a partir de uma data de corte —
-- independente de quem vendeu. Cliente que fechou antes do corte fica de
-- fora para sempre, mesmo pagando depois. A base é o pagamento, não o
-- valor fechado: fechou R$ 2.000 em 2x e pagou R$ 1.000, comissiona
-- R$ 1.000; a outra parcela comissiona quando cair.
--
-- Por que uma trilha nova e não reusar a existente: `simularComissao`
-- exclui do cálculo qualquer cobrança que já entrou num fechamento
-- comissionável do escritório — a garantia de que uma cobrança paga UMA
-- pessoa. Rodar o gestor sobre esse mesmo pool devolveria zero, porque o
-- vendedor já consumiu as cobranças. Com `tipo`, cada trilha tem o seu
-- controle de duplicidade e as duas convivem sobre a mesma cobrança.
--
-- Nada existente muda: linhas antigas nascem tipo='venda' pelo DEFAULT, e
-- o SQL da trilha de venda passa a filtrar tipo='venda' — que hoje é o
-- universo inteiro.

-- 1. Trilha do fechamento. DEFAULT cobre as linhas já gravadas.
ALTER TABLE comissoes_fechadas
  ADD COLUMN tipoComFech ENUM('venda', 'gestao') NOT NULL DEFAULT 'venda';

-- 2. Snapshot da data de corte aplicada (só na trilha de gestão). Congela
--    junto com aliquotaUsada: mudar o corte depois não reescreve o passado.
ALTER TABLE comissoes_fechadas
  ADD COLUMN dataCorteUsadaComFech VARCHAR(10) NULL DEFAULT NULL;

-- 3. A UNIQUE de dedup precisa separar as trilhas: um gestor que também
--    vende tem DUAS comissões no mesmo período (a dele como vendedor e a
--    de gestão), e sem `tipo` na chave a segunda cairia em ER_DUP_ENTRY.
--    Drop + create em sintaxe clássica (o auto-migrate trata "Can't drop"
--    e "Duplicate key name" como harmless, então rerodar é seguro).
ALTER TABLE comissoes_fechadas DROP INDEX com_fech_periodo_versao_uq;

CREATE UNIQUE INDEX com_fech_periodo_versao_uq
  ON comissoes_fechadas (
    escritorioIdComFech,
    atendenteIdComFech,
    tipoComFech,
    periodoInicioComFech,
    periodoFimComFech,
    versao
  );

-- 4. Quem recebe comissão de gestão, com quanto e a partir de quando.
--    Tabela própria porque `regra_comissao` é singleton por escritório
--    (UNIQUE em escritorioId) e cada gestor tem o seu percentual e o seu
--    corte. `ativo=false` desliga sem perder o histórico da configuração.
CREATE TABLE IF NOT EXISTS comissao_gestao (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdComGest INT NOT NULL,
  colaboradorIdComGest INT NOT NULL,
  aliquotaPercentComGest DECIMAL(5, 2) NOT NULL DEFAULT '0',
  dataCorteComGest VARCHAR(10) NOT NULL,
  ativoComGest BOOLEAN NOT NULL DEFAULT TRUE,
  criadoPorUserIdComGest INT NOT NULL,
  criadoEmComGest TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizadoEmComGest TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY comissao_gestao_escr_colab_uq (escritorioIdComGest, colaboradorIdComGest)
);
