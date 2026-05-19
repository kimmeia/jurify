-- Adiciona `data_referencia_cadastro` em `motor_monitoramentos`.
--
-- Quando o monitor é do tipo `novas_acoes`, esse campo registra
-- "desde quando alertar". A regra de negócio: pega `contatos.createdAt`
-- (data em que o cliente foi cadastrado no escritório) — daquela data
-- em diante, qualquer CNJ ajuizado contra esse cliente vira alerta.
--
-- Sem isso, CNJs ajuizados ANTES do cliente entrar no sistema viravam
-- baseline silencioso. Agora ficam fora da lista de "novas ações" pra
-- não poluir o painel com processos antigos.
--
-- NULL permitido pra:
--   1. Backfill incremental (linhas antigas continuam funcionando sem)
--   2. Monitor sem cliente atrelado (ex: pesquisa solta por CPF)
--
-- O filtro só é aplicado quando o campo está preenchido. Frontend
-- mostra "Desde DD/MM/AAAA" no card quando relevante.

ALTER TABLE motor_monitoramentos
  ADD COLUMN data_referencia_cadastro TIMESTAMP NULL DEFAULT NULL;
