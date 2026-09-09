-- Apaga teor que na verdade é a tela do visualizador do tribunal, e a análise
-- que a IA escreveu em cima dele.
--
-- A busca de documento por id aceitava qualquer resposta com mais de 40
-- caracteres. O PJe serve o documento dentro de um visualizador JSF, então a
-- requisição voltava 200 com a casca da tela — menu, nome de quem estava
-- logado, identificador do servidor — e isso virou "teor" gravado. Em cima
-- dele a IA escreveu quatro conclusões jurídicas confiantes sobre uma decisão
-- que nunca leu, e o título do card virou "sem impacto direto no nosso
-- cliente".
--
-- Texto errado dá pra perceber. Resumo bem escrito de texto errado, não — por
-- isso a linha volta pra `pendente` em vez de ficar com um resumo plausível.
--
-- O filtro casa com o menu do PJe, que peça judicial nenhuma contém. Sentença
-- que cite "consulta documentos do processo" seria pega junto; volta pra
-- pendente e pode ser lida de novo, que é o custo aceitável do lado seguro.

UPDATE eventos_processo
SET
  teor = NULL,
  teorStatus = 'pendente',
  teorErro = 'Descartado: o tribunal devolveu a tela do visualizador, não o documento.',
  teorObtidoEm = NULL,
  teorUrl = NULL,
  resumo_ia = NULL,
  desfechoEvento = NULL,
  analiseJson = NULL
WHERE teor IS NOT NULL
  AND (
    LOWER(teor) LIKE '%abrir menu%'
    OR LOWER(teor) LIKE '%consulta documentos do processo%'
  );

-- A sugestão de prazo derivada dessa análise some junto: ela foi montada a
-- partir do menu. Só as ainda pendentes — se o advogado já aprovou ou
-- descartou, a decisão dele manda.
DELETE ps FROM prazos_sugeridos ps
JOIN eventos_processo ev ON ev.id = ps.evento_id
WHERE ps.status = 'pendente'
  AND ev.teorErro = 'Descartado: o tribunal devolveu a tela do visualizador, não o documento.';
