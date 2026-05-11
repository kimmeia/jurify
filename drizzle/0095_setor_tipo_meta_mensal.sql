-- Migration 0095: foundation pra dashboards de Comercial e Produção.
--
-- Adiciona "tipo" ao setor pra que o sistema identifique automaticamente
-- quais setores são do tipo comercial (fechamento de vendas) ou operacional
-- (execução/produção). Cada aba de relatório usa esse tipo pra popular
-- dropdowns de atendente apenas com quem está no tipo certo.
--
-- Adiciona "metaMensal" ao colaborador — usado no dashboard Comercial pra
-- mostrar progresso (R$ atingido / meta) por atendente.
--
-- Aditiva, defaults seguros. Setores existentes recebem tipo='outro' (não
-- aparece nos filtros de Comercial/Produção até ser reclassificado pelo
-- admin). Colaboradores sem meta = null (UI mostra "sem meta").

ALTER TABLE setores
  ADD COLUMN tipoSet ENUM('comercial', 'operacional', 'suporte', 'financeiro', 'outro')
    NOT NULL DEFAULT 'outro';

ALTER TABLE colaboradores
  ADD COLUMN metaMensalCol DECIMAL(12, 2) NULL DEFAULT NULL;
