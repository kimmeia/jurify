-- UNIQUE em `(recorrenciaDeOrigemIdDesp, vencimentoDesp)` em despesas.
--
-- Contexto: `gerarFilhasDeModelo` (escritorio/despesas-recorrentes.ts) lê
-- as filhas existentes pra um Set em memória e itera gerando os próximos
-- vencimentos. Se duas execuções concorrentes rodam ao mesmo tempo (cron
-- de 1h + botão "Gerar próximas agora" do usuário + worker auxiliar),
-- ambas podem ler o mesmo estado e tentar INSERT da mesma filha. Sem
-- UNIQUE no DB, duplicatas se acumulam — usuário vê 2x "Aluguel maio".
--
-- O try/catch existente no INSERT (linha 154) já está preparado pra
-- absorver ER_DUP_ENTRY e pular silenciosamente. Falta só a UNIQUE
-- no schema pra que o segundo INSERT da race seja rejeitado pelo DB.
--
-- Cleanup das duplicatas existentes (PRÉ-condição pra criar a UNIQUE):
--   Para cada par (recorrenciaDeOrigemId, vencimento), mantém UMA linha:
--     1º critério: maior valorPagoDesp (preserva pagamento parcial real)
--     2º critério: menor id (mais antiga, mais chances de já ter
--                  anexos/fitid associados — preserva referências)
--
--   As demais duplicatas são DELETADAS. Risco residual:
--     - Anexos (financeiro_anexos.entidadeId) apontando pra deleted →
--       arquivo continua no S3 mas sem row de metadata (orfão, limpável)
--     - FITID importado (ofx_importacoes_fitid.entidadeId) apontando pra
--       deleted → fica órfão; FITID UNIQUE garante que ele estava em
--       só UMA das duplicatas
--   Ambos casos são extremamente raros porque o bug exige race exata
--   ENTRE 2 execuções de cron, durante segundos, e o usuário só anexa/
--   reconcilia despesas que viu na UI (ele veria a duplicata e cancelaria).
--
-- Idempotente:
--   - DELETE com self-join não muda nada se já não há duplicatas
--   - ADD UNIQUE INDEX é absorvido como "duplicate key name" pelo
--     auto-migrate quando rerun

-- 1. Cleanup: deleta duplicatas mantendo a "melhor" por par
DELETE d2 FROM despesas d2
INNER JOIN despesas d1
  ON d1.recorrenciaDeOrigemIdDesp = d2.recorrenciaDeOrigemIdDesp
  AND d1.vencimentoDesp = d2.vencimentoDesp
  AND d1.id <> d2.id
WHERE d2.recorrenciaDeOrigemIdDesp IS NOT NULL
  AND (
    CAST(d1.valorPagoDesp AS DECIMAL(12,2)) > CAST(d2.valorPagoDesp AS DECIMAL(12,2))
    OR (
      CAST(d1.valorPagoDesp AS DECIMAL(12,2)) = CAST(d2.valorPagoDesp AS DECIMAL(12,2))
      AND d1.id < d2.id
    )
  );

-- 2. Cria UNIQUE — garante que próximas tentativas de duplicação falham
--    com ER_DUP_ENTRY (capturado e logado em despesas-recorrentes.ts).
ALTER TABLE despesas
  ADD UNIQUE INDEX desp_recorrencia_modelo_venc_uq (recorrenciaDeOrigemIdDesp, vencimentoDesp);
