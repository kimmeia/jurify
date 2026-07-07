-- Cache do TEXTO extraído/transcrito de cada documento do cliente, pro Agente
-- Jurídico ler o conteúdo na conversa sem reprocessar (extração/Vision) a cada
-- mensagem. Aditivo e nullable: NULL = ainda não lido (lê e cacheia na 1ª vez).
ALTER TABLE `cliente_arquivos` ADD COLUMN `conteudo` text DEFAULT NULL;
ALTER TABLE `cliente_arquivos` ADD COLUMN `conteudoEm` timestamp NULL DEFAULT NULL;
