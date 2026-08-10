-- Quando o processo virou definitivo.
--
-- A estatística vinha contando resultado provisório como final: sentença
-- procedente com apelação pendente entra em "procedente" e pode virar
-- improcedente depois. Com esta coluna a tela separa o que já acabou do que
-- ainda pode mudar.
--
-- NÃO é filtro de entrada do acervo. Acórdão é citável quando publicado, e
-- exigir trânsito descartaria o precedente recente — que é o mais valioso.

ALTER TABLE jurisia_processos
  ADD COLUMN transitadoEmJurisProc TIMESTAMP NULL DEFAULT NULL;

-- O recorte conta transitados junto com o desfecho; sem índice a contagem
-- varre a tabela inteira a cada pesquisa.
CREATE INDEX idx_jurisia_proc_transitado
  ON jurisia_processos (transitadoEmJurisProc);
