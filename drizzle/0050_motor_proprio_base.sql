-- 0050_motor_proprio_base: fundação do motor próprio de monitoramento jurídico.
--
-- Esta migration cria tabelas NOVAS e isoladas — não toca em nada das
-- judit_*. A coexistência com o adapter Judit (plano B) acontece via
-- feature flag `usarMotorProprio` em `escritorios`.
--
-- Estado: Spike de validação técnica. Tabelas ficam vazias até PoCs
-- começarem a popular. Production não recebe esta migration enquanto
-- o motor próprio não tiver paridade comprovada com Judit em staging.
--
-- Renomeação `judit_* → processos_*` é trabalho do Sprint 1 oficial,
-- POSTERIOR ao Spike. Aqui só criamos o substrato.
--
-- Sintaxe: MySQL clássico. `CREATE TABLE IF NOT EXISTS` é universal,
-- mas `CREATE INDEX IF NOT EXISTS` e `ADD COLUMN IF NOT EXISTS` falham
-- em MySQL 8.0.<29. O auto-migrate trata os erros de "Duplicate key
-- name" / "Duplicate column name" como harmless, então é seguro rodar
-- múltiplas vezes em ambientes parciais.

-- ═══════════════════════════════════════════════════════════════════
-- Cofre de Credenciais — armazena CPF/OAB + senha + 2FA TOTP de forma
-- criptografada (AES-256-GCM). Usado pelo motor próprio para acessar
-- sistemas autenticados (E-SAJ TJSP, PJe restrito, Eproc).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `cofre_credenciais` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `escritorioId` INT NOT NULL,

  -- Sistema de tribunal: ex "esaj_tjsp", "pje_restrito_trt2", "eproc_trf4"
  -- ou "esaj_*" / "pje_restrito_*" / "eproc_*" como curinga.
  `sistema` VARCHAR(64) NOT NULL,

  -- Label amigável que o admin define ao cadastrar.
  `apelido` VARCHAR(100) NOT NULL,

  -- Username (CPF ou OAB) — criptografado com AES-256-GCM em 3 partes:
  -- ciphertext hex, IV hex (12 bytes), auth tag hex (16 bytes). Mesmo
  -- padrão do `admin_integracoes.apiKeyEncrypted/Iv/Tag`.
  `usernameEnc` TEXT NOT NULL,
  `usernameIv` VARCHAR(64) NOT NULL,
  `usernameTag` VARCHAR(64) NOT NULL,

  -- Senha — mesmo padrão de criptografia.
  `passwordEnc` TEXT NOT NULL,
  `passwordIv` VARCHAR(64) NOT NULL,
  `passwordTag` VARCHAR(64) NOT NULL,

  -- TOTP secret (base32) — opcional. Se null, credencial não tem 2FA
  -- ou usa método não-TOTP (SMS, ainda não suportado).
  `totpSecretEnc` TEXT,
  `totpSecretIv` VARCHAR(64),
  `totpSecretTag` VARCHAR(64),

  -- Ciclo de vida da credencial. Validação inicial via login real.
  `statusCofre` ENUM('validando','ativa','erro','expirada','removida')
    NOT NULL DEFAULT 'validando',

  -- Timestamps de saúde — alimentados pelo robô a cada login.
  `ultimoLoginSucessoEm` TIMESTAMP NULL,
  `ultimoLoginTentativaEm` TIMESTAMP NULL,
  `ultimoErro` TEXT,

  -- Auditoria.
  `criadoPor` INT NOT NULL,
  `createdAtCofre` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updatedAtCofre` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP NOT NULL,

  INDEX `idx_cofre_escritorio` (`escritorioId`),
  INDEX `idx_cofre_sistema` (`sistema`),
  INDEX `idx_cofre_status` (`statusCofre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════
