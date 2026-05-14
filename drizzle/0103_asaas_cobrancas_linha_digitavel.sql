-- Cache de linha digitável de boleto em asaas_cobrancas.
--
-- Contexto: `obterLinhaDigitavel` (router-asaas.ts:3109) chamava o
-- Asaas (GET /payments/:id/identificationField) toda vez que o
-- usuário pedia copiar o boleto. Linha digitável é IMUTÁVEL por boleto
-- — uma vez emitida pelo Asaas, o número é o mesmo pra sempre.
-- Cachear localmente elimina chamadas redundantes.
--
-- Coluna armazena o JSON serializado do payload completo (3 campos:
-- identificationField, nossoNumero, barCode) — economiza 1 coluna
-- por campo. Drizzle desserializa no caller.
--
-- NULL = nunca foi requisitado / cache miss → próxima leitura busca
-- no Asaas e armazena. Pix QR Code segue padrão idêntico em
-- `pixQrCodePayload` (coluna pré-existente).
--
-- Idempotente: ADD COLUMN é absorvido como "duplicate column" pelo
-- auto-migrate em rerun.

ALTER TABLE asaas_cobrancas
  ADD COLUMN linhaDigitavelPayload TEXT DEFAULT NULL;
