-- Encerramento/cancelamento de serviço do cliente.
-- Aditivo e non-destrutivo: default 'ativo' cobre todas as linhas existentes.
ALTER TABLE contatos
  ADD COLUMN situacaoServico ENUM('ativo', 'encerrado', 'cancelado') NOT NULL DEFAULT 'ativo';

ALTER TABLE contatos
  ADD COLUMN servicoEncerradoEm TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE contatos
  ADD COLUMN servicoEncerradoMotivo VARCHAR(500) NULL DEFAULT NULL;

-- colaboradorId de quem encerrou (auditoria). Sem FK pra manter o insert leve
-- e consistente com as outras colunas de contatos.
ALTER TABLE contatos
  ADD COLUMN servicoEncerradoPor INT NULL DEFAULT NULL;
