-- Coluna `versao` + UNIQUE em
-- `(escritorioIdComFech, atendenteIdComFech, periodoInicioComFech,
--   periodoFimComFech, versao)` em `comissoes_fechadas`.
--
-- Contexto: `fecharComissao` (server/escritorio/db-comissoes.ts) hoje faz
-- SELECT check → INSERT, vulnerável a race entre o cron automático
-- (origem='automatico', cron-comissoes.ts) e clique manual do dono/gestor
-- (origem='manual', router-comissoes.fechar) no mesmo período. Sem UNIQUE
-- no DB, ambos passam pelo check (nenhum vê o do outro) e ambos fazem
-- INSERT → 2 fechamentos pro mesmo (escritório, atendente, período) +
-- 2 despesas pendentes geradas automaticamente. Resultado: o atendente
-- aparece com o dobro da comissão a pagar no fluxo de caixa.
--
-- A semântica de "re-fechamento após correção" (forcarDuplicado=true)
-- é legítima: operador re-fecha o período após detectar erro no cálculo
-- (cobrança chegou tarde, categoria mudou, etc.) e quer manter o
-- histórico dos 2 fechamentos pra auditoria. UNIQUE estrita em
-- (escritório, atendente, período) bloquearia esse uso. Por isso a
-- chave inclui `versao`:
--   - versao = 0  →  fechamento primário (default; protegido contra race)
--   - versao = 1, 2, ...  →  re-fechamentos forçados via UI
--
-- O cron sempre usa `forcarDuplicado=false` → sempre tenta versao=0 →
-- segundo INSERT em race cai em ER_DUP_ENTRY, é capturado em
-- db-comissoes.ts e re-lança `FechamentoJaExisteError`.
--
-- Cleanup de duplicatas históricas (pré-condição pra criar a UNIQUE):
--   Para cada grupo (escritório, atendente, inicio, fim) com >1 row,
--   numera incrementalmente por id ASC: id mais antigo = versao 0,
--   próximas = 1, 2, etc. Não deleta nada — preserva todos os
--   fechamentos + suas despesas/itens + FKs. O operador pode investigar
--   manualmente quais eram duplicatas de race vs re-fechamentos legítimos
--   (devem ser raros — UI já bloqueava double-click via mutationFn).
--
-- Idempotente:
--   - ADD COLUMN com DEFAULT 0 cobre rows antigas non-destrutivamente
--   - UPDATE com ROW_NUMBER() é safe rerun (versão já correta = no-op)
--   - ADD UNIQUE INDEX absorvido como "duplicate key name" pelo
--     `isHarmlessError` em auto-migrate.ts quando reroda

-- 1. Coluna versao — default 0 cobre rows existentes
ALTER TABLE comissoes_fechadas
  ADD COLUMN versao INT NOT NULL DEFAULT 0;

-- 2. Cleanup: numera duplicatas históricas via ROW_NUMBER (MySQL 8+)
--    Atribui versao = 0 ao mais antigo, 1, 2, ... aos seguintes do
--    mesmo grupo. Rerun da migration: rows já corretas ficam iguais.
UPDATE comissoes_fechadas cf
JOIN (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY escritorioIdComFech,
                   atendenteIdComFech,
                   periodoInicioComFech,
                   periodoFimComFech
      ORDER BY id ASC
    ) - 1 AS rn
  FROM comissoes_fechadas
) numerados ON cf.id = numerados.id
SET cf.versao = numerados.rn;

-- 3. UNIQUE — próximas race conditions caem em ER_DUP_ENTRY
ALTER TABLE comissoes_fechadas
  ADD UNIQUE INDEX com_fech_periodo_versao_uq (
    escritorioIdComFech,
    atendenteIdComFech,
    periodoInicioComFech,
    periodoFimComFech,
    versao
  );
