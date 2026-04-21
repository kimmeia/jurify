-- Migration: suporte a múltiplos customers Asaas por contato CRM.
--
-- Contexto: o Asaas permite múltiplos cadastros de customer com o mesmo
-- CPF/CNPJ (regra de unicidade fraca). Isso gera duplicatas quando o
-- cadastro foi criado por outras rotas (webhook antigo, import, cadastro
-- manual). No nosso lado unificamos tudo sob UM contato do CRM: o contato
-- passa a poder ter N linhas em asaas_clientes, uma por asaasCustomerId.
--
-- O campo `primarioAsaasCli` marca qual customer é usado para CRIAR novas
-- cobranças (só um primário por contato). Os demais (primarioAsaasCli=0)
-- servem apenas para puxar cobranças históricas.
--
-- Existing rows: default 1 → todas viram primárias (comportamento atual).

ALTER TABLE asaas_clientes
  ADD COLUMN primarioAsaasCli TINYINT(1) NOT NULL DEFAULT 1
  AFTER nomeAsaasCli;
