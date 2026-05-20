-- Migration: campos a capturar pela IA durante a conversa.
--
-- Cada agente pode ter uma lista de campos personalizados do cliente
-- (`campos_personalizados_cliente.chave`) que ele deve tentar extrair
-- automaticamente das respostas do cliente. Quando a IA detecta o valor
-- na conversa, ele é gravado em `contatos.camposPersonalizados` (JSON).
--
-- Formato esperado em `agentes_ia.camposCaptura` (JSON):
--   ["valor_financiamento", "cpf_principal", "data_nascimento"]
--
-- Quando NULL ou array vazio = agente não extrai nada (default seguro).
--
-- Non-destrutivo: coluna NULLABLE permite agentes existentes seguirem
-- funcionando sem migração de dados.

ALTER TABLE agentes_ia
  ADD COLUMN camposCapturaAgente TEXT NULL
  COMMENT 'JSON array de chaves de campos personalizados que a IA deve extrair da conversa';
