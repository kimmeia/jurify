-- Config de ligação por escritório (definida pelo dono/gestor, vale pra todos):
--   transbordoAtivoChamCfg: se TRUE, chamada não atendida pelo responsável em
--     ~15s transborda (toca) pros atendentes disponíveis. Default FALSE
--     (sem escalonamento automático).
--   modoJanelaChamCfg: 'overlay' = pop-up tela cheia; 'discreto' = widget
--     pisca + som (sem cobrir a tela). Default 'overlay' (comportamento atual).
CREATE TABLE IF NOT EXISTS chamada_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdChamCfg INT NOT NULL,
  transbordoAtivoChamCfg BOOLEAN NOT NULL DEFAULT FALSE,
  modoJanelaChamCfg VARCHAR(20) NOT NULL DEFAULT 'overlay',
  atualizadoEmChamCfg TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY chamada_config_esc_uq (escritorioIdChamCfg)
);
