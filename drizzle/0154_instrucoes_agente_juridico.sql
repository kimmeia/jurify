-- Instruções personalizadas do escritório pro Agente Jurídico (tom, cláusulas
-- padrão, preferências de redação). Entram no system prompt além das regras
-- base. Aditivo e nullable.
ALTER TABLE `escritorios` ADD COLUMN `instrucoesAgenteJuridico` text DEFAULT NULL;
