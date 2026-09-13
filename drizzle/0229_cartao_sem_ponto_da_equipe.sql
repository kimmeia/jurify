-- O cartão do plano parava de vender o que a conta não mostra.
--
-- O módulo Ponto saiu de produção em 13/09 (fica em staging com etiqueta
-- beta), mas o cartão do Escala seguia anunciando "Comissões automáticas por
-- colaborador e ponto da equipe" — o cliente assinava lendo isso e não achava
-- o módulo. A cesta (`modulos_liberados`) NÃO é tocada: o Ponto continua
-- contratado e volta a aparecer sozinho quando sair do beta; o que muda é só
-- a promessa escrita.
--
-- Troca por texto exato, não por posição: `features` é editável no painel e o
-- índice do item pode ter mudado. Quem já reescreveu a frase à mão não é
-- afetado, e rodar duas vezes não faz nada (o JSON_SEARCH não acha mais).
UPDATE planos
SET features = JSON_REPLACE(
      features,
      JSON_UNQUOTE(JSON_SEARCH(features, 'one', 'Comissões automáticas por colaborador e ponto da equipe')),
      'Comissões automáticas por colaborador'
    )
WHERE JSON_SEARCH(features, 'one', 'Comissões automáticas por colaborador e ponto da equipe') IS NOT NULL;
