-- Justiça do Trabalho entrou na cobertura: TRT2 e TRT15 por consulta pública
-- e os outros 22 TRTs com credencial, em teste. O bullet "Vigia…" dos 3
-- planos dizia "TJSP e TRTs ainda não" e passou a mentir. O texto novo é o
-- que `bulletVigiaPlano` (shared) gera.
--
-- Mesmo desenho da 0223: JSON_REPLACE no ÍNDICE do bullet de cada plano
-- (0217: atende = $[3], escritorio = $[5], escala = $[4]), sem reescrever o
-- array. O WHERE confere o texto que a 0223 gravou: rodar duas vezes não
-- muda nada, e bullet já editado no painel não é sobrescrito.
UPDATE planos
  SET features = JSON_REPLACE(features, '$[3]',
    'Vigia 300 processos nos tribunais cobertos (12 TJs e 4 TRFs com credencial; TRF5, TRT2 e TRT15 sem credencial; outros 22 TRTs em teste — TJSP ainda não) · 15 CPFs/CNPJs (novas ações: comprovado no TJCE)')
  WHERE slug = 'atende'
    AND JSON_UNQUOTE(JSON_EXTRACT(features, '$[3]')) = 'Vigia 300 processos nos tribunais cobertos (12 TJs e 4 TRFs, mais o TRF5 por consulta pública — TJSP e TRTs ainda não) · 15 CPFs/CNPJs (novas ações: comprovado no TJCE)';

UPDATE planos
  SET features = JSON_REPLACE(features, '$[5]',
    'Vigia 1.000 processos nos tribunais cobertos (12 TJs e 4 TRFs com credencial; TRF5, TRT2 e TRT15 sem credencial; outros 22 TRTs em teste — TJSP ainda não) · 50 CPFs/CNPJs (novas ações: comprovado no TJCE)')
  WHERE slug = 'escritorio'
    AND JSON_UNQUOTE(JSON_EXTRACT(features, '$[5]')) = 'Vigia 1.000 processos nos tribunais cobertos (12 TJs e 4 TRFs, mais o TRF5 por consulta pública — TJSP e TRTs ainda não) · 50 CPFs/CNPJs (novas ações: comprovado no TJCE)';

UPDATE planos
  SET features = JSON_REPLACE(features, '$[4]',
    'Vigia 2.500 processos nos tribunais cobertos (12 TJs e 4 TRFs com credencial; TRF5, TRT2 e TRT15 sem credencial; outros 22 TRTs em teste — TJSP ainda não) · 150 CPFs/CNPJs (novas ações: comprovado no TJCE)')
  WHERE slug = 'escala'
    AND JSON_UNQUOTE(JSON_EXTRACT(features, '$[4]')) = 'Vigia 2.500 processos nos tribunais cobertos (12 TJs e 4 TRFs, mais o TRF5 por consulta pública — TJSP e TRTs ainda não) · 150 CPFs/CNPJs (novas ações: comprovado no TJCE)';
