-- Toggle do aviso automático de chamada perdida (WhatsApp). Antes era hardcoded
-- e SEMPRE ligado: toda chamada recebida sem aceite no app disparava um texto
-- livre automático — inclusive em chamadas ATENDIDAS fora do app (bug de falso
-- positivo) e sem o dono ter configurado. Agora é opt-in por escritório,
-- DESLIGADO por padrão (evita disparo automático não solicitado).
ALTER TABLE `chamada_config` ADD COLUMN `avisoPerdidaAtivoChamCfg` boolean NOT NULL DEFAULT false;
