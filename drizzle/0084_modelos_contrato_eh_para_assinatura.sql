-- Migration 0084: flag pra marcar modelos que são contratos pra assinatura
--
-- Por que existe: hoje o modal "Gerar contrato" no detalhe do cliente
-- mostra TODOS os modelos da tabela `modelos_contrato`. Mas a tabela
-- guarda também petições, pareceres, procurações, etc. — só uns devem
-- aparecer no fluxo de "Gerar contrato pra assinatura".
--
-- Flag ehParaAssinatura: marcado manualmente pelo admin quando cria/edita
-- modelo. Frontend filtra no GerarContratoDialog por essa flag.
--
-- Default FALSE: retro-compat. Modelos antigos não eram pensados pra
-- assinatura — admin marca explicitamente os que devem virar contrato.
--
-- Índice composto (escritorioId, ehParaAssinatura): suporta query
-- "modelos do meu escritório que são pra assinatura" sem table scan.

ALTER TABLE modelos_contrato
  ADD COLUMN ehParaAssinatura BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_modct_eh_para_assinatura
  ON modelos_contrato (escritorioId, ehParaAssinatura);
