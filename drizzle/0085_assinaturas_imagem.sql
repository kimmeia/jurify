-- Migration 0085: assinatura manuscrita capturada no /assinar/:token
--
-- Por que existe: hoje o assinarPorToken só registra concordância +
-- nome/IP. PR #232 começou a usar assinaturas digitais de fato e ficou
-- claro que precisamos da assinatura visual no PDF final.
--
-- Campos:
--   - assinaturaImagemUrl: path do PNG capturado do canvas signature_pad
--     (ex: /uploads/assinaturas/escritorio_X/assinatura_Y_Z.png).
--     Imagem é estampada no PDF assinado + na página de certificação.
--   - assinanteCpf: CPF informado pelo signatário (opcional). Aparece
--     na página de certificado. Sem validação de dígitos no MVP.

ALTER TABLE assinaturas_digitais
  ADD COLUMN assinaturaImagemUrl VARCHAR(500) NULL DEFAULT NULL,
  ADD COLUMN assinanteCpf VARCHAR(20) NULL DEFAULT NULL;
