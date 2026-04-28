-- Migration: Comissão progressiva por faixas (cumulativo).
--
-- Contexto: o módulo Financeiro Plus inicial tinha comissão flat (1 alíquota
-- global). Esta migration adiciona o modo "faixas" — uma tabela onde o usuário
-- define limites de faturamento e a alíquota correspondente. O modelo é
-- CUMULATIVO: a faixa atingida pelo total recebido define a alíquota aplicada
-- sobre toda a base (não marginal).
--
-- A `regra_comissao` ganha 2 colunas: `modo` (flat|faixas) e `baseFaixa`
-- (bruto|comissionavel) — a base que classifica a faixa pode ser todo o recebido
-- ou apenas o recebido comissionável.
--
-- O snapshot `comissoes_fechadas` ganha campos espelho para preservar a
-- imutabilidade do histórico mesmo após mudanças na regra atual.

-- ─────────────────────────────────────────────────────────────────────────────
-- regra_comissao: modo + baseFaixa
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE regra_comissao
  ADD COLUMN modoRegraCom ENUM('flat', 'faixas') NOT NULL DEFAULT 'flat'
    AFTER aliquotaPercentRegraCom;

ALTER TABLE regra_comissao
  ADD COLUMN baseFaixaRegraCom ENUM('bruto', 'comissionavel') NOT NULL DEFAULT 'comissionavel'
    AFTER modoRegraCom;

-- ─────────────────────────────────────────────────────────────────────────────
-- regra_comissao_faixas: tabela de faixas (1 linha = 1 faixa)
-- A faixa é definida pela cota superior (`limiteAteFaixa`); a inferior é a cota
-- da faixa anterior. A última faixa pode ter `limiteAteFaixa NULL` para "infinito".
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regra_comissao_faixas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdFaixa INT NOT NULL,
  ordemFaixa INT NOT NULL,
  limiteAteFaixa DECIMAL(14, 2) NULL,
  aliquotaPercentFaixa DECIMAL(5, 2) NOT NULL,
  createdAtFaixa TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX faixa_escr_ordem_idx (escritorioIdFaixa, ordemFaixa)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- comissoes_fechadas: snapshot do modo + base + tabela de faixas usada
-- `faixasUsadasComFech` guarda JSON com o conteúdo da tabela vigente no momento
-- do fechamento (ex: [{"limiteAte":20000,"aliquota":4},{"limiteAte":null,"aliquota":5}]).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE comissoes_fechadas
  ADD COLUMN modoUsadoComFech ENUM('flat', 'faixas') NOT NULL DEFAULT 'flat'
    AFTER aliquotaUsadaComFech;

ALTER TABLE comissoes_fechadas
  ADD COLUMN baseFaixaUsadaComFech ENUM('bruto', 'comissionavel') NULL
    AFTER modoUsadoComFech;

ALTER TABLE comissoes_fechadas
  ADD COLUMN faixasUsadasComFech TEXT NULL
    AFTER baseFaixaUsadaComFech;
