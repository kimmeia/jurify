-- Health-check do webhook Asaas: carimbo do último evento autenticado
-- recebido. Base do alerta "conectado mas sem eventos" e do re-arme da
-- fila interrompida. Non-destrutivo: NULL para configs existentes.
ALTER TABLE asaas_config ADD COLUMN ultimoWebhookEmAsaas TIMESTAMP NULL DEFAULT NULL;
