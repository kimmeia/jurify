-- Episódios de atendimento abertos enquanto a conversa não tinha atendente
-- ficavam com atendenteAbriu NULL pra sempre (o campo é congelado), mesmo
-- depois de um humano assumir e atender. Resultado: o trabalho dessas pessoas
-- sumia de qualquer relatório filtrado por setor/atendente. O código passou a
-- preencher "quem abriu" com o primeiro humano; aqui reparamos o passado.

-- 1) Quem já teve o dono registrado por transferência/assumir herda ele.
UPDATE atendimentos
SET atendenteAbriuAtd = atendenteAtualAtd
WHERE atendenteAbriuAtd IS NULL AND atendenteAtualAtd IS NOT NULL;

-- 2) Pros que sobraram: o primeiro colaborador que respondeu dentro da
--    janela do episódio. Quem nunca teve resposta humana continua NULL —
--    é atendimento do robô, e o relatório mostra como "sem atendente".
UPDATE atendimentos a
SET a.atendenteAbriuAtd = (
  SELECT m.remetenteIdMsg
  FROM mensagens m
  WHERE m.conversaIdMsg = a.conversaIdAtd
    AND m.direcaoMsg = 'saida'
    AND m.remetenteIdMsg IS NOT NULL
    AND m.createdAtMsg >= a.abertoEmAtd
    AND (a.fechadoEmAtd IS NULL OR m.createdAtMsg <= a.fechadoEmAtd)
  ORDER BY m.createdAtMsg ASC
  LIMIT 1
)
WHERE a.atendenteAbriuAtd IS NULL;

-- 3) Dono atual acompanha quando ainda estava vazio.
UPDATE atendimentos
SET atendenteAtualAtd = atendenteAbriuAtd
WHERE atendenteAtualAtd IS NULL AND atendenteAbriuAtd IS NOT NULL;
