-- Avaliação de desempenho: uma linha por colaborador por ciclo.
--
-- As notas vão em JSON, e não em cinco colunas, porque QUAIS critérios servem
-- pra um estagiário e pra um sócio ainda é pergunta em aberto. Critério novo
-- não pode custar migration. A validação vive em `shared/avaliacao`, do mesmo
-- jeito que a da jornada do colaborador.
--
-- `mediaAval` é derivada das notas e mesmo assim é gravada: é por ela que a
-- lista da equipe ordena e que o histórico compara ciclos, e recalcular a
-- média de todo mundo a cada leitura pra depois ordenar em memória seria pagar
-- caro por um número que não muda depois de salvo.
--
-- Sem UNIQUE em (colaborador, ciclo): reavaliar dentro do mesmo mês acontece
-- (a primeira saiu errada, ou o gestor mudou), e o histórico deve guardar as
-- duas. A tela lê a mais recente.

CREATE TABLE IF NOT EXISTS rh_avaliacoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdAval INT NOT NULL,
  colaboradorIdAval INT NOT NULL,
  -- Mês do ciclo (YYYY-MM). O próximo vence CICLO_MESES depois.
  cicloAval VARCHAR(7) NOT NULL,

  -- {"pontualidade":1.5,"metas":2,...} — chaves validadas no shared.
  notasAval TEXT NULL DEFAULT NULL,
  -- Média dos critérios avaliados. NULL quando nenhum foi.
  mediaAval DECIMAL(3,1) NULL DEFAULT NULL,

  comentarioAval VARCHAR(2000) NULL DEFAULT NULL,

  avaliadoPorAval INT NOT NULL,
  avaliadoEmAval TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  createdAtAval TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtAval TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_aval_colab (colaboradorIdAval, cicloAval),
  KEY idx_aval_esc (escritorioIdAval, cicloAval)
);

-- O plano combinado no fim da avaliação.
--
-- Tabela própria porque cada item tem vida depois da conversa: ele é dado por
-- cumprido (ou não) semanas mais tarde, e o ciclo seguinte abre relendo o que
-- ficou em aberto. Gravado dentro do JSON da avaliação, marcar um item como
-- concluído exigiria reescrever a avaliação inteira.
CREATE TABLE IF NOT EXISTS rh_avaliacao_acoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  avaliacaoIdAcao INT NOT NULL,
  escritorioIdAcao INT NOT NULL,
  descricaoAcao VARCHAR(500) NOT NULL,
  -- Data combinada (YYYY-MM-DD). NULL quando não se combinou prazo — e aí a
  -- ação nunca aparece como atrasada.
  prazoAcao VARCHAR(10) NULL DEFAULT NULL,
  concluidoEmAcao TIMESTAMP NULL DEFAULT NULL,
  concluidoPorAcao INT NULL DEFAULT NULL,

  createdAtAcao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_acao_aval (avaliacaoIdAcao),
  KEY idx_acao_esc (escritorioIdAcao)
);