-- Sessões persistidas — cookies criptografados pra evitar relogin a
-- cada raspagem (relogar dispara captcha/lockout em alguns tribunais).
-- Sessão expirada → robô faz login novo e atualiza esta linha.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `cofre_sessoes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `credencialId` INT NOT NULL,

  -- JSON do array de cookies do Playwright (storageState) criptografado.
  `cookiesEnc` LONGTEXT NOT NULL,
  `cookiesIv` VARCHAR(64) NOT NULL,
  `cookiesTag` VARCHAR(64) NOT NULL,

  -- Quando essa sessão foi capturada e quando expira (estimativa).
  `capturadoEm` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `expiraEmEstimado` TIMESTAMP NULL,

  -- Última vez que o robô usou esta sessão com sucesso.
  `ultimoUsoEm` TIMESTAMP NULL,

  INDEX `idx_sessoes_credencial` (`credencialId`),
  INDEX `idx_sessoes_expira` (`expiraEmEstimado`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════
-- Eventos detectados pelo motor próprio — substituirá juditRespostas
-- na Fase 1 oficial (por ora, ambas coexistem).
--
-- Cada evento é uma observação granular: uma movimentação, uma
-- publicação no DJE, uma nova ação distribuída, um mandado, etc.
-- O hash de dedupe evita que retries do worker dupliquem eventos.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `eventos_processo` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- FK opcional: monitoramento pode ser null durante Spike (eventos
  -- isolados) ou quando o evento for descoberto via DJE sem
  -- monitoramento prévio (caso de "nova ação contra cliente").
  `monitoramentoId` INT NULL,

  -- Sempre obrigatório — define escopo de visibilidade.
  `escritorioId` INT NOT NULL,

  -- Categoria do evento. `outro` é fallback para classificações futuras
  -- sem precisar de migration.
  `tipoEvento` ENUM(
    'movimentacao',
    'publicacao_dje',
    'nova_acao',
    'mandado',
    'intimacao',
    'citacao',
    'sentenca',
    'despacho',
    'audiencia',
    'outro'
  ) NOT NULL,

  -- Quando o evento aconteceu no tribunal (não quando o robô coletou).
  `dataEvento` TIMESTAMP NOT NULL,

  -- De onde veio. `manual` permite admin lançar evento direto pra
  -- testes ou correção. `judit` mantido pra coexistência.
  `fonteEvento` ENUM('judit','pje','esaj','eproc','dje','manual')
    NOT NULL,

  -- Conteúdo bruto (texto da movimentação, da publicação, etc) e
  -- versão estruturada quando o parser conseguiu extrair campos.
  `conteudo` TEXT NOT NULL,
  `conteudoJson` JSON,

  -- CNJ afetado quando o evento for vinculável a um processo.
  -- Em `nova_acao` é o CNJ da ação recém-distribuída.
  `cnjAfetado` VARCHAR(32),

  -- Hash de dedupe: SHA-256 de (tipoEvento + cnjAfetado + dataEvento +
  -- primeiros 200 chars do conteudo). UNIQUE garante idempotência
  -- quando worker reentra na mesma página.
  `hashDedup` VARCHAR(64) NOT NULL,

  -- Estado de visualização — alimenta badge de "não lidos" na UI.
  `lido` BOOLEAN NOT NULL DEFAULT FALSE,

  -- Notificação foi enviada ao usuário? (email/WhatsApp/SSE)
  `alertaEnviado` BOOLEAN NOT NULL DEFAULT FALSE,
  `alertaEnviadoEm` TIMESTAMP NULL,

  `createdAtEvento` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,

  UNIQUE KEY `uq_evento_dedup` (`hashDedup`),
  INDEX `idx_evento_monitoramento` (`monitoramentoId`),
  INDEX `idx_evento_escritorio` (`escritorioId`, `createdAtEvento`),
  INDEX `idx_evento_cnj` (`cnjAfetado`),
  INDEX `idx_evento_tipo_data` (`tipoEvento`, `dataEvento`),
  INDEX `idx_evento_nao_lidos` (`escritorioId`, `lido`, `createdAtEvento`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════
-- DJE — Documentos baixados. Cada linha é o PDF de 1 dia × 1 caderno
-- de 1 tribunal. O hash do conteúdo evita reprocessar o mesmo PDF
-- (alguns tribunais retornam 200 com mesmo conteúdo se a data não tem
-- publicação).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `dje_documentos` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- Identificação do tribunal/caderno: ex "tjsp_caderno_1",
  -- "djen_unificado", "trt2_caderno_judiciario".
  `tribunal` VARCHAR(64) NOT NULL,
  `sigla` VARCHAR(32) NOT NULL,

  -- YYYY-MM-DD. Não usamos DATE puro pra preservar formato textual
  -- vindo da URL do tribunal (alguns retornam DD/MM/YYYY).
  `dataPublicacao` VARCHAR(10) NOT NULL,

  `urlOrigem` TEXT NOT NULL,

  -- Onde o PDF mora (S3 bucket de staging durante Spike).
  `s3Key` VARCHAR(512) NOT NULL,

  `tamanhoBytes` BIGINT,
  `paginas` INT,

  -- Pipeline: baixado → parseado → indexado. Erro guarda último motivo.
  `statusDje` ENUM('baixado','parseado','indexado','erro')
    NOT NULL DEFAULT 'baixado',
  `ultimoErro` TEXT,

  -- SHA-256 do binário do PDF — evita reprocessar conteúdo idêntico.
  `hashConteudo` VARCHAR(64) NOT NULL,

  `createdAtDjeDoc` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `parseadoEm` TIMESTAMP NULL,
  `indexadoEm` TIMESTAMP NULL,

  UNIQUE KEY `uq_dje_doc_hash` (`hashConteudo`),
  INDEX `idx_dje_doc_tribunal_data` (`tribunal`, `dataPublicacao`),
  INDEX `idx_dje_doc_status` (`statusDje`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════
-- DJE — Publicações individuais extraídas de um documento.
--
-- LGPD: armazenamos CNJ, nomes de partes, OABs e CNPJs (todos públicos
-- por força do art. 93 IX da CF). CPF é único campo sensível: guardamos
-- apenas SHA-256 hex do CPF normalizado, nunca o CPF cru. Match por
-- CPF na busca compara hash com hash.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `dje_publicacoes` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `documentoId` BIGINT NOT NULL,

  -- Posição da publicação dentro do PDF (ordem de aparição).
  `ordem` INT NOT NULL,

  `cnjAfetado` VARCHAR(32),

  -- JSON arrays de strings.
  `partesNomes` JSON,
  -- Hashes SHA-256 dos CPFs das partes (sem CPFs crus).
  `partesCpfsHash` JSON,
  `partesCnpjs` JSON,
  `advogadosOabs` JSON,

  -- Texto completo da publicação — alimenta FULLTEXT INDEX.
  -- TEXT (65KB) é mais que suficiente pra publicação individual
  -- (geralmente <4KB). Mantemos consistência com `text()` do Drizzle
  -- schema, que mapeia pra TEXT — evita drift entre `drizzle-kit push`
  -- e auto-migrate. FULLTEXT INDEX funciona em TEXT no MySQL 8 igual
  -- funciona em LONGTEXT.
  `texto` TEXT NOT NULL,

  -- Hash SHA-256 do `texto` normalizado — UNIQUE evita duplicatas
  -- quando o mesmo texto reaparece em DJE retificado.
  `hashDedup` VARCHAR(64) NOT NULL,

  `createdAtDjePub` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,

  UNIQUE KEY `uq_dje_pub_dedup` (`hashDedup`),
  INDEX `idx_dje_pub_doc` (`documentoId`),
  INDEX `idx_dje_pub_cnj` (`cnjAfetado`),
  FULLTEXT INDEX `ft_dje_pub_texto` (`texto`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════
-- Worker Jobs Log — auditoria de cada execução de adapter de tribunal,
-- crawler DJE ou job recorrente. Útil pra dashboard de saúde
-- (`/admin/motor-proprio`) e debug pós-falha.
--
-- Não é fila (BullMQ usa Redis pra isso) — é log persistido pra histórico.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `worker_jobs_log` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- Nome do worker e do job (ex: worker="tribunais", job="scrape_pje_trt2").
  `workerName` VARCHAR(64) NOT NULL,
  `jobName` VARCHAR(128) NOT NULL,

  -- Tipo livre (ex: "scrape_cnj", "dje_download", "esaj_login_validate").
  `tipoJob` VARCHAR(64) NOT NULL,

  -- Payload de entrada (CNJ alvo, credencial id, etc) e resultado.
  -- Ambos JSON para flexibilidade.
  `payloadJson` JSON,
  `resultadoJson` JSON,

  `statusJob` ENUM('pendente','em_andamento','sucesso','falha')
    NOT NULL DEFAULT 'pendente',
  `tentativas` INT NOT NULL DEFAULT 0,
  `ultimoErro` TEXT,

  -- Timestamps pra calcular latência.
  `iniciadoEm` TIMESTAMP NULL,
  `finalizadoEm` TIMESTAMP NULL,
  `createdAtJobLog` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,

  INDEX `idx_jobs_worker` (`workerName`, `createdAtJobLog`),
  INDEX `idx_jobs_status` (`statusJob`),
  INDEX `idx_jobs_tipo` (`tipoJob`, `createdAtJobLog`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════
-- Feature flag por escritório — controla se motor próprio está ativo.
-- Default false: garantia de não-regressão pros escritórios existentes
-- que continuam usando Judit (plano B).
--
-- Apenas escritório piloto vai começar com TRUE durante o Spike.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE `escritorios`
  ADD COLUMN `usarMotorProprio` BOOLEAN NOT NULL DEFAULT FALSE
    AFTER `planoAtendimento`;
