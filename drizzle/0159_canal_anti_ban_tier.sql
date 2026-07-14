-- Anti-ban: saúde do número (Meta) + contador diário persistido de disparos
-- iniciados pela empresa. Alinha o teto de envio ao messaging tier da Meta e
-- sobrevive a restart/multi-instância (o rate limit em memória só cobre rajada).
-- Todas as colunas com default non-destrutivo pra cobrir rows antigas.

ALTER TABLE canais_integrados ADD COLUMN qualidadeMeta VARCHAR(16) NULL;
ALTER TABLE canais_integrados ADD COLUMN tierMensagens VARCHAR(24) NULL;
ALTER TABLE canais_integrados ADD COLUMN disparosDia INT NOT NULL DEFAULT 0;
ALTER TABLE canais_integrados ADD COLUMN disparosDiaEm VARCHAR(10) NULL;
