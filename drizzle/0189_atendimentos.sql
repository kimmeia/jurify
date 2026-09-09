-- Atendimento como episódio, separado da conversa.
--
-- `conversas` é o fio com a pessoa: no WhatsApp nasce no primeiro contato e é
-- reaproveitada pra sempre (resolvida reabre, arquivada é reusada). Por isso
-- ela não consegue responder "quem iniciou atendimento no período" — o
-- segundo atendimento herda a data do primeiro — nem "quanto cada um
-- atendeu", já que `atendenteIdConv` é um campo só que a transferência
-- sobrescreve, migrando o histórico inteiro pro último atendente.
--
-- Esta tabela é o recorte de TRABALHO: início, fim e dono próprios.
--
-- Os dois campos de atendente são o ponto do desenho:
--   * atendenteAbriuAtd  — congelado. É o que responde "quem iniciou".
--   * atendenteAtualAtd  — muda na transferência, sem tocar no de cima.
--
-- `ultimaMensagemEmAtd` existe pra regra do silêncio não precisar varrer
-- `mensagens` a cada chegada: é o relógio que decide se a próxima mensagem
-- entra neste episódio ou abre outro.

CREATE TABLE IF NOT EXISTS atendimentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdAtd INT NOT NULL,
  conversaIdAtd INT NOT NULL,
  -- Redundante com a conversa, e de propósito: todo relatório recorta por
  -- pessoa, e sem esta coluna cada leitura pagaria um join só pra chegar nela.
  contatoIdAtd INT NOT NULL,

  abertoEmAtd TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fechadoEmAtd TIMESTAMP NULL DEFAULT NULL,
  motivoFechamentoAtd ENUM('resolvido','silencio','manual') NULL DEFAULT NULL,

  atendenteAbriuAtd INT NULL DEFAULT NULL,
  atendenteAtualAtd INT NULL DEFAULT NULL,

  ultimaMensagemEmAtd TIMESTAMP NULL DEFAULT NULL,
  -- Primeira resposta DO ESCRITÓRIO neste episódio. Por episódio, e não por
  -- conversa: hoje o tempo de resposta de um cliente que voltou é medido
  -- contra a primeira mensagem que ele mandou meses atrás.
  primeiraRespostaEmAtd TIMESTAMP NULL DEFAULT NULL,

  createdAtAtd TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtAtd TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- A leitura mais quente: "o episódio aberto desta conversa".
  KEY idx_atd_conversa (conversaIdAtd, fechadoEmAtd),
  -- O recorte dos relatórios: episódios abertos no período, por escritório.
  KEY idx_atd_esc_aberto (escritorioIdAtd, abertoEmAtd),
  KEY idx_atd_contato (contatoIdAtd),
  -- Quem iniciou, que é a coluna que a tabela por atendente vai agrupar.
  KEY idx_atd_abriu (atendenteAbriuAtd, abertoEmAtd)
);
