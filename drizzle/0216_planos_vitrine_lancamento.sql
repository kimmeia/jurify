-- Vitrine do lançamento de volta ao combinado (0203): os três planos sob
-- consulta e um único "Mais popular" (Profissional). O Essencial foi
-- editado no painel depois do lançamento e passou a mostrar R$ 5,00 com
-- botão de downgrade — que abria um checkout de verdade no Asaas.
--
-- Só o Essencial volta ao preço da seed. O preço mensal do Completo (49700,
-- da 0108) fica como está: a tela passa a respeitar "sob consulta" no
-- código, e a fatura composta de quem já assina lê esse número.
UPDATE planos SET
  preco_sob_consulta = TRUE,
  popular = FALSE,
  preco_mensal_centavos = 0,
  preco_anual_centavos = NULL
  WHERE slug = 'monitoramento-essencial';

UPDATE planos SET popular = FALSE WHERE slug <> 'monitoramento-profissional';
