-- O documento que o rótulo do PJe já entrega.
--
-- A timeline escreve o movimento junto com o número e o tipo da peça
-- ("Proferido despacho de mero expediente 226277277 - Despacho"). O scraper
-- descartava os links `javascript:void(0)` — que é como o PJe monta os links
-- JSF — e, sem URL, o evento virava `sem_documento`. A tela então afirmava
-- "o tribunal não anexou peça nenhuma", que é conclusão do nosso limite de
-- captura e não fato do tribunal.
--
-- Guardar id e tipo permite duas coisas: a tela dizer a verdade ("existe,
-- ainda não lemos") e o download sob demanda ter por onde começar.
--
-- Non-destrutivo: colunas novas com DEFAULT NULL. Evento antigo fica com
-- NULL e continua se comportando como hoje.

ALTER TABLE eventos_processo
  ADD COLUMN documentoIdTribunal VARCHAR(32) DEFAULT NULL,
  ADD COLUMN documentoTipo VARCHAR(64) DEFAULT NULL;

-- Achar rápido os eventos que têm peça identificada mas ainda não lida — é a
-- consulta do botão "ler documento" e de qualquer varredura futura.
CREATE INDEX idx_eventos_doc_pendente ON eventos_processo (escritorioId, teorStatus, documentoIdTribunal);
