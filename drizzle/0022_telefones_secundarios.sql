-- Migration: telefones secundários nos contatos
-- Permite cadastrar mais de um número por contato (principal + secundários).
-- A busca de contato por telefone agora verifica os 3 campos:
-- telefoneContato (principal), telefonesSecundarios (JSON array), telefonesAnteriores (histórico CSV).

ALTER TABLE contatos ADD COLUMN telefonesSecundarios TEXT NULL AFTER telefonesAnteriores;
