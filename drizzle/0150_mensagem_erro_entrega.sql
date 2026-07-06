-- Motivo da falha de entrega reportado pela Meta (webhook de status `failed`).
-- Antes o webhook só marcava status="falha" e descartava `statuses[].errors[]`,
-- então a razão real (ex: "131026: Message undeliverable") sumia. Agora
-- persistimos o código+título aqui pra UI/execução mostrarem o porquê.
ALTER TABLE `mensagens` ADD COLUMN `erroEntrega` text DEFAULT NULL;
