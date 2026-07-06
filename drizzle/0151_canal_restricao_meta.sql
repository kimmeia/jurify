-- Disjuntor anti-spam do canal WhatsApp oficial. Quando a Meta restringe a
-- conta (erro 131031 "Business account has been locked" e afins — síncrono no
-- envio OU assíncrono no webhook de status `failed`), marcamos o canal como
-- restrito e PAUSAMOS novos templates até liberar, em vez de martelar a Meta
-- com envios que voltam bloqueados (o que piora a reputação e vira strike).
-- Auto-cura: um envio bem-sucedido (ou o botão "reativar") limpa a flag.
ALTER TABLE `canais_integrados` ADD COLUMN `restritoMeta` boolean NOT NULL DEFAULT false;
ALTER TABLE `canais_integrados` ADD COLUMN `restritoMotivo` varchar(512) DEFAULT NULL;
ALTER TABLE `canais_integrados` ADD COLUMN `restritoEm` timestamp NULL DEFAULT NULL;
