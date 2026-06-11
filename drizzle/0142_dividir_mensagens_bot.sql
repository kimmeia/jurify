-- Divisão de respostas automáticas (Atendente IA / SmartFlow) em
-- mensagens menores com pausa e "digitando…" entre elas — comportamento
-- aprovado via mockup. Config por escritório; envio manual do operador
-- nunca é dividido.

ALTER TABLE `escritorios`
  ADD COLUMN `msgDividirRespostas` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN `msgDividirMax` INT NOT NULL DEFAULT 4,
  ADD COLUMN `msgDividirRitmo` ENUM('rapido','natural','calmo') NOT NULL DEFAULT 'natural';
