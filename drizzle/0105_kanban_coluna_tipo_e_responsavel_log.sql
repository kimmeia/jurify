-- Camada 1: tipo da coluna ('normal' | 'conclusao'). Default 'normal' pra
-- preservar comportamento atual de boards/colunas existentes — UI continua
-- não mostrando nada de especial até alguém marcar uma coluna manualmente.
ALTER TABLE kanban_colunas
  ADD COLUMN tipoKC ENUM('normal','conclusao') NOT NULL DEFAULT 'normal';

-- Camada 2: log de mudanças de responsável por card. Sem isso, só
-- conseguimos saber o responsável ATUAL (kanban_cards.responsavelIdKCard) —
-- precisamos saber quem foi quando, quem fez a mudança e quando.
CREATE TABLE IF NOT EXISTS kanban_responsavel_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cardIdKRespLog INT NOT NULL,
  responsavelAnteriorIdKRespLog INT NULL,
  responsavelNovoIdKRespLog INT NULL,
  mudadoPorIdKRespLog INT NULL,
  createdAtKRespLog TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX kanban_resp_log_card_idx (cardIdKRespLog, createdAtKRespLog)
);
