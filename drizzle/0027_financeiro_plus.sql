-- Migration: Financeiro Plus — categorias, comissões e despesas.
--
-- Contexto: módulo Financeiro ganha (a) categorização de cobranças/despesas,
-- (b) regra global de comissão flat por escritório, (c) snapshot imutável de
-- fechamentos e (d) contas a pagar. Cobranças do Asaas ganham 3 colunas para
-- atribuição de comissão: atendente, categoria e override manual da elegibilidade.
--
-- Sentido bidirecional Asaas: cobranças criadas no Jurify carimbam o atendente
-- via externalReference; cobranças vindas do painel Asaas herdam o atendente
-- a partir do contato (atendenteResponsavelId em contatos).

-- ─────────────────────────────────────────────────────────────────────────────
-- Colunas em tabelas existentes
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE contatos
  ADD COLUMN atendenteRespIdContato INT NULL
  AFTER responsavelIdContato;

ALTER TABLE asaas_cobrancas
  ADD COLUMN atendenteIdAsaasCob INT NULL AFTER externalRefAsaas,
  ADD COLUMN categoriaIdAsaasCob INT NULL AFTER atendenteIdAsaasCob,
  ADD COLUMN comissionavelOverrideAsaasCob TINYINT(1) NULL AFTER categoriaIdAsaasCob;

CREATE INDEX asaas_cob_atendente_pag_idx
  ON asaas_cobrancas (escritorioIdAsaasCob, atendenteIdAsaasCob, dataPagamentoAsaas);

-- ─────────────────────────────────────────────────────────────────────────────
-- Categorias de cobrança (com flag de comissão)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categorias_cobranca (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdCatCob INT NOT NULL,
  nomeCatCob VARCHAR(80) NOT NULL,
  comissionavelCatCob TINYINT(1) NOT NULL DEFAULT 1,
  ativoCatCob TINYINT(1) NOT NULL DEFAULT 1,
  createdAtCatCob TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  UNIQUE KEY cat_cob_escr_nome_uq (escritorioIdCatCob, nomeCatCob)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Categorias de despesa
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categorias_despesa (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdCatDesp INT NOT NULL,
  nomeCatDesp VARCHAR(80) NOT NULL,
  ativoCatDesp TINYINT(1) NOT NULL DEFAULT 1,
  createdAtCatDesp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  UNIQUE KEY cat_desp_escr_nome_uq (escritorioIdCatDesp, nomeCatDesp)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Despesas (contas a pagar)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS despesas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdDesp INT NOT NULL,
  categoriaIdDesp INT NULL,
  descricaoDesp VARCHAR(200) NOT NULL,
  valorDesp DECIMAL(12, 2) NOT NULL,
  vencimentoDesp VARCHAR(10) NOT NULL,
  dataPagamentoDesp VARCHAR(10) NULL,
  statusDesp ENUM('pendente', 'pago', 'vencido') NOT NULL DEFAULT 'pendente',
  recorrenciaDesp ENUM('nenhuma', 'mensal', 'anual') NOT NULL DEFAULT 'nenhuma',
  observacoesDesp TEXT NULL,
  criadoPorUserIdDesp INT NOT NULL,
  createdAtDesp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updatedAtDesp TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX desp_escr_venc_idx (escritorioIdDesp, vencimentoDesp),
  INDEX desp_escr_status_idx (escritorioIdDesp, statusDesp)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Regra global de comissão (singleton por escritório)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regra_comissao (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdRegraCom INT NOT NULL,
  aliquotaPercentRegraCom DECIMAL(5, 2) NOT NULL DEFAULT 0,
  valorMinimoCobRegraCom DECIMAL(12, 2) NOT NULL DEFAULT 0,
  updatedAtRegraCom TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  UNIQUE KEY regra_com_escritorio_uq (escritorioIdRegraCom)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Comissões fechadas (snapshot imutável)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comissoes_fechadas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdComFech INT NOT NULL,
  atendenteIdComFech INT NOT NULL,
  periodoInicioComFech VARCHAR(10) NOT NULL,
  periodoFimComFech VARCHAR(10) NOT NULL,
  totalBrutoRecebidoComFech DECIMAL(14, 2) NOT NULL,
  totalComissionavelComFech DECIMAL(14, 2) NOT NULL,
  totalNaoComissionavelComFech DECIMAL(14, 2) NOT NULL,
  totalComissaoComFech DECIMAL(14, 2) NOT NULL,
  aliquotaUsadaComFech DECIMAL(5, 2) NOT NULL,
  valorMinimoUsadoComFech DECIMAL(12, 2) NOT NULL,
  fechadoEmComFech TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  fechadoPorUserIdComFech INT NOT NULL,
  observacoesComFech TEXT NULL,
  INDEX com_fech_escr_atendente_idx (escritorioIdComFech, atendenteIdComFech)
);

CREATE TABLE IF NOT EXISTS comissoes_fechadas_itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  comissaoFechadaIdItem INT NOT NULL,
  asaasCobrancaIdItem INT NOT NULL,
  valorItem DECIMAL(12, 2) NOT NULL,
  foiComissionavelItem TINYINT(1) NOT NULL,
  motivoExclusaoItem VARCHAR(32) NULL,
  INDEX com_fech_itens_idx (comissaoFechadaIdItem)
);
