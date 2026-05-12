-- Persistência de erro no sync de cobranças do Asaas.
--
-- Antes: `finalizarVinculacao` capturava erro do sync inicial e devolvia
-- só no response (`erroSync: <msg>`). A UI mostrava um toast.warning que
-- sumia em segundos — sem retry visível, sem rastreio. Cliente ficava com
-- vínculo criado mas sem cobranças, e o operador não tinha pista de POR QUE.
--
-- Mesmo padrão do `ultimoErro403Mensagem`: persistir o estado real
-- da integração no DB, conforme convenção de observabilidade do CLAUDE.md
-- ("Erros em integrações externas NÃO podem viver só no response").
--
-- Default NULL = sem erro. Quando o cron ou o sync manual concluir com
-- sucesso, zera (UPDATE … SET ultimoErroSync = NULL).
--
-- Idempotente: ALTER TABLE ADD COLUMN com IF NOT EXISTS sob o auto-migrate
-- (que tolera "duplicate column" como erro inofensivo).

ALTER TABLE asaas_clientes
  ADD COLUMN ultimoErroSync VARCHAR(500) DEFAULT NULL,
  ADD COLUMN ultimoErroSyncEm TIMESTAMP NULL DEFAULT NULL;
