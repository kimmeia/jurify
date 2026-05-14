-- UNIQUE em `(escritorioIdAsaasCli, asaasCustomerId)` em asaas_clientes.
--
-- Contexto: a tabela permitia múltiplas linhas pro mesmo customer dentro
-- do mesmo escritório. Bugs históricos no fluxo de vincularContato e em
-- data imports criavam duplicatas que faziam o cron `syncCobrancasEscritorio`
-- chamar o `/payments` do Asaas N vezes pro mesmo customer — dobrando
-- consumo de cota do rate guard. Pior: cada iteração faz UPDATE no
-- `contatoIdAsaasCob` das cobranças do customer pra apontar pra essa
-- vínculo, então cobranças oscilavam entre contatos a cada cron run.
--
-- O comentário do schema original ("pode haver N linhas com o mesmo
-- contatoId, uma para cada asaasCustomerId") explicita o caso N:1
-- (contato → N customers do Asaas com mesmo CPF). O caso inverso (1
-- customer → N contatos) é sempre bug — corrigido aqui.
--
-- Cleanup das duplicatas existentes (PRÉ-condição pra criar a UNIQUE):
--   Por (escritorioId, customerId), escolhe UM "sobrevivente":
--     1º critério: primarioAsaasCli=TRUE  (vínculo "oficial" pra criar
--                  novas cobranças)
--     2º critério: ativo=TRUE             (não foi soft-disabled por 403)
--     3º critério: menor id               (mais antigo = referência primária
--                                          em código antigo, preserva
--                                          continuidade de contatoId)
--
-- Antes do DELETE, re-aponta cobranças daquele customer pra contatoId
-- do sobrevivente. Isso evita orfanização quando as N linhas estão em
-- contatoIds diferentes. Caso comum (mesma contatoId nas duplicatas) é
-- um UPDATE no-op.
--
-- Idempotente:
--   - UPDATE com filtro pareado vira no-op em tabelas já limpas
--   - DELETE só remove se houver duplicatas
--   - ADD UNIQUE INDEX é capturado como "duplicate key name" pelo
--     auto-migrate quando rerun

-- 1. Re-aponta cobranças dos perdedores pro contatoId do sobrevivente.
--    Para cada par (d1, d2) onde d1 é o sobrevivente E d2 o perdedor,
--    atualiza cobranças cujo contatoId atual = d2.contatoId.
UPDATE asaas_cobrancas c
INNER JOIN asaas_clientes d2
  ON c.escritorioIdAsaasCob = d2.escritorioIdAsaasCli
  AND c.asaasCustomerIdCob = d2.asaasCustomerId
  AND c.contatoIdAsaasCob = d2.contatoIdAsaas
INNER JOIN asaas_clientes d1
  ON d1.escritorioIdAsaasCli = d2.escritorioIdAsaasCli
  AND d1.asaasCustomerId = d2.asaasCustomerId
  AND d1.id <> d2.id
SET c.contatoIdAsaasCob = d1.contatoIdAsaas
WHERE (
  (d1.primarioAsaasCli = TRUE AND d2.primarioAsaasCli = FALSE)
  OR (
    d1.primarioAsaasCli = d2.primarioAsaasCli
    AND d1.ativo = TRUE AND d2.ativo = FALSE
  )
  OR (
    d1.primarioAsaasCli = d2.primarioAsaasCli
    AND d1.ativo = d2.ativo
    AND d1.id < d2.id
  )
);

-- 2. Deleta os vínculos perdedores (mesma lógica de escolha).
DELETE d2 FROM asaas_clientes d2
INNER JOIN asaas_clientes d1
  ON d1.escritorioIdAsaasCli = d2.escritorioIdAsaasCli
  AND d1.asaasCustomerId = d2.asaasCustomerId
  AND d1.id <> d2.id
WHERE (
  (d1.primarioAsaasCli = TRUE AND d2.primarioAsaasCli = FALSE)
  OR (
    d1.primarioAsaasCli = d2.primarioAsaasCli
    AND d1.ativo = TRUE AND d2.ativo = FALSE
  )
  OR (
    d1.primarioAsaasCli = d2.primarioAsaasCli
    AND d1.ativo = d2.ativo
    AND d1.id < d2.id
  )
);

-- 3. ADD UNIQUE — próximas tentativas de duplicar falham com ER_DUP_ENTRY.
ALTER TABLE asaas_clientes
  ADD UNIQUE INDEX asaas_cli_escr_customer_uq (escritorioIdAsaasCli, asaasCustomerId);
