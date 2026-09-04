-- Novas Ações separadas por polo (pedido do dono, 04/09).
--
-- O polo do cliente morava dentro do JSON do evento; a aba não tinha como
-- filtrar nem contar por ele, e a ação que o próprio escritório ajuizou
-- aparecia misturada com a ação movida contra o cliente. Coluna própria,
-- aditiva: tudo que existe nasce "desconhecido" e é preenchido pelo que o
-- robô já tinha gravado no JSON.

ALTER TABLE eventos_processo
  ADD COLUMN poloClienteEvento ENUM('ativo','passivo','terceiro','desconhecido') NOT NULL DEFAULT 'desconhecido';

CREATE INDEX idx_eventos_proc_escr_tipo_polo
  ON eventos_processo (escritorioId, tipoEvento, poloClienteEvento);

-- CASE garante que JSON_EXTRACT só roda em JSON válido (uma linha corrompida
-- abortaria o UPDATE inteiro).
UPDATE eventos_processo
  SET poloClienteEvento = CASE
    WHEN conteudoJson IS NOT NULL AND JSON_VALID(conteudoJson)
      THEN JSON_UNQUOTE(JSON_EXTRACT(conteudoJson, '$.poloDoCliente'))
    END
  WHERE tipoEvento = 'nova_acao'
    AND (CASE
      WHEN conteudoJson IS NOT NULL AND JSON_VALID(conteudoJson)
        THEN JSON_UNQUOTE(JSON_EXTRACT(conteudoJson, '$.poloDoCliente'))
      END) IN ('ativo','passivo','terceiro');

-- Ação em que o cliente é o autor era silenciada com lido=TRUE e sumia das
-- Pendentes. Agora ela tem gaveta própria (sem alerta) e volta a aparecer
-- lá — só a que foi silenciada POR ESSE motivo; baseline e pré-cadastro
-- continuam quietos.
UPDATE eventos_processo
  SET lido = FALSE
  WHERE tipoEvento = 'nova_acao'
    AND resolucaoEvento = 'pendente'
    AND poloClienteEvento = 'ativo'
    AND (CASE
      WHEN conteudoJson IS NOT NULL AND JSON_VALID(conteudoJson)
        THEN JSON_UNQUOTE(JSON_EXTRACT(conteudoJson, '$.motivoSilencio'))
      END) = 'polo_ativo';
