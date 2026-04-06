-- =====================================================
-- Migration: Sistema de Permissões Customizáveis
-- Executar: mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME < drizzle/0004_permissoes.sql
-- =====================================================

-- Cargos personalizados criados pelo dono do escritório
CREATE TABLE IF NOT EXISTS cargos_personalizados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioId INT NOT NULL,
  nome VARCHAR(64) NOT NULL,
  descricao VARCHAR(255),
  cor VARCHAR(20) DEFAULT '#6366f1',
  isDefault BOOLEAN NOT NULL DEFAULT false,
  createdAtCargo TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updatedAtCargo TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_cargos_escritorio (escritorioId),
  UNIQUE KEY uq_cargo_nome_escritorio (escritorioId, nome)
);

-- Permissões por cargo (granular por módulo)
CREATE TABLE IF NOT EXISTS permissoes_cargo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cargoId INT NOT NULL,
  modulo VARCHAR(32) NOT NULL,
  ver_todos BOOLEAN NOT NULL DEFAULT false,
  ver_proprios BOOLEAN NOT NULL DEFAULT false,
  criar BOOLEAN NOT NULL DEFAULT false,
  editar BOOLEAN NOT NULL DEFAULT false,
  excluir BOOLEAN NOT NULL DEFAULT false,
  INDEX idx_permissoes_cargo (cargoId),
  UNIQUE KEY uq_permissao_modulo (cargoId, modulo)
);

-- Adicionar campo cargoPersonalizadoId na tabela colaboradores
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS cargoPersonalizadoId INT AFTER cargo;
ALTER TABLE colaboradores ADD INDEX IF NOT EXISTS idx_colab_cargo_custom (cargoPersonalizadoId);
