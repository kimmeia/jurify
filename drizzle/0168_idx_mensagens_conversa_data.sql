-- Índice pro filtro de período do Atendimento.
--
-- O filtro passou a perguntar "esta conversa teve mensagem entre X e Y"
-- (EXISTS em mensagens) em vez de olhar `conversas.ultimaMensagemAt`, que é
-- sobrescrito a cada mensagem nova — por isso só achava conversa cuja ÚLTIMA
-- atividade de todos os tempos caiu na janela, e conversa atendida no período
-- que seguiu recebendo mensagem depois ficava de fora.
--
-- Sem este índice o EXISTS varre `mensagens` inteira por conversa avaliada.
CREATE INDEX idx_mensagens_conversa_data ON mensagens (conversaIdMsg, createdAtMsg);
