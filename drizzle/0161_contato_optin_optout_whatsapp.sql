-- Opt-out de mensagens proativas no WhatsApp (exigência literal da política
-- da Meta: honrar pedidos de descadastro por qualquer canal) + rastro
-- documental de opt-in (LGPD). Defaults non-destrutivos pra rows antigas.
-- O gate de envio NÃO muda; opt-out só bloqueia disparos proativos.

ALTER TABLE contatos ADD COLUMN optOutWhatsapp BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contatos ADD COLUMN optOutWhatsappEm TIMESTAMP NULL;
ALTER TABLE contatos ADD COLUMN optOutWhatsappOrigem VARCHAR(128) NULL;
ALTER TABLE contatos ADD COLUMN optInWhatsappEm TIMESTAMP NULL;
ALTER TABLE contatos ADD COLUMN optInWhatsappOrigem VARCHAR(128) NULL;
