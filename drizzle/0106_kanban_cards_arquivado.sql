-- Camada "arquivar cards concluídos sem perder dados".
-- arquivado=true exclui o card da query default obterFunil. Tabela ainda
-- guarda tudo (histórico, comentários, movimentações) — só some do quadro.
ALTER TABLE kanban_cards
  ADD COLUMN arquivadoKCard BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN arquivadoEmKCard TIMESTAMP NULL DEFAULT NULL;

CREATE INDEX kanban_cards_arquivado_idx ON kanban_cards (escritorioIdKCard, arquivadoKCard);
