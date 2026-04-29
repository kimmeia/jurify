-- 0031_roadmap_moderacao: adiciona valor "aguardando_aprovacao" no enum
-- statusRoadmap. Sugestões novas começam aqui (privadas pro criador +
-- admin); admin aprova movendo pra "novo" ou outro status.
--
-- ALTER MODIFY COLUMN com novo enum funciona em qualquer MySQL e é
-- idempotente (rodar 2x não dá erro).

ALTER TABLE roadmap_itens
  MODIFY COLUMN statusRoadmap
  ENUM('aguardando_aprovacao','novo','em_analise','planejado','em_desenvolvimento','lancado','recusado')
  NOT NULL DEFAULT 'aguardando_aprovacao';
