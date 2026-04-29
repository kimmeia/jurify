-- 0034_despesas_semanal: adiciona "semanal" no enum recorrenciaDesp.
-- Antes só tinha "nenhuma", "mensal", "anual" — agora suporta também
-- recorrência semanal (despesas que vencem toda semana).
--
-- ALTER MODIFY COLUMN com novo enum funciona em qualquer MySQL.
-- Idempotente. Itens existentes mantêm valor.

ALTER TABLE despesas
  MODIFY COLUMN recorrenciaDesp
  ENUM('nenhuma','semanal','mensal','anual')
  NOT NULL DEFAULT 'nenhuma';
