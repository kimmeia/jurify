-- WhatsApp comercial informado pelo dono (25/08/2026): DDI 55 + DDD 85.
-- Os botões "Falar com a gente" da LP e do /plans montam wa.me/<valor>
-- direto, então o número é gravado já em formato internacional.
-- Editável a qualquer momento em /admin/settings (aba Sistema).
INSERT INTO config_sistema (chave, valor)
VALUES ('whatsapp_comercial', '5585991080343')
ON DUPLICATE KEY UPDATE valor = VALUES(valor);
