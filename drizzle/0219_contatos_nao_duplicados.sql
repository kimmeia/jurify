-- Conferência de cadastros (mockup aprovado em 09/09/2026, decisão 2):
-- "Não é duplicado" tira o grupo (mesmo telefone ou mesmo CPF) da conta em
-- toda tela — relatório, botão "Possíveis duplicados", PDF e planilha — e
-- fica reversível na aba própria. A chave é a do agrupamento: DDD + 8
-- dígitos pra telefone, só dígitos pra CPF/CNPJ.
CREATE TABLE IF NOT EXISTS contatos_nao_duplicados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdNaoDup INT NOT NULL,
  tipoNaoDup ENUM('telefone','cpf') NOT NULL,
  chaveNaoDup VARCHAR(32) NOT NULL,
  marcadoPorNaoDup INT DEFAULT NULL,
  createdAtNaoDup TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_nao_dup (escritorioIdNaoDup, tipoNaoDup, chaveNaoDup)
);
