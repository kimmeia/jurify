-- Teor do documento vinculado à movimentação.
--
-- Até aqui `conteudo` guardava só o RÓTULO do movimento na timeline do PJe
-- ("Remetidos os Autos para Instância Superior", "Julgado procedente o
-- pedido"). O documento em si — o despacho/decisão/sentença que o juiz
-- assinou — nunca era baixado, então a IA resumia um rótulo de 60 chars e
-- devolvia o mesmo rótulo com outras palavras. Daí a sensação de que o
-- monitoramento "só avisa quais processos mexeram".
--
-- `teorStatus` é o que permite ser honesto na UI quando não dá pra ler:
--   pendente      — ainda não tentamos (default das linhas antigas)
--   ok            — texto extraído
--   sem_documento — a movimentação não tem documento anexo (rotina, em geral)
--   indisponivel  — segredo de justiça / sigiloso / sem permissão
--   erro          — falha técnica (timeout, PDF escaneado, parser)
--
-- Non-destrutivo: colunas nullable com default; movimentações antigas ficam
-- em 'pendente' e podem ser reprocessadas sob demanda.
ALTER TABLE eventos_processo ADD COLUMN teorUrl VARCHAR(1024) DEFAULT NULL;
ALTER TABLE eventos_processo ADD COLUMN teorNome VARCHAR(255) DEFAULT NULL;
ALTER TABLE eventos_processo ADD COLUMN teor MEDIUMTEXT DEFAULT NULL;
ALTER TABLE eventos_processo ADD COLUMN teorStatus ENUM('pendente','ok','sem_documento','indisponivel','erro') NOT NULL DEFAULT 'pendente';
ALTER TABLE eventos_processo ADD COLUMN teorTentativas INT NOT NULL DEFAULT 0;
ALTER TABLE eventos_processo ADD COLUMN teorErro VARCHAR(255) DEFAULT NULL;
ALTER TABLE eventos_processo ADD COLUMN teorObtidoEm TIMESTAMP NULL DEFAULT NULL;

-- Análise IA estruturada (JSON dentro de TEXT). Difere de `resumoIa` porque
-- carrega os campos que o painel precisa responder sem abrir o processo:
-- o que foi decidido, a quem favorece, se o prazo é NOSSO, quantos dias, e
-- o trecho literal do documento que fundamenta o prazo.
ALTER TABLE eventos_processo ADD COLUMN analiseJson TEXT DEFAULT NULL;

-- O worker varre por status; sem índice ele faz full scan numa tabela que
-- cresce sem teto (1 linha por movimentação de cada processo monitorado).
CREATE INDEX idx_eventos_teor_status ON eventos_processo (teorStatus, id);
