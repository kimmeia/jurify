-- Créditos viram limite do plano (decisão do dono, 11/09/2026).
--
-- Antes: processos vigiados e CPFs vigiados tinham limite de VAGA no plano e
-- também consumiam crédito; consulta, busca por documento e resumo de IA
-- consumiam só crédito; e cálculo não consumia nada, apesar de o plano vender
-- um número de cálculos por mês. Duas réguas para a mesma coisa.
--
-- Agora: vaga continua vaga, e cada operação avulsa tem um teto mensal escrito
-- no plano, com contador que zera na virada do mês.
--
-- Grandfather: as colunas nascem NULL e `0` também significa "sem limite" —
-- nenhum plano existente passa a barrar nada por causa desta migration. Só
-- barra o plano onde o número for escrito de propósito.

ALTER TABLE planos
  ADD COLUMN max_consultas_processo_mes INT DEFAULT NULL,
  ADD COLUMN max_buscas_documento_mes   INT DEFAULT NULL,
  ADD COLUMN max_resumos_ia_mes         INT DEFAULT NULL;

-- Contador de uso por mês. `extraConcedido` é o que o painel libera quando o
-- escritório pede mais: vale só naquela competência, não vira saldo.
CREATE TABLE IF NOT EXISTS escritorio_uso_mensal (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  escritorioId    INT NOT NULL,
  competencia     VARCHAR(7) NOT NULL,
  operacao        VARCHAR(40) NOT NULL,
  quantidade      INT NOT NULL DEFAULT 0,
  extraConcedido  INT NOT NULL DEFAULT 0,
  createdAtUso    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtUso    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unq_uso_escritorio_competencia_operacao (escritorioId, competencia, operacao)
);

-- Os três planos do pacote de 09/09 ganham os tetos que o cartão já promete.
-- Os demais seguem NULL (sem limite), inclusive os de monitoramento: quem
-- vende vaga não precisa de teto mensal de consulta.
UPDATE planos SET max_consultas_processo_mes = 300,  max_buscas_documento_mes = 30,  max_resumos_ia_mes = 40  WHERE slug = 'atende';
UPDATE planos SET max_consultas_processo_mes = 1000, max_buscas_documento_mes = 100, max_resumos_ia_mes = 150 WHERE slug = 'escritorio';
UPDATE planos SET max_consultas_processo_mes = 2500, max_buscas_documento_mes = 300, max_resumos_ia_mes = 400 WHERE slug = 'escala';

-- O saldo de créditos deixa de decidir operação. As tabelas
-- `escritorio_creditos` e as transações NÃO são tocadas: ficam como registro
-- do que já foi gasto (decisão do dono: "param de valer, e nada é apagado").
