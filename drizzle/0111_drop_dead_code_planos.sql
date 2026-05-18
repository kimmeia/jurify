-- Migration 0111: drop do dead code do sistema antigo de planos (Fase 5)
--
-- Remove campos/tabelas legados que ficaram no banco mas não são mais
-- consumidos por nenhum código (validado via grep + typecheck).
--
-- 1. `escritorios.planoAtendimento` + `maxColaboradores` + `maxConexoesWhatsapp`
--    Substituídos por leitura dinâmica de `subscriptions.planId` →
--    `planos.max_usuarios` / `max_conexoes_whatsapp` (Fase 4).
--
-- 2. Tabela `planos_overrides`
--    Substituída pela tabela `planos` (Fase 0) que é a fonte de verdade
--    única editável pelo admin.

ALTER TABLE escritorios
  DROP COLUMN planoAtendimento,
  DROP COLUMN maxColaboradores,
  DROP COLUMN maxConexoesWhatsapp;

DROP TABLE IF EXISTS planos_overrides;
