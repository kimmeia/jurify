-- 0033_convite_cargo_personalizado: muda convites_colaborador.cargoConvite
-- de enum pra varchar pra aceitar tanto cargos default ("gestor",
-- "atendente", "estagiario") quanto nomes de cargos personalizados
-- criados pelo escritório (ex: "advogados", "secretaria").
--
-- Backend valida em runtime que o nome corresponde a um default OU a um
-- cargo personalizado existente daquele escritório.
--
-- A função aceitarConvite (db-escritorio.ts) já resolve cargoPersonalizadoId
-- por NOME quando o convite é aceito — sem mudança nela.
--
-- ALTER MODIFY COLUMN é compatível com qualquer MySQL e idempotente
-- (rodar 2x não dá erro).

ALTER TABLE convites_colaborador
  MODIFY COLUMN cargoConvite VARCHAR(64) NOT NULL;
