-- Corrige o backfill de fechadoEm da migration 0134.
--
-- Contexto: a 0134 fez backfill via updatedAt, que era o melhor sinal
-- disponível só no papel. Na prática, leads criados via "Cliente já
-- fechou contrato" (cadastro novo) ou via "Registrar Fechamento" (botão
-- no cliente) nascem direto como fechado_ganho — seu createdAt é
-- exatamente o momento (ou a data retroativa informada) do fechamento, e
-- não é afetado por edições posteriores. Edições POSTERIORES tocaram o
-- updatedAt, então o backfill anterior datou fechamentos de meses passados
-- como se fossem do mês atual.
--
-- Esse UPDATE sobrescreve TODOS os fechadoEm com createdAt, alinhado com
-- o ponto de criação do lead. A partir desta migration, novos
-- fechamentos passam por criarLead (que seta fechadoEm = createdAt) ou
-- atualizarLead (que seta fechadoEm = NOW() na transição via drag&drop),
-- então o campo continua preciso daqui pra frente.
UPDATE leads
SET fechadoEmLead = createdAtLead
WHERE etapaFunil IN ('fechado_ganho', 'fechado_perdido');
