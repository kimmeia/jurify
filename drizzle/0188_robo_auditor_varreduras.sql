-- Histórico de varreduras do robô auditor.
--
-- A varredura agendada nasceu reportando só no Sentry. Com o DSN do backend
-- ausente, `captureError` é no-op silencioso: o achado sumia e o painel de
-- erros vazio passava a impressão de banco saudável — que é o oposto do que
-- um auditor deve produzir. Persistindo aqui, "nada em aberto" vira uma
-- afirmação que dá pra conferir contra a hora da última varredura.
--
-- Guarda o AGREGADO, não as linhas violadas: as linhas envelhecem em
-- minutos e a varredura seguinte as recalcula do zero. O que tem valor no
-- histórico é a curva — número de achados caindo é sinal de saúde do app,
-- subindo é regressão. O detalhe por regra fica em JSON porque o consumo é
-- sempre "a linha inteira daquela varredura", nunca uma busca por campo.

CREATE TABLE IF NOT EXISTS robo_auditor_varreduras (
  id INT AUTO_INCREMENT PRIMARY KEY,

  -- Carimbo legível da execução (YYYYMMDDTHHMMSS), o mesmo que vai no log
  -- estruturado — é por ele que se cruza painel e log do Railway.
  runIdVarredura VARCHAR(32) NOT NULL,

  -- Separa o que o cron viu do que alguém pediu pelo botão. Sem isso,
  -- "a última varredura" fica ambígua justo quando se quer saber se o
  -- agendamento está de pé.
  origemVarredura ENUM('cron','manual') NOT NULL DEFAULT 'cron',

  iniciadoEmVarredura TIMESTAMP NOT NULL,
  latenciaMsVarredura INT NOT NULL DEFAULT 0,

  regrasExecutadasVarredura INT NOT NULL DEFAULT 0,
  achadosVarredura INT NOT NULL DEFAULT 0,
  linhasAfetadasVarredura INT NOT NULL DEFAULT 0,
  regrasComErroVarredura INT NOT NULL DEFAULT 0,

  -- JSON: [{ id, severidade, total, erro? }], uma entrada por regra —
  -- inclusive as limpas, pra dar pra ver quando uma regra passou a violar.
  detalhePorRegraVarredura TEXT,

  createdAtVarredura TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_robo_varredura_created (createdAtVarredura)
);
