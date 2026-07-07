-- OAB do advogado responsável do escritório — sai no bloco de assinatura das
-- peças geradas pelo Agente Jurídico (parte do timbre). Aditivo e nullable.
ALTER TABLE `escritorios` ADD COLUMN `oab` varchar(32) DEFAULT NULL;
