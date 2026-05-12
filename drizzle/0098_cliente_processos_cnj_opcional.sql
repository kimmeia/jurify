-- Permite cadastrar processos sem CNJ — casos não-judiciais
-- (consultoria, contratos, processos administrativos, extrajudiciais).
-- Já existe coluna `tipoCliProc` enum("extrajudicial","litigioso") desde
-- 0036, mas `numeroCnjCliProc` continuava NOT NULL e forçava CNJ falso.
ALTER TABLE cliente_processos MODIFY COLUMN numeroCnjCliProc VARCHAR(30) NULL;
