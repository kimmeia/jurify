-- Gestor agora obedece a matriz rigorosamente.
--
-- Antes: `checkPermissionAdminOuMatriz` tinha bypass legado pra "Gestor",
-- então procedures de configurações/equipe:editar/clientes:excluir
-- passavam mesmo com a matriz tendo verTodos=false em configurações,
-- editar=false em equipe etc.
--
-- Agora: bypass removido. Só Dono ainda tem bypass total. Gestor passa
-- a depender da matriz.
--
-- Pra preservar o comportamento atual (Gestor com acesso a configurações
-- e equipe:editar), update agressivo nos cargos personalizados com
-- nome "Gestor" e isDefault=true: sobrescreve as permissões das 3
-- entries críticas pros novos defaults. Cargos "Gestor" customizados
-- (isDefault=false ou renomeados) NÃO são tocados.
--
-- Mudanças (vs default antigo):
--   clientes:    verTodos=1,verProprios=1,criar=1,editar=1,excluir=0 → excluir=1
--   configuracoes: tudo 0 → verTodos=1,verProprios=1,criar=1,editar=1
--   equipe:      verTodos=1,verProprios=1,criar=0,editar=0 → criar=1,editar=1

UPDATE permissoes_cargo pc
JOIN cargos_personalizados cp ON cp.id = pc.cargoId
SET pc.excluir = 1
WHERE cp.nome = 'Gestor'
  AND cp.isDefault = 1
  AND pc.modulo = 'clientes';

UPDATE permissoes_cargo pc
JOIN cargos_personalizados cp ON cp.id = pc.cargoId
SET pc.ver_todos = 1, pc.ver_proprios = 1, pc.criar = 1, pc.editar = 1, pc.excluir = 0
WHERE cp.nome = 'Gestor'
  AND cp.isDefault = 1
  AND pc.modulo = 'configuracoes';

UPDATE permissoes_cargo pc
JOIN cargos_personalizados cp ON cp.id = pc.cargoId
SET pc.criar = 1, pc.editar = 1
WHERE cp.nome = 'Gestor'
  AND cp.isDefault = 1
  AND pc.modulo = 'equipe';
