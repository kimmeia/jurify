-- Remove o canal legado whatsapp_qr (Baileys) do enum. Migra rows remanescentes
-- pra whatsapp_api antes do MODIFY (o dono confirmou que não há QR em uso).
UPDATE canais_integrados SET tipoCanal = 'whatsapp_api' WHERE tipoCanal = 'whatsapp_qr';
ALTER TABLE canais_integrados MODIFY COLUMN tipoCanal ENUM('whatsapp_api','instagram','facebook','telefone_voip','calcom','chatgpt','claude') NOT NULL;
