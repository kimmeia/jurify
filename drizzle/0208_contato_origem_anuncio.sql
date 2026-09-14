-- Origem do lead por anúncio (Click-to-WhatsApp), mockup aprovado 14/09.
--
-- A Meta manda o bloco `referral` na PRIMEIRA mensagem de quem clicou num
-- anúncio do Facebook/Instagram com destino WhatsApp — criativo, título,
-- texto e o id do clique. O webhook já recebia e descartava: o escritório
-- não sabia qual campanha trouxe cada lead.
--
-- Guardado como JSON porque o envelope varia por tipo de criativo e por
-- versão da API; colunas fixas quebrariam a cada mudança da Meta. A data
-- fica em coluna própria por ser o que a UI ordena e filtra.
--
-- Atribuição é FIRST-TOUCH: só grava quando ainda não há origem. Contato que
-- volta por outro anúncio continua creditado ao primeiro que o trouxe.
ALTER TABLE contatos ADD COLUMN origemAnuncio TEXT NULL DEFAULT NULL;
ALTER TABLE contatos ADD COLUMN origemAnuncioEm TIMESTAMP NULL DEFAULT NULL;
