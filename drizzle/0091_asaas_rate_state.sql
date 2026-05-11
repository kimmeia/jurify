-- Migration 0090: estado persistente do rate guard do Asaas.
--
-- A API do Asaas tem 3 limites simultâneos (docs.asaas.com):
--   1) `RateLimit-Limit` por endpoint (varia, vem no header da response)
--   2) 25.000 requests por janela rolante de 12h (cota global da API key)
--   3) 50 GETs simultâneos
--
-- O contador in-memory zera a cada restart/deploy — e como Railway recicla
-- o container com certa frequência, um histórico de 11h de uso poderia
-- "esquecer" 24.000 requests e o próximo tick estoura. Esta tabela
-- persiste o estado da cota 12h + headers de cada endpoint pra sobreviver
-- a restart.
--
-- 1 row por API key (identificada por hash sha256). Não armazena a key.
-- Atualizada pelo guard a cada ~50 requests (não em todas, pra reduzir
-- carga no DB) e relida no boot do AsaasClient.

CREATE TABLE asaas_rate_state (
  apiKeyHashRate VARCHAR(64) NOT NULL PRIMARY KEY,
  -- Cota 12h: início da janela atual em ms epoch.
  quotaWindowStartRate BIGINT NOT NULL,
  quotaCountRate INT NOT NULL DEFAULT 0,
  -- Último estado conhecido por endpoint:
  -- { "/payments": { "remaining": 12, "resetAt": 1730000000000 }, ... }
  lastEndpointLimitsRate JSON NOT NULL,
  createdAtRate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtRate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
