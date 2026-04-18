-- Migration: Chat interno dos Agentes IA
-- Cria duas tabelas:
--   agente_chat_threads   — 1 linha por "conversa" que o advogado tem com um agente
--   agente_chat_mensagens — mensagens da thread (user, assistant, system)
--
-- Isolado de `conversas`/`mensagens` (que são do Atendimento ao cliente final).

CREATE TABLE IF NOT EXISTS agente_chat_threads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agenteIdThread INT NOT NULL,
  escritorioIdThread INT NOT NULL,
  usuarioIdThread INT NOT NULL,
  tituloThread VARCHAR(200) NOT NULL DEFAULT 'Nova conversa',
  arquivadaThread BOOLEAN NOT NULL DEFAULT false,
  createdAtThread TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updatedAtThread TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_agente_chat_thread_agente (agenteIdThread),
  INDEX idx_agente_chat_thread_usuario (usuarioIdThread),
  INDEX idx_agente_chat_thread_escritorio (escritorioIdThread)
);

CREATE TABLE IF NOT EXISTS agente_chat_mensagens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  threadIdMsg INT NOT NULL,
  roleMsg ENUM('user','assistant','system') NOT NULL,
  conteudoMsg TEXT NOT NULL,
  anexoUrlMsg VARCHAR(1024),
  anexoNomeMsg VARCHAR(255),
  anexoMimeMsg VARCHAR(128),
  anexoConteudoMsg TEXT,
  tokensUsadosMsg INT NOT NULL DEFAULT 0,
  createdAtMsg TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_agente_chat_msg_thread (threadIdMsg)
);
