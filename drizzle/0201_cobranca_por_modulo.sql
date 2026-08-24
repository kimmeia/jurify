-- Cobrança por módulo (Fase 3 da modularização — cena 1 do mockup aprovado).
--
-- 1) Catálogo: cada módulo vendável ganha um preço mensal avulso, editável
--    pelo admin sem deploy. Vale pra venda avulsa e pra mostrar a soma da
--    cesta ao montar pacotes. Começa em 0 ("a definir") de propósito: preço
--    ilustrativo do mockup não pode virar cobrança real por acidente.
CREATE TABLE IF NOT EXISTS modulos_catalogo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  modulo VARCHAR(48) NOT NULL UNIQUE,
  preco_mensal_centavos INT NOT NULL DEFAULT 0,
  atualizado_por INT DEFAULT NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2) Assentos de atendente por plano. NULL em atendentes_inclusos = plano
--    sem cobrança por assento (comportamento de hoje — nenhum tenant muda
--    de fatura no deploy). Adicional 0 = não cobra excedente mesmo contando.
ALTER TABLE planos ADD COLUMN atendentes_inclusos INT DEFAULT NULL;
ALTER TABLE planos ADD COLUMN preco_atendente_adicional_centavos INT NOT NULL DEFAULT 0;

-- 3) Desconto por escritório — percentual ou valor fixo, com validade
--    opcional, aplicado na fatura inteira (pacote + avulsos + adicionais).
ALTER TABLE escritorios ADD COLUMN desconto_tipo VARCHAR(16) DEFAULT NULL;
ALTER TABLE escritorios ADD COLUMN desconto_valor INT NOT NULL DEFAULT 0;
ALTER TABLE escritorios ADD COLUMN desconto_valido_ate TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE escritorios ADD COLUMN desconto_observacao VARCHAR(255) DEFAULT NULL;
