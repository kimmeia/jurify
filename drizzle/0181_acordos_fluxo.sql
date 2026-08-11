-- Acordos: fechamento datado, vínculo com a cobrança e próximo passo.
--
-- `fechadoEm` existe porque "fechados no mês" era calculado por `updatedAt`,
-- que muda em QUALQUER escrita na linha — o mesmo defeito já corrigido no
-- dashboard. Sem uma data própria do fechamento não há como recortar o mês
-- sem mentir.
--
-- `cobrancaId` fecha o buraco de um acordo fechado não virar dinheiro em lugar
-- nenhum: com ele dá pra listar "fechado sem cobrança gerada" em vez de
-- descobrir meses depois que ninguém cobrou.
--
-- `proximoPassoEm` + `tarefaRetornoId` são o antídoto pra negociação que morre
-- de silêncio. A tarefa é a fonte de verdade (tem responsável, prazo e some
-- quando concluída); a data aqui é cache de exibição pra lista não precisar
-- de JOIN em toda linha.
--
-- Todas nullable: acordo antigo não tinha nenhuma dessas informações e não dá
-- pra inventar retroativamente.

ALTER TABLE `acordos` ADD COLUMN `fechadoEmAcordo` TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE `acordos` ADD COLUMN `cobrancaIdAcordo` INT NULL DEFAULT NULL;
ALTER TABLE `acordos` ADD COLUMN `proximoPassoEmAcordo` TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE `acordos` ADD COLUMN `tarefaRetornoIdAcordo` INT NULL DEFAULT NULL;

-- Acordos já fechados antes desta migration: usa `updatedAt` como melhor
-- aproximação disponível. É impreciso pra quem foi editado depois de fechar,
-- mas menos errado que deixar NULL e sumir de todo recorte por período.
UPDATE `acordos` SET `fechadoEmAcordo` = `updatedAtAcordo`
  WHERE `statusAcordo` = 'fechado' AND `fechadoEmAcordo` IS NULL;
