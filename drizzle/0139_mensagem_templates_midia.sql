-- Mídia opcional em mensagem_templates. Permite criar template "Boas vindas
-- + foto da equipe" ou "Honorários + PDF da tabela". Path local
-- (/uploads/...) ou URL pública.
ALTER TABLE mensagem_templates
  ADD COLUMN midiaUrlTpl VARCHAR(512) NULL,
  ADD COLUMN midiaTipoTpl ENUM('imagem', 'video', 'audio', 'documento') NULL;
