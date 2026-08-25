-- Funil de remarketing em /admin/clients (mockup aprovado 25/08).
--
-- "Marcar contato": o caderninho comercial do dono da plataforma. Sem isso
-- ele não sabia com quem já tinha falado — advogado cadastrava, ninguém
-- via, remarketing não acontecia. O registro completo vai nas notas da
-- ficha (cliente_notas_admin, categoria comercial); estas colunas são o
-- resumo que a lista e os cartões do funil leem.
ALTER TABLE users ADD COLUMN ultimoContatoComercialEm TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE users ADD COLUMN ultimoContatoComercialCanal VARCHAR(16) NULL DEFAULT NULL;
