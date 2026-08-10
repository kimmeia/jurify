-- Todos os assuntos da TPU de um processo, não só o principal.
--
-- "Agravo em Recurso Especial" é a classe — o veículo. O que a briga é SOBRE
-- vem nos assuntos, e num agravo o assunto principal costuma ser a matéria
-- processual genérica; a específica (busca e apreensão, alimentos, revisional)
-- vem depois dela no array. Guardando só o primeiro, o recorte por conteúdo
-- não tinha como funcionar.
--
-- Coluna nova com DEFAULT NULL: linhas antigas ficam sem a lista e o filtro
-- continua casando pelo assunto principal até a próxima varredura reescrever.
ALTER TABLE jurisia_processos
  ADD COLUMN assuntosTodosJurisProc TEXT DEFAULT NULL;
