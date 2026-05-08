-- Migration 0075: persiste status do email de convite em convites_colaborador
--
-- Por que existe: hoje quando admin convida colaborador, se o email falha
-- (Resend rejeita por domínio não verificado, quota, etc) o erro volta no
-- response tRPC mas NÃO fica registrado em lugar nenhum. Convite é criado
-- mesmo assim, mas admin nunca sabe que precisa reenviar.
--
-- Solução: 2 colunas que registram resultado do último envio. Permite:
--   - Admin ver quais convites têm email pendente
--   - Procedure `reenviarConvite` que tenta de novo
--   - Toast no frontend mostra erro real do Resend
--
-- Default emailEnviado=false: cobre convites antigos que não sabemos
-- se foram enviados — admin pode reenviar manualmente se quiser.

ALTER TABLE convites_colaborador
  ADD COLUMN emailEnviado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN ultimoErroEmail VARCHAR(512) DEFAULT NULL;
