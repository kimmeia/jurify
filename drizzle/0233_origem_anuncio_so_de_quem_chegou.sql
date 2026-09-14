-- Origem de anúncio só de quem CHEGOU pelo anúncio.
--
-- A Meta anexa o bloco `referral` também a mensagens de quem já conversava com
-- a empresa por uma thread que um dia veio de anúncio — inclusive a texto
-- digitado à mão, meses depois. Até aqui isso carimbava cliente antigo como
-- "chegou por um anúncio": conversa de agosto aparecia com anúncio de setembro
-- no topo, e o relatório contava como lead novo quem a campanha não trouxe.
--
-- O critério é a própria data: origem gravada DEPOIS da criação do contato
-- significa que ele já existia quando o anúncio chegou. Lead que nasceu do
-- clique tem as duas no mesmo instante — a folga de 5 minutos cobre a diferença
-- entre criar a ficha e gravar a origem no mesmo atendimento.
--
-- Limpa só as duas colunas. Nenhum contato, conversa, mensagem ou lead é
-- tocado: o que sai é a afirmação errada, não o histórico.
UPDATE contatos
   SET origemAnuncio = NULL,
       origemAnuncioEm = NULL
 WHERE origemAnuncio IS NOT NULL
   AND origemAnuncioEm IS NOT NULL
   AND origemAnuncioEm > createdAtContato + INTERVAL 5 MINUTE;
