-- =====================================================
-- Migration: Tarefas / To-dos
-- Executar: mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME < drizzle/0005_tarefas.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS tarefas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdTarefa INT NOT NULL,
  contatoIdTarefa INT,
  processoIdTarefa INT,
  responsavelIdTarefa INT,
  criadoPorTarefa INT NOT NULL,
  tituloTarefa VARCHAR(255) NOT NULL,
  descricaoTarefa TEXT,
  statusTarefa ENUM('pendente','em_andamento','concluida','cancelada') NOT NULL DEFAULT 'pendente',
  prioridadeTarefa ENUM('baixa','normal','alta','urgente') NOT NULL DEFAULT 'normal',
  dataVencimento TIMESTAMP,
  concluidaAt TIMESTAMP,
  createdAtTarefa TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updatedAtTarefa TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_tarefas_escritorio (escritorioIdTarefa),
  INDEX idx_tarefas_contato (contatoIdTarefa),
  INDEX idx_tarefas_responsavel (responsavelIdTarefa),
  INDEX idx_tarefas_status (statusTarefa),
  INDEX idx_tarefas_vencimento (dataVencimento)
);
