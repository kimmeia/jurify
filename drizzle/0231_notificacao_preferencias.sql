-- O que cada pessoa quer receber no celular.
--
-- Guarda SÓ o que diverge do padrão de fábrica (`shared/notificacoes-avisos.ts`):
-- linha ausente quer dizer "como veio de fábrica". É o que permite mudar um
-- padrão depois e alcançar quem nunca mexeu, sem sobrescrever quem mexeu.
--
-- `chave` é o id do aviso ("processos.decisao") ou de um ajuste
-- ("ajuste.silencio-noturno"). Por usuário, não por escritório: o dono e o
-- atendente querem coisas diferentes no mesmo escritório.
CREATE TABLE IF NOT EXISTS notificacao_preferencias (
  idNotifPref INT AUTO_INCREMENT PRIMARY KEY,
  userIdNotifPref INT NOT NULL,
  chaveNotifPref VARCHAR(60) NOT NULL,
  ligadoNotifPref BOOLEAN NOT NULL DEFAULT TRUE,
  createdAtNotifPref TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtNotifPref TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notif_pref (userIdNotifPref, chaveNotifPref),
  KEY idx_notif_pref_user (userIdNotifPref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
