-- Migration 0074: adiciona cargo "sdr" (Sales Development Representative)
--
-- Sprint pós-Sprint-2 (08/05/2026): Bruno (Boyadjian Advogados) pediu cargo
-- SDR pra colaboradores comerciais. Comportamento:
--   - Atendente puro: bloqueado de relatórios (matriz preservada)
--   - SDR: vê próprios em relatórios + cria/edita leads no pipeline
--
-- Migração ALTER ENUM é segura — adiciona novo valor sem afetar registros
-- existentes.

ALTER TABLE colaboradores
  MODIFY COLUMN cargo
    ENUM('dono', 'gestor', 'atendente', 'estagiario', 'sdr')
    NOT NULL;
