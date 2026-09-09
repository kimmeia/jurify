-- Superlançamento do Monitoramento Processual (mockup aprovado 25/08).
--
-- 1) Campos novos de plano: preço "sob consulta" (LP esconde o número e
--    mostra botão de conversa), limite separado de monitoramentos por
--    CPF/CNPJ (novas ações — serviço distinto de vigiar processo), e o CTA
--    de demonstração (card do Completo).
ALTER TABLE planos ADD COLUMN preco_sob_consulta BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE planos ADD COLUMN max_monitoramentos_cpf INT DEFAULT NULL;
ALTER TABLE planos ADD COLUMN cta_demonstracao BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Config global chave/valor (whatsapp_comercial dos botões da LP).
CREATE TABLE IF NOT EXISTS config_sistema (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chave VARCHAR(64) NOT NULL UNIQUE,
  valor TEXT,
  atualizado_por INT DEFAULT NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3) Os dois planos novos do lançamento — sob consulta, trial 14 dias.
--    Preço 0 é intencional: o número real é fechado na conversa e aplicado
--    por escritório (ferramentas da Fase 3). Tudo editável no painel.
INSERT INTO planos (
  slug, nome, descricao, publico_alvo, preco_mensal_centavos, preco_anual_centavos,
  trial_dias, max_usuarios, max_armazenamento_mb, max_clientes, max_conexoes_whatsapp,
  max_agentes_ia, max_monitoramentos_processos, max_monitoramentos_cpf,
  creditos_calculos_mes, jurisia_mensagens_mes, modulos_liberados, features,
  preco_sob_consulta, popular, oculto, ordem
) VALUES
(
  'monitoramento-essencial', 'Monitoramento Essencial',
  'Pra quem advoga sozinho e quer dormir tranquilo.',
  'Pra quem advoga sozinho e quer dormir tranquilo.',
  0, NULL, 14, 2, 1024, NULL, 0, 0, 50, 10, 0, 0,
  JSON_ARRAY('dashboard','configuracoes','processos'),
  JSON_ARRAY(
    'Vigia 50 processos — alerta de movimentação com resumo em português',
    'Vigia 10 CPFs/CNPJs — descobre ação nova contra/para seu cliente',
    'Prazos e audiências organizados por dia',
    'Cadastro de clientes + resumo diário por e-mail',
    '2 usuários'
  ),
  TRUE, FALSE, FALSE, 1
),
(
  'monitoramento-profissional', 'Monitoramento Profissional',
  'Pra escritórios com carteira de processos pra valer.',
  'Pra escritórios com carteira de processos pra valer.',
  0, NULL, 14, 5, 5120, NULL, 0, 0, 200, 50, 50, 0,
  JSON_ARRAY('dashboard','configuracoes','processos','calculos','relatorios'),
  JSON_ARRAY(
    'Tudo do Essencial, e mais:',
    'Vigia 200 processos',
    'Vigia 50 CPFs/CNPJs (ações novas)',
    'Cálculos jurídicos (trabalhista, bancário, previdenciário…)',
    'Relatórios do escritório em PDF',
    '5 usuários'
  ),
  TRUE, TRUE, FALSE, 2
);

-- 4) Vitrine do lançamento: os planos antigos com preço saem da LP (quem já
--    assina não muda nada), e o Completo vira sob consulta com CTA de
--    demonstração — textos alinhados ao mockup aprovado.
UPDATE planos SET oculto = TRUE, popular = FALSE
  WHERE slug IN ('free','basico','intermediario');
UPDATE planos SET
  nome = 'JuridFlow Completo',
  descricao = 'O escritório inteiro num lugar só — do WhatsApp ao boleto.',
  publico_alvo = 'O escritório inteiro num lugar só — do WhatsApp ao boleto.',
  preco_sob_consulta = TRUE,
  cta_demonstracao = TRUE,
  popular = FALSE,
  oculto = FALSE,
  ordem = 3,
  features = JSON_ARRAY(
    'Tudo do Profissional, e mais:',
    'Atendimento no WhatsApp com IA (API oficial da Meta)',
    'Financeiro: Pix, boleto, cartão e cobrança automática',
    'Funil de vendas, agenda completa e automações',
    'Contratos com assinatura digital',
    'Processos, CPFs e usuários sob medida'
  )
  WHERE slug = 'completo';
