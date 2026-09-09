-- Contrato cancelado (mockup `mockup-cancelados-contrato.html`, "pode fazer"
-- do dono em 09/09/2026).
--
-- Um fechamento (lead em fechado_ganho) pode ser cancelado depois: cliente
-- desistiu, não pagou, foi pra outro escritório. O fechamento original não
-- muda (continua fechado no mês em que fechou); o cancelamento é outro
-- evento, com data própria, motivo e quem cancelou. A etapa continua
-- fechado_ganho de propósito — tudo que conta "fechados" segue contando.
ALTER TABLE leads ADD COLUMN canceladoEmLead TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE leads ADD COLUMN motivoCancelamentoLead VARCHAR(64) DEFAULT NULL;
ALTER TABLE leads ADD COLUMN detalheCancelamentoLead VARCHAR(500) DEFAULT NULL;
ALTER TABLE leads ADD COLUMN canceladoPorLead INT DEFAULT NULL;
