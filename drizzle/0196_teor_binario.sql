-- Apaga teor que na verdade é um arquivo da página (fonte, imagem), e a
-- análise que a IA construiu em cima dele.
--
-- Ao alargar o reconhecimento do documento pra além de `application/pdf` — o
-- PJe entrega peça como octet-stream — passaram a entrar também os arquivos
-- que a tela carrega junto. Uma fonte WOFF2 foi lida como UTF-8, virou
-- mojibake, passou no piso de tamanho e foi gravada como teor.
--
-- O dano não é o texto ilegível na tela: é que a IA, sem documento pra ler,
-- resumiu o rótulo e fixou um prazo de 15 dias que ninguém escreveu. Prazo
-- inventado em escritório de advocacia é o pior resultado possível deste
-- sistema, então a sugestão sai junto.
--
-- `CONVERT(0xEFBFBD USING utf8mb4)` é o caractere de substituição — a marca
-- que sobra quando binário é decodificado como texto.

UPDATE eventos_processo
SET
  teor = NULL,
  teorStatus = 'pendente',
  teorErro = 'Descartado: o que foi baixado era um arquivo da página, não o documento.',
  teorObtidoEm = NULL,
  teorUrl = NULL,
  resumo_ia = NULL,
  desfechoEvento = NULL,
  analiseJson = NULL
WHERE teor IS NOT NULL
  AND (
    teor LIKE 'wOF2%'
    OR teor LIKE 'wOFF%'
    OR teor LIKE 'OTTO%'
    OR teor LIKE '%PNG%IHDR%'
    OR teor LIKE CONCAT('%', CONVERT(0xEFBFBD USING utf8mb4), '%')
  );

-- Só as pendentes: prazo que o advogado já aprovou ou descartou é decisão
-- dele, e mexer nisso seria trocar um erro por outro.
DELETE ps FROM prazos_sugeridos ps
JOIN eventos_processo ev ON ev.id = ps.evento_id
WHERE ps.status = 'pendente'
  AND ev.teorErro = 'Descartado: o que foi baixado era um arquivo da página, não o documento.';
