-- "Avisar quando chegar" passa a avisar de verdade: o painel admin manda o
-- e-mail "entrou na cobertura" pra fila de um tribunal e marca quem já foi
-- avisado — NULL é quem ainda espera.
ALTER TABLE interesse_tribunais
  ADD COLUMN avisadoEmIntTrib TIMESTAMP NULL DEFAULT NULL;
