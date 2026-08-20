-- Monitoramento por CPF/CNPJ em vários estados (aprovado no mockup de 20/08).
-- `tribunais`: JSON array dos tribunais vigiados; NULL = só o legado `tribunal`.
-- `tribunais_baseline`: quais já passaram pela 1ª varredura silenciosa — sem
--   isso, adicionar um estado novo alarmaria todos os processos antigos de lá.
-- `varredura_json`: resultado por tribunal da última varredura (ok/erro/total),
--   pra faixa de cobertura não depender de log.
ALTER TABLE motor_monitoramentos
  ADD COLUMN tribunais TEXT DEFAULT NULL,
  ADD COLUMN tribunais_baseline TEXT DEFAULT NULL,
  ADD COLUMN varredura_json TEXT DEFAULT NULL;
