-- Estágio do contato: separa LEAD (em atendimento, ainda não fechou) de
-- CLIENTE (fechou contrato). É o mesmo cadastro mudando de estágio — não
-- criamos tabela nova nem duplicamos dados.
--
-- DEFAULT 'cliente' é proposital: toda linha JÁ existente continua como
-- Cliente (decisão do dono: não reclassificar a base atual). Só contatos
-- NOVOS vindos do atendimento/WhatsApp entram como 'lead' — isso é marcado
-- explicitamente no código (criarOuReutilizarContato), não pelo default.
--
-- Vira 'cliente' quando um fechamento é registrado (lead → fechado_ganho),
-- via clientes.registrarFechamento / crm.atualizarLead. Reversível à mão
-- por clientes.definirEstagio.
ALTER TABLE `contatos`
  ADD COLUMN `estagioContato` ENUM('lead', 'cliente') NOT NULL DEFAULT 'cliente';
