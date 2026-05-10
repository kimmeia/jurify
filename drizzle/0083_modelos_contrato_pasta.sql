-- Migration 0083: pastas hierárquicas em modelos de contrato
--
-- Por que existe: escritórios com 50+ modelos têm lista flat muito longa.
-- User pediu organização por tipo (contrato, petição, procuração) +
-- hierarquia (Trabalhista/Ações, Imobiliário/Contratos, etc).
--
-- MVP sem tabela `pastas` separada: pastas "existem" implicitamente porque
-- têm modelos dentro. Path armazenado como string ("Contratos/Honorários")
-- com separador `/`. NULL = "raiz" (sem pasta).
--
-- Quando precisar de metadados de pasta (cor, ícone, ordem), criar tabela
-- dedicada. Por ora, simplicidade.
--
-- Índice em `pasta` pra `SELECT DISTINCT pasta` (autocomplete da UI) e
-- filtros rápidos por path.

ALTER TABLE modelos_contrato
  ADD COLUMN pasta VARCHAR(255) DEFAULT NULL;

CREATE INDEX idx_modct_pasta ON modelos_contrato (pasta);
