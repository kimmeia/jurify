-- Desfecho do RECURSO — eixo separado do desfecho do pedido.
--
-- "Provimento" não é "procedente": réu que recorre e vence teve o recurso
-- provido e o pedido do autor rejeitado. Reaproveitar `resultadoJurisProc`
-- misturaria as duas grandezas no mesmo número.
--
-- Processo de instância superior preenche estas colunas e deixa
-- `resultadoJurisProc` nulo; processo de 1º grau faz o contrário.
--
-- Tudo NULL por default: linha antiga continua válida e a varredura preenche
-- conforme reprocessa.

ALTER TABLE jurisia_processos
  ADD COLUMN resultadoRecursoJurisProc ENUM(
    'provido',
    'parcialmente_provido',
    'nao_provido',
    'nao_conhecido',
    'prejudicado',
    'desistencia'
  ) DEFAULT NULL;

ALTER TABLE jurisia_processos
  ADD COLUMN resultadoRecursoEmJurisProc TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE jurisia_processos
  ADD COLUMN resultadoRecursoMovimentoJurisProc VARCHAR(255) DEFAULT NULL;

-- O recorte de instância superior filtra por este campo; sem índice a
-- contagem varre a tabela inteira.
CREATE INDEX idx_jurisia_proc_resultado_recurso
  ON jurisia_processos (resultadoRecursoJurisProc);
