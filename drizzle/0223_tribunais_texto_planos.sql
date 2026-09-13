-- Texto honesto da cobertura nos cartões dos 3 planos (decisão 2 do dono).
--
-- "novas ações: TJCE por enquanto" dizia menos do que o robô faz (vigia por
-- número em 12 TJs e 4 TRFs, mais o TRF5 por consulta pública) e o site
-- prometia mais ("+90 tribunais"). O bullet passa a dizer os dois lados.
--
-- JSON_REPLACE no ÍNDICE do bullet de cada plano (0217: atende = $[3],
-- escritorio = $[5], escala = $[4]) — não reescreve o array, pra outra
-- migration poder mexer em outro bullet do mesmo plano. O WHERE confere o
-- texto antigo: rodar duas vezes não muda nada, e bullet já editado no
-- painel não é sobrescrito.
UPDATE planos
  SET features = JSON_REPLACE(features, '$[3]',
    'Vigia 300 processos nos tribunais cobertos (12 TJs e 4 TRFs, mais o TRF5 por consulta pública — TJSP e TRTs ainda não) · 15 CPFs/CNPJs (novas ações: comprovado no TJCE)')
  WHERE slug = 'atende'
    AND JSON_UNQUOTE(JSON_EXTRACT(features, '$[3]')) = 'Vigia 300 processos e 15 CPFs/CNPJs (novas ações: TJCE por enquanto)';

UPDATE planos
  SET features = JSON_REPLACE(features, '$[5]',
    'Vigia 1.000 processos nos tribunais cobertos (12 TJs e 4 TRFs, mais o TRF5 por consulta pública — TJSP e TRTs ainda não) · 50 CPFs/CNPJs (novas ações: comprovado no TJCE)')
  WHERE slug = 'escritorio'
    AND JSON_UNQUOTE(JSON_EXTRACT(features, '$[5]')) = 'Vigia 1.000 processos e 50 CPFs/CNPJs (novas ações: TJCE por enquanto)';

UPDATE planos
  SET features = JSON_REPLACE(features, '$[4]',
    'Vigia 2.500 processos nos tribunais cobertos (12 TJs e 4 TRFs, mais o TRF5 por consulta pública — TJSP e TRTs ainda não) · 150 CPFs/CNPJs (novas ações: comprovado no TJCE)')
  WHERE slug = 'escala'
    AND JSON_UNQUOTE(JSON_EXTRACT(features, '$[4]')) = 'Vigia 2.500 processos e 150 CPFs/CNPJs (novas ações: TJCE por enquanto)';
