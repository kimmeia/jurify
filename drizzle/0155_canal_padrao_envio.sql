-- Número de envio padrão do escritório entre os canais WhatsApp oficiais
-- (Cloud API). Com mais de um número conectado, o envio de template/interativo/
-- SmartFlow escolhia o "primeiro" arbitrariamente (getCanalCloudApi sem ORDER
-- BY). Esta flag deixa o dono escolher POR QUAL número as mensagens saem.
-- Exclusiva por escritório (só um canal marcado por vez); o envio prioriza o
-- marcado E conectado, com fallback determinístico pro conectado de menor id.
ALTER TABLE `canais_integrados` ADD COLUMN `padraoEnvio` boolean NOT NULL DEFAULT false;
