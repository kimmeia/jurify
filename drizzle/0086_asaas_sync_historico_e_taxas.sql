-- Migration 0086: sincronização histórica controlada + despesa automática de taxa Asaas
--
-- DUAS MUDANÇAS RELACIONADAS NUMA MIGRATION SÓ:
--
-- A) Campos em asaas_config pra controlar a sincronização histórica em janelas
--    de tempo. Antes a sync inicial puxava TUDO de cada cliente vinculado de
--    uma vez — em escritórios grandes (centenas de clientes) isso disparava
--    centenas de requests em segundos e estourava a cota do Asaas (429,
--    bloqueio de 12h). Agora a sync histórica é segmentada em janelas
--    (1 dia por vez), processadas pelo cron `processarSyncHistorico` a cada
--    tick. O escritório escolhe o período total desejado (24h/7d/30d/custom)
--    e o intervalo entre janelas. Webhook continua cobrindo o "dali pra
--    frente" em tempo real — sync histórica só preenche o passado.
--
-- B) Coluna `cobrancaOriginalId` e `origem` em despesas pra suportar
--    despesa automática de "Taxa Asaas" quando o webhook PAYMENT_RECEIVED
--    chega. A taxa = (value - netValue) — já temos esses dois números no DB,
--    nenhuma chamada extra à API. Status já entra como "pago" (foi descontada
--    na hora do crédito), data de pagamento = data de pagamento da cobrança.
--    `origem='taxa_asaas'` permite filtrar/relatórios diferenciados; default
--    'manual' preserva o que já existia.

-- ─── A) asaas_config: controle de sync histórico ────────────────────────────

ALTER TABLE asaas_config
  ADD COLUMN historicoSyncStatus
    ENUM('inativo', 'agendado', 'executando', 'pausado', 'concluido', 'erro')
    NOT NULL DEFAULT 'inativo',
  ADD COLUMN historicoSyncDe VARCHAR(10) NULL DEFAULT NULL,
  ADD COLUMN historicoSyncAte VARCHAR(10) NULL DEFAULT NULL,
  ADD COLUMN historicoSyncCursor VARCHAR(10) NULL DEFAULT NULL,
  ADD COLUMN historicoSyncTotalDias INT NULL DEFAULT NULL,
  ADD COLUMN historicoSyncDiasFeitos INT NOT NULL DEFAULT 0,
  ADD COLUMN historicoSyncCobrancasImportadas INT NOT NULL DEFAULT 0,
  ADD COLUMN historicoSyncCobrancasAtualizadas INT NOT NULL DEFAULT 0,
  ADD COLUMN historicoSyncIntervaloMinutos INT NOT NULL DEFAULT 60,
  ADD COLUMN historicoSyncIniciadoEm TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN historicoSyncUltimaJanelaEm TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN historicoSyncConcluidoEm TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN historicoSyncErroMensagem VARCHAR(512) NULL DEFAULT NULL;

-- Índice pro cron filtrar rapidamente escritórios elegíveis pra processar.
CREATE INDEX asaas_config_hist_status_idx
  ON asaas_config (historicoSyncStatus, historicoSyncUltimaJanelaEm);

-- ─── B) despesas: vínculo com cobrança + origem ─────────────────────────────

ALTER TABLE despesas
  ADD COLUMN origemDesp ENUM('manual', 'taxa_asaas', 'recorrencia')
    NOT NULL DEFAULT 'manual',
  ADD COLUMN cobrancaOriginalIdDesp INT NULL DEFAULT NULL;

-- UNIQUE garante idempotência: webhook do Asaas pode chegar 2-3× pro mesmo
-- PAYMENT_RECEIVED (retry padrão da plataforma). Sem UNIQUE, gerava 2-3
-- despesas duplicadas. Com UNIQUE, o INSERT IGNORE / ON DUPLICATE KEY
-- garante 1 despesa por cobrança.
CREATE UNIQUE INDEX desp_cob_origem_uq
  ON despesas (cobrancaOriginalIdDesp, origemDesp);
