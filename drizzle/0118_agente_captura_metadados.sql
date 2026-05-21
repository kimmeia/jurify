-- Metadados da última tentativa de captura automática de variáveis.
-- Usado pelo painel "Capturas IA" no chat pra mostrar status ("há 2min · ok"
-- ou "há 4min · timeout") e dar transparência ao atendente sobre o que rodou.
--
-- Non-destrutivo: defaults cobrem todas as rows antigas.

ALTER TABLE agentes_ia
  ADD COLUMN ultimaCapturaAtAgente TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN ultimoErroCapturaAgente VARCHAR(500) NULL DEFAULT NULL,
  ADD COLUMN ultimaCapturaNovosAgente INT NOT NULL DEFAULT 0;
