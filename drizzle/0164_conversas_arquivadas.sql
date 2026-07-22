-- Pasta "Arquivadas" do Atendimento: conversa arquivada sai das abas,
-- contadores e busca padrão sem ser apagada (caso de uso: milhares de
-- conversas de canais banidos/desconectados). NULL = ativa — default
-- non-destrutivo pra todas as rows existentes. Mensagem nova do contato
-- desarquiva automaticamente (handler limpa o campo).

ALTER TABLE conversas ADD COLUMN arquivadaEmConv TIMESTAMP NULL DEFAULT NULL;
CREATE INDEX idx_conversas_arquivada ON conversas (escritorioIdConv, arquivadaEmConv);
