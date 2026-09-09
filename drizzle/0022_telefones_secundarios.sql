-- Migration: telefones secundários nos contatos
-- Permite cadastrar mais de um número por contato (principal + secundários).
-- A busca de contato por telefone agora verifica os 3 campos:
-- telefoneContato (principal), telefonesSecundarios (JSON array), telefonesAnteriores (histórico CSV).

-- Sem `AFTER telefonesAnteriores`: a posição da coluna é cosmética e
-- criava dependência real. Quem adiciona `telefonesAnteriores` é o
-- `ensureContatoColumns`, que roda DEPOIS do laço de migrations — em
-- banco novo esta linha falhava, a migration não era marcada como
-- aplicada, e o boot terminava sem `telefonesSecundarios`: health check
-- verde e todo INSERT de contato morrendo com "Unknown column".
ALTER TABLE contatos ADD COLUMN telefonesSecundarios TEXT NULL;
