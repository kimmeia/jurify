-- Migration 0087: despesas recorrentes automáticas
--
-- Hoje o campo `recorrenciaDesp` em `despesas` aceita semanal/mensal/anual,
-- mas nada gera as próximas ocorrências automaticamente — fica como rótulo
-- informativo. Esta migration habilita geração automática via cron:
--
-- 1) `recorrenciaDeOrigemIdDesp` (FK lógica → despesas.id): quando o cron
--    gera uma nova ocorrência a partir de uma despesa-modelo, marca a
--    origem aqui. Isso permite:
--    - distinguir "modelo" (NULL) de "filha" (preenchido)
--    - listar histórico de uma série recorrente
--    - pausar/cancelar todas as filhas se o usuário desativar a série
--
-- 2) `recorrenciaAtivaDesp`: flag de pausa por usuário. Permite manter o
--    histórico mas parar de gerar próximas (ex: "cancelei o plano, mas
--    quero ver as parcelas antigas"). Default TRUE pra preservar
--    comportamento de despesas existentes.
--
-- O cron `gerarDespesasRecorrentes` (registrado em cron-jobs.ts, 1h tick)
-- consulta: SELECT * FROM despesas WHERE recorrenciaDesp != 'nenhuma'
--   AND recorrenciaAtivaDesp = TRUE AND recorrenciaDeOrigemIdDesp IS NULL.
-- Pra cada modelo, calcula próxima data esperada (último vencimento +
-- intervalo da recorrência) e cria filhas até alcançar hoje.

ALTER TABLE despesas
  ADD COLUMN recorrenciaDeOrigemIdDesp INT NULL DEFAULT NULL,
  ADD COLUMN recorrenciaAtivaDesp BOOLEAN NOT NULL DEFAULT TRUE;

-- Index pro cron filtrar modelos elegíveis rapidamente.
CREATE INDEX desp_recorrencia_modelo_idx
  ON despesas (escritorioIdDesp, recorrenciaDesp, recorrenciaAtivaDesp, recorrenciaDeOrigemIdDesp);

-- Index pra listar filhas de uma série rapidamente.
CREATE INDEX desp_recorrencia_origem_idx
  ON despesas (recorrenciaDeOrigemIdDesp);
