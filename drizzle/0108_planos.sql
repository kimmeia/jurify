-- Migration 0108: tabela `planos` unificada (substitui hardcoded em products.ts + planos_overrides)
--
-- A nova tabela é a ÚNICA fonte de verdade pra catálogo de planos.
-- Admin edita tudo via /admin/planos: nome, preço, módulos liberados, limites,
-- features (texto da LP), trial. A LP juridflow.com.br e a página /plans do
-- app passam a puxar daqui.
--
-- A tabela `planos_overrides` antiga será removida em PR futuro depois que
-- todos os callers estiverem migrados (mantemos por 2+ semanas pra rollback).
--
-- Migração de dados em subscriptions:
--   iniciante      -> basico
--   profissional   -> intermediario
--   escritorio     -> completo
-- (Nesse ponto da operação, não há clientes pagantes — só piloto em cortesia
--  que não depende do planId pra acesso. Migration é segura.)

CREATE TABLE planos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  nome VARCHAR(100) NOT NULL,
  descricao VARCHAR(255),
  publico_alvo VARCHAR(255),

  -- Preço (centavos BRL). preco_anual NULL = sem ciclo anual.
  preco_mensal_centavos INT NOT NULL DEFAULT 0,
  preco_anual_centavos INT,

  -- Trial sem cartão. 0 = sem trial.
  trial_dias INT NOT NULL DEFAULT 0,

  -- Limites numéricos. NULL = ilimitado em campos que aceitam.
  -- 999999 também é convenção de "ilimitado" pra compat retroativa.
  max_usuarios INT NOT NULL DEFAULT 1,
  max_armazenamento_mb INT NOT NULL DEFAULT 100,
  max_clientes INT,
  max_conexoes_whatsapp INT NOT NULL DEFAULT 0,
  max_agentes_ia INT NOT NULL DEFAULT 0,
  max_monitoramentos_processos INT,
  creditos_calculos_mes INT NOT NULL DEFAULT 0,

  -- JSON arrays
  modulos_liberados JSON NOT NULL,
  features JSON NOT NULL,

  -- Flags
  popular BOOLEAN NOT NULL DEFAULT FALSE,
  oculto BOOLEAN NOT NULL DEFAULT FALSE,
  ordem INT NOT NULL DEFAULT 0,

  -- Auditoria
  criado_por INT,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_por INT,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_planos_oculto (oculto),
  INDEX idx_planos_ordem (ordem)
);

-- ─── Seed: 4 planos default ─────────────────────────────────────────────────
-- Estes valores espelham a LP atual (juridflow.com.br). Admin pode editar
-- preço/módulos/limites/features depois via /admin/planos sem precisar
-- deploy de código.

INSERT INTO planos (
  slug, nome, descricao, publico_alvo,
  preco_mensal_centavos, preco_anual_centavos, trial_dias,
  max_usuarios, max_armazenamento_mb, max_clientes,
  max_conexoes_whatsapp, max_agentes_ia, max_monitoramentos_processos,
  creditos_calculos_mes,
  modulos_liberados, features,
  popular, oculto, ordem
) VALUES
  (
    'free', 'Free', 'Para conhecer a plataforma', 'Advogado começando',
    0, NULL, 0,
    1, 100, 10,
    0, 0, 0,
    3,
    '["dashboard","configuracoes","clientes","calculos","contratos"]',
    '["1 usuário","Até 10 clientes","3 créditos de cálculos por mês","Modelos de contrato básicos","Suporte por email"]',
    FALSE, FALSE, 1
  ),
  (
    'basico', 'Básico', 'Para advogado autônomo ou dupla', 'Advogado autônomo ou dupla',
    9700, 97000, 14,
    1, 5000, 100,
    0, 0, 0,
    100,
    '["dashboard","configuracoes","clientes","calculos","contratos","financeiro"]',
    '["1 colaborador","Até 100 clientes ativos","Cálculos jurídicos completos","Financeiro com Asaas","Modelos de contrato","Suporte por chat"]',
    FALSE, FALSE, 2
  ),
  (
    'intermediario', 'Intermediário', 'Para escritório pequeno', 'Escritório pequeno (3-10 advogados)',
    24700, 247000, 14,
    5, 20480, NULL,
    1, 0, 0,
    500,
    '["dashboard","configuracoes","clientes","calculos","contratos","financeiro","atendimento","kanban","agenda","smartflow","comissoes"]',
    '["Até 5 colaboradores","Clientes ilimitados","Tudo do Básico, mais:","Atendimento WhatsApp + Instagram","Comissões automáticas","1 conexão WhatsApp","SmartFlow básico"]',
    TRUE, FALSE, 3
  ),
  (
    'completo', 'Completo', 'Para escritório com equipe', 'Escritório com equipe (10+)',
    49700, 497000, 14,
    999999, 102400, NULL,
    999999, 5, NULL,
    999999,
    '["dashboard","configuracoes","clientes","calculos","contratos","financeiro","atendimento","kanban","agenda","smartflow","comissoes","agentes_ia","processos","relatorios","backups"]',
    '["Colaboradores ilimitados","Tudo do Intermediário, mais:","Múltiplas conexões WhatsApp","Agentes IA personalizados","Monitoramento de processos ilimitado","Suporte prioritário","Onboarding dedicado"]',
    FALSE, FALSE, 4
  );

-- ─── Migração de subscriptions existentes ──────────────────────────────────
-- Renomeia planId antigo (iniciante/profissional/escritorio) pros slugs novos.
-- O piloto em cortesia continua com `cortesia=true` que sobrescreve qualquer
-- planId, então a migração é segura.

UPDATE subscriptions SET planId = 'basico'         WHERE planId = 'iniciante';
UPDATE subscriptions SET planId = 'intermediario'  WHERE planId = 'profissional';
UPDATE subscriptions SET planId = 'completo'       WHERE planId = 'escritorio';
