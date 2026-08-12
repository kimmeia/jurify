-- Jornada de trabalho por colaborador.
--
-- Sem ela o espelho de ponto mostra horas e não diz nada: 7h20 é sobra pra
-- quem faz 6h e falta pra quem faz 8h. É por colaborador porque estagiário,
-- atendente e sócio não têm a mesma carga.
--
-- JSON com horário (e não só duração) porque o mesmo campo precisa responder
-- "cumpriu a carga" e "chegou na hora" — pontualidade é critério da avaliação
-- de desempenho, e dois formatos separados divergiriam.
--
-- NULL = sem jornada definida. O espelho mostra as horas e não cobra nada,
-- que é o certo enquanto ninguém configurou.

ALTER TABLE colaboradores
  ADD COLUMN jornadaSemanalCol TEXT NULL DEFAULT NULL;
