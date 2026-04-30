-- 0040_colunas_pendentes: ALTER TABLE pendentes de PRs anteriores
-- (#142, #144, #145) que adicionaram colunas no drizzle/schema.ts mas
-- esqueceram de criar .sql de migration. Sem essas colunas, queries
-- Drizzle quebram com "Unknown column" e a listagem de clientes
-- retorna vazio (cliente "some" da UI).
--
-- Idempotente via auto-migrate: erro "Duplicate column" é tratado
-- como harmless na função `isHarmlessError`.

-- PR #142 — comissoes_fechadas.despesaId
ALTER TABLE comissoes_fechadas ADD COLUMN despesaIdComFech INT NULL;

-- PR #144 — campos_personalizados_cliente.mostrarCadastro
ALTER TABLE campos_personalizados_cliente ADD COLUMN mostrarCadastroCpc TINYINT(1) NOT NULL DEFAULT 1;

-- PR #145 — qualificação civil + endereço em contatos
ALTER TABLE contatos ADD COLUMN profissaoContato VARCHAR(100) NULL;
ALTER TABLE contatos ADD COLUMN estadoCivilContato ENUM('solteiro','casado','divorciado','viuvo','uniao_estavel') NULL;
ALTER TABLE contatos ADD COLUMN nacionalidadeContato VARCHAR(50) NULL;
ALTER TABLE contatos ADD COLUMN cepContato VARCHAR(9) NULL;
ALTER TABLE contatos ADD COLUMN logradouroContato VARCHAR(200) NULL;
ALTER TABLE contatos ADD COLUMN numeroEnderecoContato VARCHAR(20) NULL;
ALTER TABLE contatos ADD COLUMN complementoContato VARCHAR(100) NULL;
ALTER TABLE contatos ADD COLUMN bairroContato VARCHAR(100) NULL;
ALTER TABLE contatos ADD COLUMN cidadeContato VARCHAR(100) NULL;
ALTER TABLE contatos ADD COLUMN ufContato VARCHAR(2) NULL;
