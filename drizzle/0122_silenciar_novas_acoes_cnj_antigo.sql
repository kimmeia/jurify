-- Cleanup do bug "Novas Ações falso positivo" (22/05/2026).
--
-- Antes do fix:
--   1. `cron-monitoramento.ts:pollarUmMonitoramentoNovasAcoes` não tinha
--      salvaguarda quando `dataReferenciaCadastro` era NULL. Resultado:
--      qualquer CNJ no histórico do CPF/CNPJ no PJe entrava como `lido=false`
--      (alerta), mesmo de processos de 5+ anos atrás.
--   2. `routers/processos.ts:listarNovasAcoes` ignorava o input
--      `apenasNaoLidas`, então a UI exibia até baseline silencioso.
--
-- O fix da lógica cobre detecções FUTURAS. Esta migration limpa as
-- detecções HISTÓRICAS já registradas como não-lidas para CNJs cujo
-- ano embutido (posição 10-13 do CNJ sem pontuação) é > 3 anos atrás
-- do momento da execução desta migration. Marca `lido=true` (mesmo
-- critério usado pelo cron pra silenciados) — não apaga, fica acessível
-- no histórico quando o user desmarca "filtrar não lidas".
--
-- Critério de antiguidade: > 3 anos da execução desta migration. Casa
-- exatamente com a constante `ANOS_MAXIMOS_SEM_DATA_REF` em
-- `cron-monitoramento.ts`. Sem `dataReferenciaCadastro` exigido pra
-- limpeza: a lógica é "se o CNJ é objetivamente antigo, NÃO é nova ação,
-- ponto" — independente do estado do monitoramento.
--
-- Idempotente: re-execução só toca linhas que ainda casam o critério
-- (lido=false + ano antigo) e ajusta nada que já foi marcado.

UPDATE eventos_processo
SET lido = TRUE
WHERE tipoEvento = 'nova_acao'
  AND lido = FALSE
  AND cnjAfetado IS NOT NULL
  AND CHAR_LENGTH(REPLACE(REPLACE(cnjAfetado, '-', ''), '.', '')) = 20
  AND CAST(SUBSTRING(REPLACE(REPLACE(cnjAfetado, '-', ''), '.', ''), 10, 4) AS UNSIGNED)
      < YEAR(CURRENT_DATE) - 3;
