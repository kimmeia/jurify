-- Migration: Add missing indexes and foreign key constraints
-- Addresses performance and data integrity issues

-- ═══════════════════════════════════════════════════════════════
-- INDEXES — Performance critical queries
-- ═══════════════════════════════════════════════════════════════

-- processos_monitorados: filtered by userId in every query
CREATE INDEX IF NOT EXISTS idx_processos_userId ON processos_monitorados (userId);

-- movimentacoes_processo: join by processoId
CREATE INDEX IF NOT EXISTS idx_movimentacoes_processoId ON movimentacoes_processo (processoId);

-- conversas: heavily filtered by escritorioId, atendenteId, status
CREATE INDEX IF NOT EXISTS idx_conversas_escritorioId ON conversas (escritorioIdConv);
CREATE INDEX IF NOT EXISTS idx_conversas_atendenteId ON conversas (atendenteIdConv);
CREATE INDEX IF NOT EXISTS idx_conversas_contatoId ON conversas (contatoIdConv);
CREATE INDEX IF NOT EXISTS idx_conversas_status ON conversas (statusConv);

-- mensagens: lookups by conversaId
CREATE INDEX IF NOT EXISTS idx_mensagens_conversaId ON mensagens (conversaIdMsg);

-- leads: filtered by escritorioId, etapaFunil
CREATE INDEX IF NOT EXISTS idx_leads_escritorioId ON leads (escritorioIdLead);
CREATE INDEX IF NOT EXISTS idx_leads_etapaFunil ON leads (etapaFunil);

-- contatos: filtered by escritorioId
CREATE INDEX IF NOT EXISTS idx_contatos_escritorioId ON contatos (escritorioIdContato);

-- colaboradores: filtered by escritorioId, userId
CREATE INDEX IF NOT EXISTS idx_colaboradores_escritorioId ON colaboradores (escritorioId);
CREATE INDEX IF NOT EXISTS idx_colaboradores_userId ON colaboradores (userId);

-- agendamentos: filtered by escritorioId, responsavelId
CREATE INDEX IF NOT EXISTS idx_agendamentos_escritorioId ON agendamentos (escritorioId);
CREATE INDEX IF NOT EXISTS idx_agendamentos_responsavelId ON agendamentos (responsavelId);

-- tarefas: filtered by escritorioId, responsavelId
CREATE INDEX IF NOT EXISTS idx_tarefas_escritorioId ON tarefas (escritorioIdTarefa);
CREATE INDEX IF NOT EXISTS idx_tarefas_responsavelId ON tarefas (responsavelIdTarefa);

-- notificacoes: filtered by userId
CREATE INDEX IF NOT EXISTS idx_notificacoes_userId ON notificacoes (userId);

-- subscriptions: filtered by userId
CREATE INDEX IF NOT EXISTS idx_subscriptions_userId ON subscriptions (userId);

-- calculos_historico: filtered by userId
CREATE INDEX IF NOT EXISTS idx_calculos_userId ON calculos_historico (userId);

-- asaas_cobrancas: filtered by escritorioId
CREATE INDEX IF NOT EXISTS idx_asaas_cobrancas_escritorioId ON asaas_cobrancas (escritorioIdAsaasCob);

-- ═══════════════════════════════════════════════════════════════
-- FOREIGN KEYS — Data integrity
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE subscriptions
  ADD CONSTRAINT fk_subscriptions_userId
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE processos_monitorados
  ADD CONSTRAINT fk_processos_userId
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE movimentacoes_processo
  ADD CONSTRAINT fk_movimentacoes_processoId
  FOREIGN KEY (processoId) REFERENCES processos_monitorados(id) ON DELETE CASCADE;

ALTER TABLE colaboradores
  ADD CONSTRAINT fk_colaboradores_escritorioId
  FOREIGN KEY (escritorioId) REFERENCES escritorios(id) ON DELETE CASCADE;

ALTER TABLE colaboradores
  ADD CONSTRAINT fk_colaboradores_userId
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE conversas
  ADD CONSTRAINT fk_conversas_escritorioId
  FOREIGN KEY (escritorioIdConv) REFERENCES escritorios(id) ON DELETE CASCADE;

ALTER TABLE conversas
  ADD CONSTRAINT fk_conversas_contatoId
  FOREIGN KEY (contatoIdConv) REFERENCES contatos(id) ON DELETE CASCADE;

ALTER TABLE conversas
  ADD CONSTRAINT fk_conversas_canalId
  FOREIGN KEY (canalIdConv) REFERENCES canais_integrados(id) ON DELETE CASCADE;

ALTER TABLE mensagens
  ADD CONSTRAINT fk_mensagens_conversaId
  FOREIGN KEY (conversaIdMsg) REFERENCES conversas(id) ON DELETE CASCADE;

ALTER TABLE leads
  ADD CONSTRAINT fk_leads_escritorioId
  FOREIGN KEY (escritorioIdLead) REFERENCES escritorios(id) ON DELETE CASCADE;

ALTER TABLE leads
  ADD CONSTRAINT fk_leads_contatoId
  FOREIGN KEY (contatoIdLead) REFERENCES contatos(id) ON DELETE CASCADE;

ALTER TABLE contatos
  ADD CONSTRAINT fk_contatos_escritorioId
  FOREIGN KEY (escritorioIdContato) REFERENCES escritorios(id) ON DELETE CASCADE;

ALTER TABLE notificacoes
  ADD CONSTRAINT fk_notificacoes_userId
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE agendamentos
  ADD CONSTRAINT fk_agendamentos_escritorioId
  FOREIGN KEY (escritorioId) REFERENCES escritorios(id) ON DELETE CASCADE;

ALTER TABLE tarefas
  ADD CONSTRAINT fk_tarefas_escritorioId
  FOREIGN KEY (escritorioIdTarefa) REFERENCES escritorios(id) ON DELETE CASCADE;
