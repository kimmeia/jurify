-- Fila de ingestão: "quero N processos hoje" em vez de clicar Varrer 40 vezes.
--
-- O botão de varredura é síncrono e faz 5 páginas por clique. Com 59 tribunais
-- e milhões de processos, quem vira o laço de repetição é o admin. A tarefa
-- guarda a meta e um worker a persegue em ciclos curtos.

CREATE TABLE IF NOT EXISTS jurisia_tarefas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  -- NULL = todos os tribunais, atacando sempre o mais atrasado.
  tribunalJurisTar VARCHAR(16) DEFAULT NULL,
  metaProcessosJurisTar INT NOT NULL,
  processosJurisTar INT NOT NULL DEFAULT 0,
  paginasJurisTar INT NOT NULL DEFAULT 0,
  statusJurisTar ENUM('fila','rodando','concluida','cancelada','erro')
    NOT NULL DEFAULT 'fila',
  ultimoErroJurisTar VARCHAR(500) DEFAULT NULL,
  criadoPorJurisTar INT DEFAULT NULL,
  criadoEmJurisTar TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  iniciadoEmJurisTar TIMESTAMP NULL DEFAULT NULL,
  concluidoEmJurisTar TIMESTAMP NULL DEFAULT NULL
);

-- O worker busca a próxima tarefa viva a cada ciclo; sem índice isso varre a
-- tabela inteira a cada dois minutos, para sempre.
CREATE INDEX idx_jurisia_tarefa_status ON jurisia_tarefas (statusJurisTar, id);
