-- Resumo diário das movimentações.
--
-- O ponto do resumo é o advogado não precisar abrir nem o sistema: chega no
-- e-mail (versão completa, com a íntegra citada) e no WhatsApp (só o que
-- exige ação) com o prazo já calculado.
--
-- Configuração por escritório, não global: o horário útil de um escritório em
-- Fortaleza não é o de um em Manaus, e o disparo respeita `fusoHorario`.
ALTER TABLE escritorios ADD COLUMN resumoDiarioAtivo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE escritorios ADD COLUMN resumoDiarioHora INT NOT NULL DEFAULT 7;
ALTER TABLE escritorios ADD COLUMN resumoDiarioSomenteUteis BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE escritorios ADD COLUMN resumoDiarioEmail VARCHAR(255) DEFAULT NULL;
ALTER TABLE escritorios ADD COLUMN resumoDiarioWhatsapp VARCHAR(32) DEFAULT NULL;
-- Nome do template aprovado na Meta. WhatsApp fora da janela de 24h só sai
-- por template (HSM); sem ele o envio é recusado e o status registra isso em
-- vez de a UI mostrar "enviado" pra uma mensagem que nunca chegou.
ALTER TABLE escritorios ADD COLUMN resumoDiarioTemplate VARCHAR(128) DEFAULT NULL;

-- Log de envios. Existe pelo mesmo motivo de `convites_colaborador
-- .ultimoErroEmail`: falha em integração externa que vive só no response
-- some, e o painel fica mostrando "ok" estagnado enquanto ninguém recebe
-- nada. Aqui cada disparo grava o resultado real de cada canal.
CREATE TABLE IF NOT EXISTS resumo_diario_envios (
  id INT NOT NULL AUTO_INCREMENT,
  escritorioIdResumo INT NOT NULL,
  -- Dia de referência no fuso do escritório (YYYY-MM-DD). Junto com o canal
  -- forma a chave de idempotência: reinício do processo não redispara.
  dataRefResumo VARCHAR(10) NOT NULL,
  canalResumo ENUM('email','whatsapp') NOT NULL,
  statusResumo ENUM('enviado','falha','sem_conteudo','nao_configurado') NOT NULL,
  destinoResumo VARCHAR(255),
  erroResumo VARCHAR(500),
  exigemAcaoResumo INT NOT NULL DEFAULT 0,
  relevantesResumo INT NOT NULL DEFAULT 0,
  rotinaResumo INT NOT NULL DEFAULT 0,
  criadoEmResumo TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_resumo_dia_canal (escritorioIdResumo, dataRefResumo, canalResumo),
  INDEX idx_resumo_escritorio_data (escritorioIdResumo, dataRefResumo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
