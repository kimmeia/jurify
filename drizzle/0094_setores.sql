-- Migration 0094: setores próprios + vínculo opcional em colaboradores.
--
-- Hoje `colaboradores.departamento` é texto livre. Pra "Setor" ser
-- gerenciável como os Cargos Personalizados (criar/editar/excluir
-- centralmente, dropdown com lista consistente) — vira tabela própria.
--
-- Retrocompat: `colaboradores.departamento` permanece. Quando o
-- colaborador for editado pela nova UI, salva também `setorId`. Listagens
-- preferem `setor.nome` (via FK) e caem em `departamento` como fallback
-- enquanto não houver migração explícita do legado.

CREATE TABLE setores (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  escritorioIdSet INT NOT NULL,
  nomeSet VARCHAR(64) NOT NULL,
  descricaoSet VARCHAR(255) NULL DEFAULT NULL,
  corSet VARCHAR(20) NOT NULL DEFAULT '#6366f1',
  createdAtSet TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtSet TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY setores_escr_nome_uq (escritorioIdSet, nomeSet)
);

ALTER TABLE colaboradores
  ADD COLUMN setorIdCol INT NULL DEFAULT NULL;

CREATE INDEX colab_setor_idx ON colaboradores (setorIdCol);
