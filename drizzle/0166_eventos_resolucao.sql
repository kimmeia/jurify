-- Desfecho dos cards de "nova ação" no feed de Processos.
--
-- Antes só havia `lido` (bool): clicar "Monitorar" não marcava nada, então o
-- card ficava "NOVO" pra sempre e o time não sabia se já fora tratado. Agora
-- todo card tem um desfecho terminal (monitorando/lida/falso) + quem/quando.
--
-- Pendentes na UI = resolucaoEvento='pendente' AND lido=0. O cron continua
-- gravando lido=1 pra SILENCIAR baseline/polo-ativo/pré-cadastro (esses ficam
-- pendente+lido, fora das Pendentes E das Resolvidas) — comportamento
-- preservado. Backfill: cards já lidos por ação humana viram 'lida' pra não
-- reaparecerem nas Pendentes. (Não dá pra distinguir silenciado-cron de
-- lido-humano no histórico, então tratamos todo lido antigo como resolvido —
-- non-destrutivo: no pior caso um card silenciado aparece em "Resolvidas".)
ALTER TABLE eventos_processo
  ADD COLUMN resolucaoEvento ENUM('pendente','monitorando','lida','falso') NOT NULL DEFAULT 'pendente';
ALTER TABLE eventos_processo ADD COLUMN resolvidoPorUserIdEvento INT DEFAULT NULL;
ALTER TABLE eventos_processo ADD COLUMN resolvidoEmEvento TIMESTAMP NULL DEFAULT NULL;

UPDATE eventos_processo
  SET resolucaoEvento = 'lida', resolvidoEmEvento = createdAtEvento
  WHERE tipoEvento = 'nova_acao' AND lido = 1;
