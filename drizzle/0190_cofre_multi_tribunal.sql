-- Uma credencial do PDPJ vale em todos os PJe.
--
-- O login é nacional: o mesmo CPF/OAB entra em qualquer tribunal com PJe. O
-- cofre, porém, amarrava cada credencial a UM sistema (`pje_tjce`), então
-- monitorar processo de outro estado exigia cadastrar a mesma pessoa de novo
-- — a mesma senha guardada N vezes, e N credenciais quase idênticas na lista.
--
-- Duas mudanças sustentam o alcance nacional:
--
-- 1. A SESSÃO PASSA A SER POR TRIBUNAL. Cada PJe é um portal com cookies
--    próprios (pje.tjce.jus.br × pje.tjmg.jus.br). Com uma credencial
--    servindo vários estados e uma sessão só, o primeiro processo de MG
--    derrubaria a sessão do CE, e o PDPJ passaria a ver login atrás de login
--    da mesma conta — caminho curto pra bloqueio.
--
-- 2. O ESTADO DE CADA TRIBUNAL É REGISTRADO. Dos 12 estados no motor, só o
--    TJCE foi validado com login real; os outros têm a URL derivada do padrão
--    e nunca foram usados. Guardar isso permite a tela dizer "não testado" em
--    vez de prometer que funciona.

ALTER TABLE cofre_sessoes
  ADD COLUMN tribunalSessao VARCHAR(16) DEFAULT NULL;

-- Sessão que já existia é do tribunal do próprio sistema da credencial
-- (`pje_tjce` → `tjce`). Sem isto, a sessão viva do TJCE viraria órfã no
-- deploy e o primeiro acesso faria login à toa.
UPDATE cofre_sessoes s
  JOIN cofre_credenciais c ON c.id = s.credencialId
   SET s.tribunalSessao = SUBSTRING(c.sistema, 5)
 WHERE s.tribunalSessao IS NULL
   AND c.sistema LIKE 'pje\_tj%';

CREATE INDEX idx_cofre_sessao_cred_trib ON cofre_sessoes (credencialId, tribunalSessao);

-- Situação de uma credencial em UM tribunal. Uma linha por par.
CREATE TABLE IF NOT EXISTS cofre_credencial_tribunais (
  id INT NOT NULL AUTO_INCREMENT,
  credencialIdCT INT NOT NULL,
  tribunalCT VARCHAR(16) NOT NULL,
  -- `nao_testado` é o estado inicial e é uma informação, não um defeito:
  -- diz que ninguém ainda entrou nesse portal com essa credencial.
  statusCT ENUM('nao_testado','ativa','erro') NOT NULL DEFAULT 'nao_testado',
  ultimoErroCT TEXT DEFAULT NULL,
  ultimoSucessoEmCT TIMESTAMP NULL DEFAULT NULL,
  ultimaTentativaEmCT TIMESTAMP NULL DEFAULT NULL,
  createdAtCT TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtCT TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cofre_cred_tribunal (credencialIdCT, tribunalCT)
);
