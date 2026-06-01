-- Resumo IA de movimentações judiciais.
--
-- eventos_processo.resumo_ia: resumo curto (pt-BR) gerado por IA do
-- conteúdo da movimentação, usado nas notificações pra dar contexto sem
-- exigir que o user abra o processo. NULL = não foi gerado (modelo
-- indisponível, timeout, ou conteúdo não justifica resumo).
--
-- escritorios.motor_resumo_modelo: modelo de IA que o escritório quer usar
-- pra gerar o resumo. Prefixo do nome determina o provider:
--   - "gpt-*" → OpenAI (ex: "gpt-4o-mini" — default)
--   - "claude-*" → Anthropic (ex: "claude-haiku-4-5-20251001")
-- NULL = usa o default global do código (gpt-4o-mini).
--
-- Ambas as colunas são non-destructive: rows existentes ficam com NULL
-- sem precisar backfill.

ALTER TABLE eventos_processo
  ADD COLUMN resumo_ia TEXT DEFAULT NULL;

ALTER TABLE escritorios
  ADD COLUMN motor_resumo_modelo VARCHAR(64) DEFAULT NULL;
