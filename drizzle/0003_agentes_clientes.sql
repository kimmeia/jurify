-- Migration: Agentes IA + Módulo Clientes
-- Executar: mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME < drizzle/0003_agentes_clientes.sql

CREATE TABLE IF NOT EXISTS agentes_ia (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioId INT NOT NULL,
  nome VARCHAR(128) NOT NULL,
  descricao VARCHAR(512),
  modelo VARCHAR(64) NOT NULL DEFAULT 'gpt-4o-mini',
  prompt TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT false,
  canalId INT,
  openaiApiKey TEXT,
  apiKeyIv VARCHAR(64),
  apiKeyTag VARCHAR(64),
  maxTokens INT NOT NULL DEFAULT 500,
  temperatura VARCHAR(10) NOT NULL DEFAULT '0.70',
  createdAtAgente TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updatedAtAgente TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_agentes_escritorio (escritorioId),
  INDEX idx_agentes_canal (canalId)
);

CREATE TABLE IF NOT EXISTS cliente_arquivos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioId INT NOT NULL,
  contatoId INT NOT NULL,
  nome VARCHAR(255) NOT NULL,
  tipo VARCHAR(64),
  tamanho INT,
  url TEXT NOT NULL,
  uploadPor INT,
  createdAtArquivo TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_arquivos_contato (contatoId),
  INDEX idx_arquivos_escritorio (escritorioId)
);

CREATE TABLE IF NOT EXISTS cliente_anotacoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioId INT NOT NULL,
  contatoId INT NOT NULL,
  titulo VARCHAR(255),
  conteudo TEXT NOT NULL,
  criadoPor INT,
  createdAtAnotacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updatedAtAnotacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_anotacoes_contato (contatoId),
  INDEX idx_anotacoes_escritorio (escritorioId)
);

-- Assinaturas digitais de documentos
CREATE TABLE IF NOT EXISTS assinaturas_digitais (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioId INT NOT NULL,
  contatoId INT NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  descricao VARCHAR(512),
  statusAssinatura ENUM('pendente','enviado','visualizado','assinado','recusado','expirado') NOT NULL DEFAULT 'pendente',
  documentoUrl TEXT,
  documentoAssinadoUrl TEXT,
  assinantNome VARCHAR(255),
  assinantEmail VARCHAR(320),
  assinantTelefone VARCHAR(20),
  tokenAssinatura VARCHAR(128) UNIQUE,
  enviadoPor INT,
  enviadoAt TIMESTAMP,
  visualizadoAt TIMESTAMP,
  assinadoAt TIMESTAMP,
  ipAssinatura VARCHAR(45),
  expiracaoAt TIMESTAMP,
  createdAtAssinatura TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updatedAtAssinatura TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_assinatura_contato (contatoId),
  INDEX idx_assinatura_escritorio (escritorioId),
  INDEX idx_assinatura_token (tokenAssinatura)
);

-- Campos extras para distribuição inteligente de atendentes
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS ultimaAtividade TIMESTAMP AFTER recebeLeadsAutomaticos;
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS ultimaDistribuicao TIMESTAMP AFTER ultimaAtividade;
