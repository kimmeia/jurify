-- Soft delete de colaboradores. Antes era hard DELETE pela função
-- removerColaborador — sem como recuperar quando alguém remove por
-- engano. Agora marca removidoEm/removidoPor e seta ativo=false.
-- Listagens já filtravam ativo=true, então comportamento existente
-- não muda. Novo endpoint restaurar reverte (set ativo=true, limpa
-- timestamps).
ALTER TABLE colaboradores
  ADD COLUMN removidoEm TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN removidoPor INT NULL DEFAULT NULL;

CREATE INDEX colab_removidos_idx ON colaboradores (escritorioId, ativo, removidoEm);
