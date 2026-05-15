-- 0104_fk_processo_id: cria FKs faltantes em processoId de agendamentos,
-- tarefas e kanban_cards apontando pra cliente_processos.
--
-- Antes deste fix, deletar um processo deixava órfãos silenciosamente
-- (agendamentos com prazo, tarefas pendentes e cards no kanban
-- referenciando id que não existe mais). Relatórios distorcidos,
-- drawers quebrados, recriação acidental de id assumindo dados velhos.
--
-- Estratégia ON DELETE:
--   - agendamentos.processoIdAgend   → SET NULL (preserva audiência/prazo)
--   - tarefas.processoIdTarefa       → SET NULL (preserva tarefa do user)
--   - kanban_cards.processoIdKCard   → CASCADE  (card é puramente visual)
--
-- Pré-requisito: limpar órfãos antes do ADD CONSTRAINT — MySQL rejeita
-- a criação da FK se já houver linhas com valor que não existe no pai.

UPDATE agendamentos a
LEFT JOIN cliente_processos cp ON cp.id = a.processoIdAgend
SET a.processoIdAgend = NULL
WHERE a.processoIdAgend IS NOT NULL AND cp.id IS NULL;

UPDATE tarefas t
LEFT JOIN cliente_processos cp ON cp.id = t.processoIdTarefa
SET t.processoIdTarefa = NULL
WHERE t.processoIdTarefa IS NOT NULL AND cp.id IS NULL;

UPDATE kanban_cards k
LEFT JOIN cliente_processos cp ON cp.id = k.processoIdKCard
SET k.processoIdKCard = NULL
WHERE k.processoIdKCard IS NOT NULL AND cp.id IS NULL;

ALTER TABLE agendamentos
  ADD CONSTRAINT fk_agendamentos_processo
  FOREIGN KEY (processoIdAgend) REFERENCES cliente_processos(id)
  ON DELETE SET NULL;

ALTER TABLE tarefas
  ADD CONSTRAINT fk_tarefas_processo
  FOREIGN KEY (processoIdTarefa) REFERENCES cliente_processos(id)
  ON DELETE SET NULL;

ALTER TABLE kanban_cards
  ADD CONSTRAINT fk_kanban_cards_processo
  FOREIGN KEY (processoIdKCard) REFERENCES cliente_processos(id)
  ON DELETE CASCADE;
