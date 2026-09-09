-- WhatsApp do cadastro (só dígitos, sem DDI — `normalizarWhatsappCadastro`).
-- Obrigatório pra conta nova de dono de escritório (e-mail/senha e Google);
-- contas antigas e colaboradores convidados ficam NULL de propósito.
ALTER TABLE users ADD COLUMN whatsapp VARCHAR(20) DEFAULT NULL;
