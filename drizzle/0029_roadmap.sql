-- Roadmap público — sugestões dos clientes + votação
-- Etapa 3/4 do checklist pré-lançamento.

CREATE TABLE IF NOT EXISTS roadmap_itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT NOT NULL,
  categoriaRoadmap ENUM('feature','bug','melhoria') NOT NULL DEFAULT 'melhoria',
  statusRoadmap ENUM('novo','em_analise','planejado','em_desenvolvimento','lancado','recusado') NOT NULL DEFAULT 'novo',
  criadoPor INT NOT NULL,
  contagemVotos INT NOT NULL DEFAULT 0,
  createdAtRoadmap TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtRoadmap TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX roadmap_itens_status_idx (statusRoadmap),
  INDEX roadmap_itens_votos_idx (contagemVotos)
);

CREATE TABLE IF NOT EXISTS roadmap_votos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  itemId INT NOT NULL,
  userId INT NOT NULL,
  createdAtVoto TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY roadmap_votos_item_user_unique (itemId, userId)
);
