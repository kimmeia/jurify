-- Migration: vínculo cliente↔agendamento
-- Permite que o "responsável do cliente" veja agendamentos do seu cliente
-- mesmo sem ter sido criador/responsavel direto do compromisso.
-- Usado por router-agenda.ts no filtro verProprios.

ALTER TABLE agendamentos ADD COLUMN contatoIdAgend INT NULL AFTER statusAgendamento;

-- Index pra acelerar a query de filtro por cliente
CREATE INDEX idx_agendamentos_contato ON agendamentos(contatoIdAgend);
