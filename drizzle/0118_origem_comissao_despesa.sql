-- Adiciona 'comissao' no enum origem de despesas pra marcar despesas
-- criadas automaticamente quando uma comissão é fechada
-- (db-comissoes.ts:fecharComissao cria despesa com descrição "Comissão {nome} — {período}").
--
-- Necessário pro frontend distinguir visualmente "Despesa normal" vs
-- "Comissão" na lista unificada — não precisa de JOIN com comissoesFechadas.
-- Backfill: marca despesas existentes com prefixo "Comissão " como origem='comissao'.

ALTER TABLE despesas
  MODIFY COLUMN origemDesp ENUM('manual', 'taxa_asaas', 'recorrencia', 'extrato_asaas', 'comissao')
  NOT NULL DEFAULT 'manual';

UPDATE despesas
  SET origemDesp = 'comissao'
  WHERE descricaoDesp LIKE 'Comissão %'
    AND origemDesp = 'manual';
