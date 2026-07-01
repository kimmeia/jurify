-- Novos estados de situação do serviço: 'suspenso' (pausa temporária),
-- 'rescindido' (rescindido por nós) e 'executado' (execução judicial).
-- Aditivo no ENUM: valores existentes ('ativo','encerrado','cancelado')
-- continuam válidos; nenhuma linha é alterada.
ALTER TABLE contatos
  MODIFY COLUMN situacaoServico
    ENUM('ativo', 'suspenso', 'encerrado', 'cancelado', 'rescindido', 'executado')
    NOT NULL DEFAULT 'ativo';
