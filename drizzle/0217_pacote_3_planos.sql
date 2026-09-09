-- Pacote de 3 planos (proposta v2 aprovada pelo dono em 09/09/2026):
-- Atendimento no WhatsApp com IA em TODOS, preço por escritório, anual com
-- 2 meses grátis, 14 dias de teste. Atende → Escritório → Escala.
--
-- Os dois planos de Monitoramento saem da vitrine (ficam ocultos: quem está
-- em teste neles continua). O Completo vira "Sob medida" — segue sob
-- consulta, com demonstração: venda consultiva, o cliente não escolhe.
-- Nada é apagado.
INSERT INTO planos (
  slug, nome, descricao, publico_alvo, preco_mensal_centavos, preco_anual_centavos,
  trial_dias, max_usuarios, max_armazenamento_mb, max_clientes, max_conexoes_whatsapp,
  max_agentes_ia, max_monitoramentos_processos, max_monitoramentos_cpf,
  creditos_calculos_mes, jurisia_mensagens_mes, modulos_liberados, features,
  preco_sob_consulta, cta_demonstracao, popular, oculto, ordem
) VALUES
(
  'atende', 'Atende',
  'Pra quem advoga sozinho ou em dupla e não quer perder cliente no WhatsApp.',
  'Pra quem advoga sozinho ou em dupla e não quer perder cliente no WhatsApp.',
  14700, 147000, 14, 2, 2048, NULL, 1, 1, 300, 15, 20, 0,
  JSON_ARRAY('dashboard','configuracoes','atendimento','clientes','kanban','agenda','processos','calculos','agentes_ia'),
  JSON_ARRAY(
    'Atendimento no WhatsApp oficial (API Meta) e Instagram — 1 número',
    '1 atendente IA que responde, qualifica e agenda',
    'Clientes (CRM), funil Kanban e agenda com lembretes',
    'Vigia 300 processos e 15 CPFs/CNPJs (novas ações: TJCE por enquanto)',
    '20 cálculos jurídicos por mês',
    '2 usuários · 2 GB'
  ),
  FALSE, FALSE, FALSE, FALSE, 1
),
(
  'escritorio', 'Escritório',
  'Pra equipes de até 5 que fecham contrato e cobram pelo sistema.',
  'Pra equipes de até 5 que fecham contrato e cobram pelo sistema.',
  29700, 297000, 14, 5, 10240, NULL, 2, 3, 1000, 50, 100, 0,
  JSON_ARRAY('dashboard','configuracoes','atendimento','clientes','kanban','agenda','processos','calculos','agentes_ia','financeiro','contratos','smartflow','relatorios'),
  JSON_ARRAY(
    'Tudo do Atende, e mais:',
    '2 números de WhatsApp e 3 atendentes IA',
    'Financeiro: Pix, boleto, cartão e cobrança automática (Asaas)',
    'Contratos com assinatura digital',
    'SmartFlow: automações de atendimento e cobrança',
    'Vigia 1.000 processos e 50 CPFs/CNPJs (novas ações: TJCE por enquanto)',
    'Relatórios em PDF · 100 cálculos por mês',
    '5 usuários · 10 GB'
  ),
  FALSE, FALSE, TRUE, FALSE, 2
),
(
  'escala', 'Escala',
  'Pra bancas de até 15 pessoas com gestão, comissão e volume.',
  'Pra bancas de até 15 pessoas com gestão, comissão e volume.',
  59700, 597000, 14, 15, 51200, NULL, 5, 10, 2500, 150, 300, 200,
  JSON_ARRAY('dashboard','configuracoes','atendimento','clientes','kanban','agenda','processos','calculos','agentes_ia','financeiro','contratos','smartflow','relatorios','comissoes','ponto','backups','jurisia'),
  JSON_ARRAY(
    'Tudo do Escritório, e mais:',
    '5 números de WhatsApp e 10 atendentes IA',
    'Comissões automáticas por colaborador e ponto da equipe',
    'JurisIA: pesquisa jurisprudencial (200 consultas por mês)',
    'Vigia 2.500 processos e 150 CPFs/CNPJs (novas ações: TJCE por enquanto)',
    'Backup completo do escritório · 300 cálculos por mês',
    '15 usuários · 50 GB'
  ),
  FALSE, FALSE, FALSE, FALSE, 3
);

-- Um selo só: o Escritório é o "mais escolhido".
UPDATE planos SET popular = FALSE WHERE slug <> 'escritorio';

-- Monitoramento Essencial/Profissional saem da vitrine (ocultos, não apagados).
UPDATE planos SET oculto = TRUE WHERE slug IN ('monitoramento-essencial','monitoramento-profissional');

-- Completo vira o 4º cartão consultivo.
UPDATE planos SET
  nome = 'Sob medida',
  descricao = 'Mais de 15 usuários ou 2.500 processos, migração assistida, treinamento e SLA — fechado na conversa.',
  publico_alvo = 'Mais de 15 usuários ou 2.500 processos, migração assistida, treinamento e SLA — fechado na conversa.',
  preco_sob_consulta = TRUE,
  cta_demonstracao = TRUE,
  oculto = FALSE,
  ordem = 4,
  features = JSON_ARRAY(
    'Tudo do Escala, e mais:',
    'Mais de 15 usuários e 2.500 processos vigiados',
    'Migração assistida de outro sistema',
    'Treinamento da equipe e SLA',
    'Valor fechado na conversa'
  )
  WHERE slug = 'completo';
