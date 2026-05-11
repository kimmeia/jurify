-- Migration 0090: origens de lead configuráveis por escritório.
--
-- Antes: o campo `origemLead` em `leads` aceita texto livre (varchar 128)
-- mas o select da UI era hardcoded com 5 opções fixas (indicacao, ligacao,
-- evento, presencial, manual). Toda nova opção exigia PR.
--
-- Agora cada escritório tem sua própria lista, configurável em
-- Configurações. Valores antigos em `leads.origemLead` continuam
-- funcionando: bate por texto.
--
-- Seed das 5 padrão (indicação, ligação, evento, presencial, outro) é
-- feito preguiçosamente na primeira listagem via `garantirOrigensLeadPadrao`
-- (mesmo padrão de `garantirCategoriasPadrao` no financeiro).

CREATE TABLE origens_lead (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  escritorioIdOrigem INT NOT NULL,
  nomeOrigem VARCHAR(80) NOT NULL,
  ordemOrigem INT NOT NULL DEFAULT 0,
  ativoOrigem BOOLEAN NOT NULL DEFAULT TRUE,
  createdAtOrigem TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX origens_escritorio_idx (escritorioIdOrigem, ativoOrigem, ordemOrigem),
  UNIQUE KEY origens_escr_nome_uq (escritorioIdOrigem, nomeOrigem)
);
