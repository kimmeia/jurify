-- Ponto digital: uma linha por colaborador por dia.
--
-- Um registro por dia, e não um log de eventos, porque o que a tela mostra é o
-- espelho do mês: uma linha por dia, com entrada, pausa e saída. Log de
-- eventos daria a mesma informação depois de agrupar, e o agrupamento seria
-- refeito a cada leitura. Ajuste do gestor sobrescreve o campo e deixa rastro
-- em `ajustadoPor`/`ajustadoEm`/`observacao`.
--
-- As colunas de ORIGEM são o motivo de tudo isto existir: entrada e saída
-- podem vir do login, da última atividade ou da mão do gestor, e cada uma vale
-- uma coisa diferente. Jornada calculada em cima de saída inferida não pode se
-- passar por jornada batida.

CREATE TABLE IF NOT EXISTS ponto_dias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdPonto INT NOT NULL,
  colaboradorIdPonto INT NOT NULL,
  -- Data no fuso do escritório (YYYY-MM-DD). Guardada como texto porque o
  -- "dia" do ponto é o dia civil de quem trabalha, não um instante UTC.
  diaPonto VARCHAR(10) NOT NULL,

  entradaEmPonto TIMESTAMP NULL DEFAULT NULL,
  entradaOrigemPonto ENUM('login','manual') NULL DEFAULT NULL,

  pausaInicioEmPonto TIMESTAMP NULL DEFAULT NULL,
  pausaFimEmPonto TIMESTAMP NULL DEFAULT NULL,

  saidaEmPonto TIMESTAMP NULL DEFAULT NULL,
  saidaOrigemPonto ENUM('registrada','atividade','manual') NULL DEFAULT NULL,

  -- Último sinal de vida no sistema naquele dia. É o que salva o ponto de quem
  -- fechou o navegador sem clicar em sair — que é quase todo mundo.
  ultimaAtividadeEmPonto TIMESTAMP NULL DEFAULT NULL,

  ajustadoPorPonto INT NULL DEFAULT NULL,
  ajustadoEmPonto TIMESTAMP NULL DEFAULT NULL,
  observacaoPonto VARCHAR(255) NULL DEFAULT NULL,

  createdAtPonto TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtPonto TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY ponto_colab_dia (colaboradorIdPonto, diaPonto),
  KEY idx_ponto_esc_dia (escritorioIdPonto, diaPonto)
);
