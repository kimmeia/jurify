-- Conta liberada na mão pelo admin (cortesia) não pode ficar presa no
-- "confirme seu e-mail" — demo com e-mail fictício nunca confirma. O fluxo
-- novo já marca na concessão; este backfill destrava as que JÁ tinham
-- cortesia (ex.: a conta demo criada em 26/08).
UPDATE users u
JOIN subscriptions s ON s.userId = u.id AND s.cortesia = 1
SET u.email_verificado = 1, u.email_verificado_em = NOW()
WHERE u.email_verificado = 0;
