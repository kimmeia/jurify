-- Campos posicionais de assinatura — permite operador POSICIONAR onde,
-- em qual página e quantos campos de assinatura/data/nome/CPF aparecem
-- num contrato gerado (estilo ZapSign / DocuSign).
--
-- Fluxo:
--   1. Operador gera contrato → cria registro em assinaturas_digitais (1:1, fluxo antigo preservado)
--   2. NOVO: operador abre editor visual, arrasta campos sobre o PDF e salva → cria N rows aqui
--   3. Cliente abre /assinar/:token → vê o PDF com as caixinhas amarelas e clica em cada uma
--   4. Backend persiste valorPreenchido por campo e gera PDF final carimbado nas coords corretas
--
-- COMPAT: assinaturas com 0 campos posicionais (todas as antigas + as criadas sem
-- usar o editor) caem no fluxo legado — carimbo central na última página + página
-- de certificação. Migration NÃO altera nada das assinaturas existentes.
--
-- Coordenadas: SEMPRE em pontos PDF, com origem no canto INFERIOR ESQUERDO da
-- página (convenção pdf-lib). Frontend converte de coords de canvas (top-left)
-- pra essa convenção antes de salvar.
--
-- Tipos:
--   ASSINATURA — caixa pra imagem PNG do signature_pad
--   DATA       — auto-preenche com assinadoAt (texto "DD/MM/AAAA")
--   NOME       — auto-preenche com assinantNome
--   CPF        — auto-preenche com assinanteCpf
--
-- signatarioIndex: pra Fase 2 (múltiplos signatários). Por ora todos 0.
-- valorPreenchido: vazio até cliente preencher; depois guarda o conteúdo
-- (texto pra DATA/NOME/CPF; path do PNG pra ASSINATURA).

CREATE TABLE IF NOT EXISTS assinatura_campos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assinaturaId INT NOT NULL,
  signatarioIndex INT NOT NULL DEFAULT 0,
  tipo ENUM('ASSINATURA','DATA','NOME','CPF') NOT NULL,
  pagina INT NOT NULL,
  x DOUBLE NOT NULL,
  y DOUBLE NOT NULL,
  largura DOUBLE NOT NULL,
  altura DOUBLE NOT NULL,
  obrigatorio BOOLEAN NOT NULL DEFAULT TRUE,
  valorPreenchido TEXT NULL,
  createdAtCampo TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updatedAtCampo TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_assinatura_campos_assinatura (assinaturaId),
  INDEX idx_assinatura_campos_signatario (assinaturaId, signatarioIndex)
);
