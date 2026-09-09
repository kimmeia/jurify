-- Ponto vira módulo próprio na matriz de cargos.
--
-- Até aqui o Ponto pegava carona em "equipe": quem tinha `ver_todos` lá via a
-- jornada, as faltas e as notas de avaliação de todo o time. Isso entregou o
-- módulo ao Gestor por consequência, não por escolha — administrar a equipe e
-- ler o cartão de ponto de cada pessoa são coisas diferentes, e a segunda é
-- concessão explícita do dono.
--
-- A ausência de linha já significa "não tem" (`checkPermission` nega módulo sem
-- entry, e `minhasPermissoes` preenche com false). O INSERT abaixo existe pra
-- que a MATRIZ diga a verdade: sem ele o painel mostraria a linha "Ponto"
-- desmarcada até no cargo Dono, que na prática tem acesso pelo bypass de
-- superusuário — a tela contradizendo o sistema.
--
-- Non-destrutivo por construção: só insere onde não existe linha.

INSERT INTO permissoes_cargo (cargoId, modulo, ver_todos, ver_proprios, criar, editar, excluir)
SELECT c.id,
       'ponto',
       c.nome = 'Dono',
       c.nome = 'Dono',
       c.nome = 'Dono',
       c.nome = 'Dono',
       c.nome = 'Dono'
  FROM cargos_personalizados c
 WHERE NOT EXISTS (
         SELECT 1 FROM permissoes_cargo p
          WHERE p.cargoId = c.id AND p.modulo = 'ponto'
       );
