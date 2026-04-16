-- Migration: tetos legais com timeline (vigência temporal)
-- Engine de cálculos busca o teto vigente na data do contrato em vez de
-- usar valor hardcoded "de hoje" — evita aplicar norma nova retroativamente.

CREATE TABLE IF NOT EXISTS tetos_legais (
  id INT AUTO_INCREMENT PRIMARY KEY,
  categoriaTetoLeg VARCHAR(64) NOT NULL,
  tetoMensalLeg VARCHAR(20) NOT NULL,
  fundamentoLeg VARCHAR(512) NOT NULL,
  vigenciaDeLeg VARCHAR(10) NOT NULL,
  vigenciaAteLeg VARCHAR(10) NULL,
  observacaoLeg TEXT NULL,
  createdAtTetoLeg TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,

  INDEX idx_tetos_categoria_vigencia (categoriaTetoLeg, vigenciaDeLeg)
);

-- ═══════════════════════════════════════════════════════════════════════
-- SEED: Apenas tetos com certeza documental. NÃO inventamos valores
-- históricos que não foram verificados com a norma original.
--
-- Para contratos ANTERIORES ao vigenciaDe mais antigo de cada categoria,
-- o engine usa a regra geral (1,5× BACEN) com nota no parecer.
-- ═══════════════════════════════════════════════════════════════════════

-- Cheque especial: 8% a.m. (Resolução CMN 4.765/2019)
-- Vigente desde 06/01/2020. Antes: sem teto específico.
INSERT INTO tetos_legais (categoriaTetoLeg, tetoMensalLeg, fundamentoLeg, vigenciaDeLeg, vigenciaAteLeg, observacaoLeg)
VALUES ('cheque_especial', '8.0000', 'Resolução CMN 4.765/2019 — Teto de 8% a.m. para cheque especial', '2020-01-06', NULL, 'Aplica-se a PF e MEI. Instituições financeiras podem cobrar menos.');

-- Consignado INSS: 1,85% a.m. (Resolução CNPS 1.368/2025)
-- Vigente desde março/2025. Tetos anteriores variaram — não inserimos
-- por não termos verificado cada resolução CNPS individualmente.
INSERT INTO tetos_legais (categoriaTetoLeg, tetoMensalLeg, fundamentoLeg, vigenciaDeLeg, vigenciaAteLeg, observacaoLeg)
VALUES ('consignado_inss', '1.8500', 'Resolução CNPS 1.368/2025 — Teto de 1,85% a.m. para consignado INSS', '2025-03-01', NULL, 'Aposentados e pensionistas do RGPS. Tetos anteriores variaram por resolução — verificar norma vigente na data do contrato.');

-- Consignado servidor público federal: 1,80% a.m. (Portaria MGI dez/2023)
INSERT INTO tetos_legais (categoriaTetoLeg, tetoMensalLeg, fundamentoLeg, vigenciaDeLeg, vigenciaAteLeg, observacaoLeg)
VALUES ('consignado_servidor', '1.8000', 'Portaria MGI (dez/2023) — Teto de 1,80% a.m. para consignado SIAPE', '2023-12-01', NULL, 'Servidores públicos federais ativos, aposentados e pensionistas (SIAPE).');

-- Cartão de crédito rotativo: juros acumulados max 100% do principal (Lei 14.690/2023)
-- Vigente desde 03/01/2024.
INSERT INTO tetos_legais (categoriaTetoLeg, tetoMensalLeg, fundamentoLeg, vigenciaDeLeg, vigenciaAteLeg, observacaoLeg)
VALUES ('cartao_credito_100pct', '0', 'Lei 14.690/2023 — Juros acumulados não podem exceder 100% do valor principal', '2024-01-03', NULL, 'Aplica-se ao rotativo e parcelamento de fatura. O teto é sobre juros ACUMULADOS, não taxa mensal — engine trata como verificação especial.');
