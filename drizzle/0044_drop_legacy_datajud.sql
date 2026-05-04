-- 0044_drop_legacy_datajud: remove tabelas legacy do antigo monitoramento
-- via API DataJud (CNJ). O sistema de monitoramento de processos agora
-- roda 100% pela Judit (tabelas judit_*), e o frontend não usa mais
-- estas tabelas. Routers tRPC `processos` e `oab` foram removidos no
-- mesmo PR.
--
-- Idempotente: usa IF EXISTS pra suportar bancos onde drizzle-kit já
-- removeu as tabelas via push, e SET FOREIGN_KEY_CHECKS pra evitar
-- erro caso restem FKs penduradas.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `movimentacoes_processo`;
DROP TABLE IF EXISTS `processos_monitorados`;
DROP TABLE IF EXISTS `oabs_advogado`;
SET FOREIGN_KEY_CHECKS = 1;
