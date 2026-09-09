-- Situação da credencial por TRIBUNAL **e GRAU**.
--
-- Achado do dono (31/08): no PJe o acesso costuma ser separado por 1º e 2º
-- grau. A validação do Cofre sempre entrou no 1º, e o registro era por
-- tribunal — então "TJRJ validado" não dizia nada sobre o 2º grau, e o cron,
-- que consulta o 2º quando detecta que o processo subiu, falhava calado.
--
-- Aditiva: DEFAULT 1 marca todo registro existente como sendo do 1º grau, que
-- é exatamente o que ele mediu. A UNIQUE precisa incluir o grau, senão a
-- primeira validação de 2º grau sobrescreveria o resultado do 1º.

ALTER TABLE cofre_credencial_tribunais
  ADD COLUMN grauCT TINYINT NOT NULL DEFAULT 1;

ALTER TABLE cofre_credencial_tribunais DROP INDEX uq_cofre_cred_tribunal;

CREATE UNIQUE INDEX uq_cofre_cred_tribunal
  ON cofre_credencial_tribunais (credencialIdCT, tribunalCT, grauCT);
