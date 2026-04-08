import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, bigint, boolean, index } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /**
   * Identificador único do usuário. Pode ser:
   * - `email-{base64email}` para usuários cadastrados via email/senha
   * - `google-{googleSub}` para usuários cadastrados via Google
   * - O openId real do Manus OAuth (legado)
   */
  openId: varchar("openId", { length: 128 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  /**
   * Hash da senha (scrypt) para usuários cadastrados via email/senha.
   * Formato: `{salt}:{hash}` em hex. Null para usuários OAuth (Google).
   */
  passwordHash: varchar("passwordHash", { length: 255 }),
  /** Sub do Google (id único do usuário no Google). Null para email/senha. */
  googleSub: varchar("googleSub", { length: 128 }),
  /** Método de login: 'email', 'google', 'manus' (legado), 'demo' */
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** ID do customer no Asaas (cobrança SaaS Jurify). Substituiu stripeCustomerId. */
  asaasCustomerId: varchar("asaasCustomerId", { length: 255 }),
  /**
   * Conta bloqueada pelo admin do Jurify. Quando true, o usuário não
   * consegue mais autenticar (verificado em authenticateRequest).
   * Diferente de role: bloqueio é uma ação punitiva/de suporte, role
   * é o nível de permissão.
   */
  bloqueado: boolean("bloqueado").default(false).notNull(),
  /** Motivo do bloqueio (auditável). Null quando bloqueado=false. */
  motivoBloqueio: varchar("motivoBloqueio", { length: 500 }),
  /** Timestamp do bloqueio. */
  bloqueadoEm: timestamp("bloqueadoEm"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Subscriptions table — assinaturas SaaS Jurify (uma por usuário-dono).
 *
 * Migrado de Stripe para Asaas. Os IDs do Asaas substituem os antigos
 * stripeSubscriptionId/stripePriceId. O `planId` continua mapeando para
 * a tabela `PLANS` em `server/billing/products.ts`.
 */
export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** ID da assinatura no Asaas (sub_xxxx). Único por subscription. */
  asaasSubscriptionId: varchar("asaasSubscriptionId", { length: 255 }).unique(),
  /** ID do customer no Asaas (cus_xxxx). Mesmo de users.asaasCustomerId. */
  asaasCustomerId: varchar("asaasCustomerId", { length: 255 }),
  planId: varchar("planId", { length: 64 }),
  status: mysqlEnum("status", [
    "active",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "past_due",
    "trialing",
    "unpaid",
    "paused",
  ]).default("incomplete").notNull(),
  currentPeriodEnd: bigint("currentPeriodEnd", { mode: "number" }),
  cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false),
  creditsUsed: int("creditsUsed").default(0).notNull(),
  creditsLimit: int("creditsLimit").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

/**
 * Cache de taxas médias de juros do BACEN.
 * Armazena taxas por modalidade e data para evitar chamadas repetidas à API.
 */
export const taxasMediasBacen = mysqlTable("taxas_medias_bacen", {
  id: int("id").autoincrement().primaryKey(),
  modalidade: varchar("modalidade", { length: 64 }).notNull(),
  codigoSgs: int("codigoSgs").notNull(),
  data: varchar("data", { length: 10 }).notNull(), // YYYY-MM-DD
  taxaMensal: varchar("taxaMensal", { length: 20 }).notNull(), // string para precisão
  taxaAnual: varchar("taxaAnual", { length: 20 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaxaMediaBacen = typeof taxasMediasBacen.$inferSelect;
export type InsertTaxaMediaBacen = typeof taxasMediasBacen.$inferInsert;

/**
 * Histórico de cálculos realizados pelos utilizadores.
 * Permite exibir cálculos recentes no dashboard e estatísticas de uso.
 */
export const calculosHistorico = mysqlTable("calculos_historico", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tipo: mysqlEnum("tipo", ["bancario", "trabalhista", "imobiliario", "tributario", "previdenciario", "atualizacao_monetaria"]).notNull(),
  titulo: varchar("titulo", { length: 255 }).notNull(), // Ex: "Financiamento PRICE - R$ 50.000"
  resumo: text("resumo"), // JSON com dados principais do resultado
  protocolo: varchar("protocolo", { length: 64 }), // Ex: RC-20230615-ABC123
  diferencaTotal: varchar("diferencaTotal", { length: 32 }), // Valor em reais (string para precisão)
  temParecer: boolean("temParecer").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CalculoHistorico = typeof calculosHistorico.$inferSelect;
export type InsertCalculoHistorico = typeof calculosHistorico.$inferInsert;

/**
 * Créditos dos utilizadores.
 * Cada plano tem um limite mensal de créditos que é consumido ao realizar cálculos.
 */
export const userCredits = mysqlTable("user_credits", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  creditsTotal: int("creditsTotal").default(0).notNull(), // Total de créditos disponíveis
  creditsUsed: int("creditsUsed").default(0).notNull(), // Créditos já utilizados
  currentPlanId: varchar("currentPlanId", { length: 64 }), // Plano que gerou os créditos atuais (para detectar mudanças)
  resetAt: timestamp("resetAt"), // Data do próximo reset (renovação do plano)
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserCredits = typeof userCredits.$inferSelect;
export type InsertUserCredits = typeof userCredits.$inferInsert;

/**
 * Processos monitorados pelos utilizadores.
 * SEGURANÇA: userId é obrigatório e indexado. Todas as queries DEVEM filtrar por userId.
 */
export const processosMonitorados = mysqlTable("processos_monitorados", {
  id: int("id").autoincrement().primaryKey(),
  /** FK para users.id — OBRIGATÓRIO para isolamento de dados */
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Número CNJ formatado: NNNNNNN-DD.AAAA.J.TR.OOOO */
  numeroCnj: varchar("numeroCnj", { length: 25 }).notNull(),
  /** Número CNJ sem formatação (20 dígitos) para busca */
  numeroCnjLimpo: varchar("numeroCnjLimpo", { length: 20 }).notNull(),
  /** Sigla do tribunal: TJSP, TRF1, TRT2, etc. */
  tribunal: varchar("tribunal", { length: 16 }).notNull(),
  /** Alias para a API DataJud: api_publica_tjsp, etc. */
  aliasApi: varchar("aliasApi", { length: 64 }).notNull(),
  /** Classe processual */
  classe: varchar("classe", { length: 255 }),
  /** Assuntos (JSON array) */
  assuntos: text("assuntos"),
  /** Órgão julgador */
  orgaoJulgador: varchar("orgaoJulgador", { length: 255 }),
  /** Data de ajuizamento */
  dataAjuizamento: varchar("dataAjuizamento", { length: 32 }),
  /** Grau: G1, G2, JE, etc. */
  grau: varchar("grau", { length: 8 }),
  /** Última atualização dos dados no DataJud */
  ultimaAtualizacao: varchar("ultimaAtualizacao", { length: 32 }),
  /** Total de movimentações conhecidas */
  totalMovimentacoes: int("totalMovimentacoes").default(0).notNull(),
  /** Nome da última movimentação */
  ultimaMovimentacao: varchar("ultimaMovimentacao", { length: 512 }),
  /** Data da última movimentação */
  ultimaMovimentacaoData: varchar("ultimaMovimentacaoData", { length: 32 }),
  /** Status do monitoramento */
  status: mysqlEnum("status", ["ativo", "pausado", "arquivado"]).default("ativo").notNull(),
  /** Nome amigável dado pelo utilizador */
  apelido: varchar("apelido", { length: 255 }),
  /** Fonte dos dados: DATAJUD (atraso) ou TRIBUNAL_DIRETO (tempo real) */
  fonte: mysqlEnum("fonte", ["DATAJUD", "TRIBUNAL_DIRETO"]).default("DATAJUD").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProcessoMonitorado = typeof processosMonitorados.$inferSelect;
export type InsertProcessoMonitorado = typeof processosMonitorados.$inferInsert;

/**
 * Cache de movimentações processuais.
 * Armazena as movimentações consultadas para evitar chamadas repetidas à API.
 * SEGURANÇA: processoId referencia processosMonitorados que já é filtrado por userId.
 */
export const movimentacoesProcesso = mysqlTable("movimentacoes_processo", {
  id: int("id").autoincrement().primaryKey(),
  /** FK para processos_monitorados.id */
  processoId: int("processoId").notNull(),
  /** Código da movimentação no CNJ */
  codigo: int("codigo").notNull(),
  /** Nome/descrição da movimentação */
  nome: varchar("nome", { length: 512 }).notNull(),
  /** Data/hora da movimentação */
  dataHora: varchar("dataHora", { length: 32 }).notNull(),
  /** Complementos (JSON) */
  complementos: text("complementos"),
  /** Órgão julgador da movimentação */
  orgaoJulgador: varchar("orgaoJulgador", { length: 255 }),
  /** Se o utilizador já visualizou esta movimentação */
  lida: boolean("lida").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MovimentacaoProcesso = typeof movimentacoesProcesso.$inferSelect;
export type InsertMovimentacaoProcesso = typeof movimentacoesProcesso.$inferInsert;

/**
 * OABs cadastradas pelos utilizadores.
 * SEGURANÇA: userId é obrigatório. Todas as queries DEVEM filtrar por userId.
 * Regras:
 * - Utilizador normal: só pode cadastrar OAB cujo nome do titular corresponda ao seu nome de cadastro
 * - Admin: pode cadastrar OAB de qualquer titular (para verificação manual)
 */
export const oabsAdvogado = mysqlTable("oabs_advogado", {
  id: int("id").autoincrement().primaryKey(),
  /** FK para users.id — OBRIGATÓRIO para isolamento de dados */
  userId: int("userId").notNull(),
  /** Número da inscrição na OAB */
  numero: varchar("numero", { length: 20 }).notNull(),
  /** UF da inscrição (ex: SP, RJ, MG) */
  uf: varchar("uf", { length: 2 }).notNull(),
  /** Tipo: principal ou suplementar */
  tipo: mysqlEnum("tipo", ["principal", "suplementar"]).default("principal").notNull(),
  /** Nome do titular da OAB (informado pelo utilizador, validado contra nome de cadastro) */
  nomeTitular: varchar("nomeTitular", { length: 255 }).notNull(),
  /** Se foi cadastrada por admin (bypass da validação de nome) */
  cadastradaPorAdmin: boolean("cadastradaPorAdmin").default(false).notNull(),
  /** Status da OAB: ativa, suspensa, cancelada */
  status: mysqlEnum("statusOab", ["ativa", "suspensa", "cancelada"]).default("ativa").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OabAdvogado = typeof oabsAdvogado.$inferSelect;
export type InsertOabAdvogado = typeof oabsAdvogado.$inferInsert;

/**
 * Notificações in-app para os utilizadores.
 * SEGURANÇA: userId é obrigatório. Todas as queries DEVEM filtrar por userId.
 */
export const notificacoes = mysqlTable("notificacoes", {
  id: int("id").autoincrement().primaryKey(),
  /** FK para users.id — OBRIGATÓRIO para isolamento de dados */
  userId: int("userId").notNull(),
  /** Título da notificação */
  titulo: varchar("titulo", { length: 255 }).notNull(),
  /** Mensagem da notificação */
  mensagem: text("mensagem").notNull(),
  /** Tipo: movimentacao, sistema, plano */
  tipo: mysqlEnum("tipoNotif", ["movimentacao", "sistema", "plano"]).default("sistema").notNull(),
  /** ID do processo relacionado (se tipo = movimentacao) */
  processoId: int("processoId"),
  /** Se o utilizador já leu a notificação */
  lida: boolean("lida").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notificacao = typeof notificacoes.$inferSelect;
export type InsertNotificacao = typeof notificacoes.$inferInsert;
// ═══════════════════════════════════════════════════════════════════════════════
// FASE 1 — FUNDAÇÃO: Escritórios, Colaboradores, Convites
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Escritório — entidade organizacional que agrupa colaboradores, canais e conversas.
 * Cada usuário pertence a no máximo 1 escritório.
 * O dono (ownerId) é criado automaticamente no primeiro acesso ao módulo.
 */
export const escritorios = mysqlTable("escritorios", {
  id: int("id").autoincrement().primaryKey(),
  nome: varchar("nome", { length: 255 }).notNull(),
  cnpj: varchar("cnpj", { length: 18 }),
  telefone: varchar("telefone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  endereco: text("endereco"),
  logoUrl: varchar("logoUrl", { length: 512 }),
  fusoHorario: varchar("fusoHorario", { length: 64 }).default("America/Sao_Paulo").notNull(),
  horarioAbertura: varchar("horarioAbertura", { length: 5 }).default("08:00").notNull(),
  horarioFechamento: varchar("horarioFechamento", { length: 5 }).default("18:00").notNull(),
  diasFuncionamento: text("diasFuncionamento"), // JSON: ["seg","ter","qua","qui","sex"]
  mensagemAusencia: text("mensagemAusencia"),
  mensagemBoasVindas: text("mensagemBoasVindas"),
  ownerId: int("ownerId").notNull(), // FK → users.id
  planoAtendimento: mysqlEnum("planoAtendimento", ["basico", "intermediario", "completo"]).default("basico").notNull(),
  maxColaboradores: int("maxColaboradores").default(1).notNull(),
  maxConexoesWhatsapp: int("maxConexoesWhatsapp").default(0).notNull(),
  /**
   * Suspensão administrativa do escritório (controle pelo admin do
   * Jurify, ex: inadimplência grave, violação de termos). Quando true,
   * todos os usuários do escritório recebem 403 nas chamadas tRPC
   * que dependem do contexto do escritório. Diferente do bloqueio
   * individual em users.bloqueado: este é organizacional.
   */
  suspenso: boolean("suspenso").default(false).notNull(),
  motivoSuspensao: varchar("motivoSuspensao", { length: 500 }),
  suspensoEm: timestamp("suspensoEm"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Escritorio = typeof escritorios.$inferSelect;
export type InsertEscritorio = typeof escritorios.$inferInsert;

/**
 * Colaboradores — membros do escritório com cargo e permissões.
 * UNIQUE(escritorioId, userId) — cada pessoa pertence a 1 escritório.
 */
export const colaboradores = mysqlTable("colaboradores", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioId").notNull(), // FK → escritorios.id
  userId: int("userId").notNull(), // FK → users.id
  cargo: mysqlEnum("cargo", ["dono", "gestor", "atendente", "estagiario"]).notNull(),
  departamento: varchar("departamento", { length: 64 }),
  ativo: boolean("ativo").default(true).notNull(),
  maxAtendimentosSimultaneos: int("maxAtendimentosSimultaneos").default(5).notNull(),
  recebeLeadsAutomaticos: boolean("recebeLeadsAutomaticos").default(true).notNull(),
  ultimaAtividade: timestamp("ultimaAtividade"),
  ultimaDistribuicao: timestamp("ultimaDistribuicao"),
  cargoPersonalizadoId: int("cargoPersonalizadoId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Colaborador = typeof colaboradores.$inferSelect;
export type InsertColaborador = typeof colaboradores.$inferInsert;

/**
 * Convites para novos colaboradores.
 * Fluxo: dono/gestor envia convite → email com link → pessoa faz login → aceita → vira colaborador.
 */
export const convitesColaborador = mysqlTable("convites_colaborador", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioId").notNull(), // FK → escritorios.id
  email: varchar("email", { length: 320 }).notNull(),
  cargo: mysqlEnum("cargoConvite", ["gestor", "atendente", "estagiario"]).notNull(),
  departamento: varchar("departamentoConvite", { length: 64 }),
  token: varchar("token", { length: 128 }).notNull().unique(),
  status: mysqlEnum("statusConvite", ["pendente", "aceito", "expirado", "cancelado"]).default("pendente").notNull(),
  convidadoPorId: int("convidadoPorId").notNull(), // FK → colaboradores.id
  aceitoPorUserId: int("aceitoPorUserId"), // FK → users.id (preenchido ao aceitar)
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ConviteColaborador = typeof convitesColaborador.$inferSelect;
export type InsertConviteColaborador = typeof convitesColaborador.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 4 — AGENDAMENTO: Compromissos, Lembretes, Participantes
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Agendamentos — compromissos, prazos processuais, audiências, reuniões, tarefas.
 */
export const agendamentos = mysqlTable("agendamentos", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioId").notNull(),
  criadoPorId: int("criadoPorId").notNull(),
  responsavelId: int("responsavelId").notNull(),
  tipo: mysqlEnum("tipoAgendamento", ["prazo_processual", "audiencia", "reuniao_comercial", "tarefa", "follow_up", "outro"]).notNull(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: text("descricao"),
  dataInicio: timestamp("dataInicio").notNull(),
  dataFim: timestamp("dataFim"),
  diaInteiro: boolean("diaInteiro").default(false).notNull(),
  local: varchar("local", { length: 512 }),
  prioridade: mysqlEnum("prioridade", ["baixa", "normal", "alta", "critica"]).default("normal").notNull(),
  status: mysqlEnum("statusAgendamento", ["pendente", "em_andamento", "concluido", "cancelado", "atrasado"]).default("pendente").notNull(),
  processoId: int("processoIdAgend"),
  corHex: varchar("corHex", { length: 7 }).default("#3b82f6").notNull(),
  createdAt: timestamp("createdAtAgend").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtAgend").defaultNow().onUpdateNow().notNull(),
});

export type Agendamento = typeof agendamentos.$inferSelect;
export type InsertAgendamento = typeof agendamentos.$inferInsert;

/**
 * Lembretes de agendamentos — notificações antes do compromisso.
 */
export const agendamentoLembretes = mysqlTable("agendamento_lembretes", {
  id: int("id").autoincrement().primaryKey(),
  agendamentoId: int("agendamentoId").notNull(),
  tipo: mysqlEnum("tipoLembrete", ["notificacao_app", "email", "whatsapp"]).notNull(),
  minutosAntes: int("minutosAntes").notNull(),
  enviado: boolean("enviado").default(false).notNull(),
  enviadoAt: timestamp("enviadoAt"),
});

export type AgendamentoLembrete = typeof agendamentoLembretes.$inferSelect;
export type InsertAgendamentoLembrete = typeof agendamentoLembretes.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 2 — INTEGRAÇÕES: Canais e Auditoria
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Canais de comunicação integrados (WhatsApp, Instagram, Facebook, VoIP).
 * Configurações sensíveis (tokens, chaves) são armazenadas criptografadas.
 */
export const canaisIntegrados = mysqlTable("canais_integrados", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioId").notNull(),
  tipo: mysqlEnum("tipoCanal", ["whatsapp_qr", "whatsapp_api", "instagram", "facebook", "telefone_voip"]).notNull(),
  nome: varchar("nomeCanal", { length: 128 }),
  status: mysqlEnum("statusCanal", ["conectado", "desconectado", "pendente", "erro", "banido"]).default("pendente").notNull(),
  configEncrypted: text("configEncrypted"),
  configIv: varchar("configIv", { length: 64 }),
  configTag: varchar("configTag", { length: 64 }),
  webhookSecret: varchar("webhookSecret", { length: 128 }),
  telefone: varchar("telefoneCanal", { length: 20 }),
  ultimaSync: timestamp("ultimaSyncCanal"),
  mensagemErro: varchar("mensagemErro", { length: 512 }),
  createdAt: timestamp("createdAtCanal").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtCanal").defaultNow().onUpdateNow().notNull(),
});

export type CanalIntegrado = typeof canaisIntegrados.$inferSelect;
export type InsertCanalIntegrado = typeof canaisIntegrados.$inferInsert;

/**
 * Log de auditoria de ações nas integrações.
 */
export const integracaoAuditLog = mysqlTable("integracao_audit_log", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdAudit").notNull(),
  colaboradorId: int("colaboradorIdAudit").notNull(),
  canalId: int("canalIdAudit"),
  acao: mysqlEnum("acaoAudit", ["conectou", "desconectou", "editou_config", "testou", "erro"]).notNull(),
  detalhes: text("detalhesAudit"),
  ip: varchar("ipAudit", { length: 45 }),
  createdAt: timestamp("createdAtAudit").defaultNow().notNull(),
});

export type IntegracaoAudit = typeof integracaoAuditLog.$inferSelect;
export type InsertIntegracaoAudit = typeof integracaoAuditLog.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 3 — CRM: Contatos, Conversas, Mensagens, Leads, Métricas
// ═══════════════════════════════════════════════════════════════════════════════

export const contatos = mysqlTable("contatos", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdContato").notNull(),
  nome: varchar("nomeContato", { length: 255 }).notNull(),
  telefone: varchar("telefoneContato", { length: 20 }),
  /**
   * Histórico de telefones anteriores (separados por vírgula).
   * Usado pelo handler do WhatsApp pra reconhecer contatos que tiveram
   * o telefone alterado, evitando criação de contato duplicado quando
   * chega mensagem do número anterior. Nunca removemos entradas — só
   * acrescentamos no início quando o telefone é atualizado.
   */
  telefonesAnteriores: text("telefonesAnteriores"),
  email: varchar("emailContato", { length: 320 }),
  cpfCnpj: varchar("cpfCnpj", { length: 18 }),
  origem: mysqlEnum("origemContato", ["whatsapp", "instagram", "facebook", "telefone", "manual", "site"]).default("manual").notNull(),
  tags: text("tagsContato"),
  observacoes: text("observacoesContato"),
  responsavelId: int("responsavelIdContato"),
  createdAt: timestamp("createdAtContato").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtContato").defaultNow().onUpdateNow().notNull(),
});

export type Contato = typeof contatos.$inferSelect;
export type InsertContato = typeof contatos.$inferInsert;

export const conversas = mysqlTable("conversas", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdConv").notNull(),
  contatoId: int("contatoIdConv").notNull(),
  canalId: int("canalIdConv").notNull(),
  atendenteId: int("atendenteIdConv"),
  status: mysqlEnum("statusConv", ["aguardando", "em_atendimento", "resolvido", "fechado"]).default("aguardando").notNull(),
  prioridade: mysqlEnum("prioridadeConv", ["baixa", "normal", "alta", "urgente"]).default("normal").notNull(),
  assunto: varchar("assuntoConv", { length: 255 }),
  departamento: varchar("departamentoConv", { length: 64 }),
  chatIdExterno: varchar("chatIdExterno", { length: 128 }),
  ultimaMensagemAt: timestamp("ultimaMensagemAt"),
  ultimaMensagemPreview: varchar("ultimaMensagemPreview", { length: 255 }),
  tempoEspera: int("tempoEspera"),
  tempoConclusao: int("tempoConclusao"),
  avaliacaoCliente: int("avaliacaoCliente"),
  createdAt: timestamp("createdAtConv").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtConv").defaultNow().onUpdateNow().notNull(),
});

export type Conversa = typeof conversas.$inferSelect;
export type InsertConversa = typeof conversas.$inferInsert;

export const mensagens = mysqlTable("mensagens", {
  id: int("id").autoincrement().primaryKey(),
  conversaId: int("conversaIdMsg").notNull(),
  remetenteId: int("remetenteIdMsg"),
  direcao: mysqlEnum("direcaoMsg", ["entrada", "saida"]).notNull(),
  tipo: mysqlEnum("tipoMsg", ["texto", "imagem", "audio", "video", "documento", "localizacao", "contato", "sticker", "sistema"]).notNull(),
  conteudo: text("conteudoMsg"),
  mediaUrl: varchar("mediaUrl", { length: 512 }),
  mediaType: varchar("mediaType", { length: 64 }),
  status: mysqlEnum("statusMsg", ["pendente", "enviada", "entregue", "lida", "falha"]).default("pendente").notNull(),
  idExterno: varchar("idExterno", { length: 128 }),
  replyToId: int("replyToId"),
  createdAt: timestamp("createdAtMsg").defaultNow().notNull(),
});

export type Mensagem = typeof mensagens.$inferSelect;
export type InsertMensagem = typeof mensagens.$inferInsert;

export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdLead").notNull(),
  contatoId: int("contatoIdLead").notNull(),
  conversaId: int("conversaIdLead"),
  responsavelId: int("responsavelIdLead"),
  etapaFunil: mysqlEnum("etapaFunil", ["novo", "qualificado", "proposta", "negociacao", "fechado_ganho", "fechado_perdido"]).default("novo").notNull(),
  valorEstimado: varchar("valorEstimado", { length: 20 }),
  origemLead: varchar("origemLead", { length: 128 }),
  motivoPerda: varchar("motivoPerda", { length: 255 }),
  probabilidade: int("probabilidade").default(50).notNull(),
  dataFechamentoPrevisto: varchar("dataFechPrevisto", { length: 10 }),
  observacoes: text("observacoesLead"),
  createdAt: timestamp("createdAtLead").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtLead").defaultNow().onUpdateNow().notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

export const atendimentoMetricasDiarias = mysqlTable("atendimento_metricas_diarias", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdMetrica").notNull(),
  colaboradorId: int("colaboradorIdMetrica").notNull(),
  data: varchar("dataMetrica", { length: 10 }).notNull(),
  totalAtendimentos: int("totalAtendimentos").default(0).notNull(),
  tempoMedioResposta: int("tempoMedioResposta").default(0).notNull(),
  tempoMedioConclusao: int("tempoMedioConclusao").default(0).notNull(),
  avaliacaoMedia: varchar("avaliacaoMedia", { length: 10 }),
  leadsRecebidos: int("leadsRecebidos").default(0).notNull(),
  leadsConvertidos: int("leadsConvertidos").default(0).notNull(),
  mensagensEnviadas: int("mensagensEnviadas").default(0).notNull(),
  mensagensRecebidas: int("mensagensRecebidas").default(0).notNull(),
  createdAt: timestamp("createdAtMetrica").defaultNow().notNull(),
});

export type MetricaDiaria = typeof atendimentoMetricasDiarias.$inferSelect;
export type InsertMetricaDiaria = typeof atendimentoMetricasDiarias.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 4 — AGENTES IA (Chatbot Multi-Agente)
// ═══════════════════════════════════════════════════════════════════════════════

export const agentesIa = mysqlTable("agentes_ia", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioId").notNull(),
  nome: varchar("nome", { length: 128 }).notNull(),
  descricao: varchar("descricao", { length: 512 }),
  modelo: varchar("modelo", { length: 64 }).notNull().default("gpt-4o-mini"),
  prompt: text("prompt").notNull(),
  ativo: boolean("ativo").notNull().default(false),
  canalId: int("canalId"),
  openaiApiKey: text("openaiApiKey"),
  apiKeyIv: varchar("apiKeyIv", { length: 64 }),
  apiKeyTag: varchar("apiKeyTag", { length: 64 }),
  maxTokens: int("maxTokens").notNull().default(500),
  temperatura: varchar("temperatura", { length: 10 }).notNull().default("0.70"),
  createdAt: timestamp("createdAtAgente").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtAgente").defaultNow().onUpdateNow().notNull(),
});

export type AgenteIa = typeof agentesIa.$inferSelect;
export type InsertAgenteIa = typeof agentesIa.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 5 — MÓDULO CLIENTES (Arquivos + Anotações)
// ═══════════════════════════════════════════════════════════════════════════════

export const clienteArquivos = mysqlTable("cliente_arquivos", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioId").notNull(),
  contatoId: int("contatoId").notNull(),
  nome: varchar("nome", { length: 255 }).notNull(),
  tipo: varchar("tipo", { length: 64 }),
  tamanho: int("tamanho"),
  url: text("url").notNull(),
  uploadPor: int("uploadPor"),
  createdAt: timestamp("createdAtArquivo").defaultNow().notNull(),
});

export type ClienteArquivo = typeof clienteArquivos.$inferSelect;
export type InsertClienteArquivo = typeof clienteArquivos.$inferInsert;

export const clienteAnotacoes = mysqlTable("cliente_anotacoes", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioId").notNull(),
  contatoId: int("contatoId").notNull(),
  titulo: varchar("titulo", { length: 255 }),
  conteudo: text("conteudo").notNull(),
  criadoPor: int("criadoPor"),
  createdAt: timestamp("createdAtAnotacao").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtAnotacao").defaultNow().onUpdateNow().notNull(),
});

export type ClienteAnotacao = typeof clienteAnotacoes.$inferSelect;
export type InsertClienteAnotacao = typeof clienteAnotacoes.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 6 — PERMISSÕES CUSTOMIZÁVEIS
// ═══════════════════════════════════════════════════════════════════════════════

export const cargosPersonalizados = mysqlTable("cargos_personalizados", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioId").notNull(),
  nome: varchar("nome", { length: 64 }).notNull(),
  descricao: varchar("descricao", { length: 255 }),
  cor: varchar("cor", { length: 20 }).default("#6366f1"),
  isDefault: boolean("isDefault").notNull().default(false),
  createdAt: timestamp("createdAtCargo").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtCargo").defaultNow().onUpdateNow().notNull(),
});

export type CargoPersonalizado = typeof cargosPersonalizados.$inferSelect;
export type InsertCargoPersonalizado = typeof cargosPersonalizados.$inferInsert;

export const permissoesCargo = mysqlTable("permissoes_cargo", {
  id: int("id").autoincrement().primaryKey(),
  cargoId: int("cargoId").notNull(),
  modulo: varchar("modulo", { length: 32 }).notNull(),
  verTodos: boolean("ver_todos").notNull().default(false),
  verProprios: boolean("ver_proprios").notNull().default(false),
  criar: boolean("criar").notNull().default(false),
  editar: boolean("editar").notNull().default(false),
  excluir: boolean("excluir").notNull().default(false),
});

export type PermissaoCargo = typeof permissoesCargo.$inferSelect;
export type InsertPermissaoCargo = typeof permissoesCargo.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 7 — ASSINATURA DIGITAL DE DOCUMENTOS
// ═══════════════════════════════════════════════════════════════════════════════

export const assinaturasDigitais = mysqlTable("assinaturas_digitais", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioId").notNull(),
  contatoId: int("contatoId").notNull(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: varchar("descricao", { length: 512 }),
  status: mysqlEnum("statusAssinatura", ["pendente", "enviado", "visualizado", "assinado", "recusado", "expirado"]).default("pendente").notNull(),
  documentoUrl: text("documentoUrl"),
  documentoAssinadoUrl: text("documentoAssinadoUrl"),
  assinantNome: varchar("assinantNome", { length: 255 }),
  assinantEmail: varchar("assinantEmail", { length: 320 }),
  assinantTelefone: varchar("assinantTelefone", { length: 20 }),
  tokenAssinatura: varchar("tokenAssinatura", { length: 128 }),
  enviadoPor: int("enviadoPor"),
  enviadoAt: timestamp("enviadoAt"),
  visualizadoAt: timestamp("visualizadoAt"),
  assinadoAt: timestamp("assinadoAt"),
  ipAssinatura: varchar("ipAssinatura", { length: 45 }),
  expiracaoAt: timestamp("expiracaoAt"),
  createdAt: timestamp("createdAtAssinatura").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtAssinatura").defaultNow().onUpdateNow().notNull(),
});

export type AssinaturaDigital = typeof assinaturasDigitais.$inferSelect;
export type InsertAssinaturaDigital = typeof assinaturasDigitais.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// TAREFAS / TO-DOS
// ═══════════════════════════════════════════════════════════════════════════════

export const tarefas = mysqlTable("tarefas", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdTarefa").notNull(),
  contatoId: int("contatoIdTarefa"),
  processoId: int("processoIdTarefa"),
  responsavelId: int("responsavelIdTarefa"),
  criadoPor: int("criadoPorTarefa").notNull(),
  titulo: varchar("tituloTarefa", { length: 255 }).notNull(),
  descricao: text("descricaoTarefa"),
  status: mysqlEnum("statusTarefa", ["pendente", "em_andamento", "concluida", "cancelada"]).default("pendente").notNull(),
  prioridade: mysqlEnum("prioridadeTarefa", ["baixa", "normal", "alta", "urgente"]).default("normal").notNull(),
  dataVencimento: timestamp("dataVencimento"),
  concluidaAt: timestamp("concluidaAt"),
  createdAt: timestamp("createdAtTarefa").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtTarefa").defaultNow().onUpdateNow().notNull(),
});

export type Tarefa = typeof tarefas.$inferSelect;
export type InsertTarefa = typeof tarefas.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN — INTEGRAÇÕES EXTERNAS (Judit.IO, futuras)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Integrações externas gerenciadas pelo admin (dono do sistema).
 * Cada provedor tem no máximo 1 registro ativo.
 * A API key é criptografada com AES-256-GCM (mesmo padrão dos canais).
 * O status persiste entre sessões — só muda com ação manual do admin.
 */
export const adminIntegracoes = mysqlTable("admin_integracoes", {
  id: int("id").autoincrement().primaryKey(),
  /** Identificador do provedor: "judit", "escavador", etc. */
  provedor: varchar("provedor", { length: 64 }).notNull().unique(),
  /** Nome amigável para exibição */
  nomeExibicao: varchar("nomeExibicao", { length: 128 }).notNull(),
  /** API key criptografada (AES-256-GCM) */
  apiKeyEncrypted: text("apiKeyEncrypted"),
  apiKeyIv: varchar("apiKeyIv", { length: 64 }),
  apiKeyTag: varchar("apiKeyTag", { length: 64 }),
  /** Status da integração — persiste até ação manual */
  status: mysqlEnum("statusIntegracao", ["conectado", "desconectado", "erro"]).default("desconectado").notNull(),
  /** Timestamp do último teste de conexão bem-sucedido */
  ultimoTeste: timestamp("ultimoTeste"),
  /** Mensagem de erro (se status = "erro") */
  mensagemErro: varchar("mensagemErro", { length: 512 }),
  /** Configurações extras por provedor (JSON) — ex: webhook_url, recurrence */
  configJson: text("configJson"),
  /** URL do webhook para callbacks do provedor */
  webhookUrl: varchar("webhookUrl", { length: 512 }),
  /** Secret para validar callbacks */
  webhookSecret: varchar("webhookSecret", { length: 128 }),
  createdAt: timestamp("createdAtInteg").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtInteg").defaultNow().onUpdateNow().notNull(),
});

export type AdminIntegracao = typeof adminIntegracoes.$inferSelect;
export type InsertAdminIntegracao = typeof adminIntegracoes.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN — JUDIT.IO MONITORAMENTOS E CONSULTAS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Monitoramentos criados via Judit.IO pelo admin.
 * Cada registro corresponde a um tracking_id na Judit.
 * O admin pode monitorar processos para seus clientes (userId opcional).
 */
export const juditMonitoramentos = mysqlTable("judit_monitoramentos", {
  id: int("id").autoincrement().primaryKey(),
  /** tracking_id retornado pela Judit */
  trackingId: varchar("trackingId", { length: 128 }).notNull().unique(),
  /** Tipo de busca: lawsuit_cnj, cpf, cnpj, oab, name */
  searchType: varchar("searchType", { length: 32 }).notNull(),
  /** Chave de busca (CNJ, CPF, etc) */
  searchKey: varchar("searchKey", { length: 128 }).notNull(),
  /** Recorrência em dias */
  recurrence: int("recurrence").default(1).notNull(),
  /** Status do tracking na Judit */
  statusJudit: mysqlEnum("statusJudit", ["created", "updating", "updated", "paused", "deleted"]).default("created").notNull(),
  /** Apelido/descrição dado pelo admin */
  apelido: varchar("apelidoJudit", { length: 255 }),
  /** userId do cliente associado (opcional — admin pode monitorar sem vincular) */
  clienteUserId: int("clienteUserId"),
  /** Tribunal identificado */
  tribunal: varchar("tribunalJudit", { length: 16 }),
  /** Nome das partes (capa do processo) */
  nomePartes: varchar("nomePartes", { length: 512 }),
  /** Última movimentação recebida */
  ultimaMovimentacao: text("ultimaMovJudit"),
  /** Data da última movimentação */
  ultimaMovimentacaoData: varchar("ultimaMovDataJudit", { length: 32 }),
  /** Total de atualizações recebidas via webhook */
  totalAtualizacoes: int("totalAtualizacoes").default(0).notNull(),
  /** Com anexos */
  withAttachments: boolean("withAttachments").default(false).notNull(),
  createdAt: timestamp("createdAtJuditMon").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtJuditMon").defaultNow().onUpdateNow().notNull(),
});

export type JuditMonitoramento = typeof juditMonitoramentos.$inferSelect;
export type InsertJuditMonitoramento = typeof juditMonitoramentos.$inferInsert;

/**
 * Respostas/atualizações recebidas da Judit (via webhook ou polling).
 * Cada registro é um snapshot completo do processo em determinado momento.
 */
export const juditRespostas = mysqlTable("judit_respostas", {
  id: int("id").autoincrement().primaryKey(),
  /** FK para judit_monitoramentos.id */
  monitoramentoId: int("monitoramentoId").notNull(),
  /** response_id da Judit */
  responseId: varchar("responseId", { length: 128 }),
  /** request_id da Judit */
  requestId: varchar("requestIdJudit", { length: 128 }),
  /** Tipo: lawsuit, application_info, application_error */
  responseType: varchar("responseType", { length: 64 }).notNull(),
  /** JSON completo da response_data */
  responseData: text("responseDataJudit"),
  /** Se é resposta em cache */
  cachedResponse: boolean("cachedResponse").default(false),
  /** Número de movimentações nesta resposta */
  stepsCount: int("stepsCountJudit").default(0),
  createdAt: timestamp("createdAtJuditResp").defaultNow().notNull(),
});

export type JuditResposta = typeof juditRespostas.$inferSelect;
export type InsertJuditResposta = typeof juditRespostas.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// ASAAS — INTEGRAÇÃO DE COBRANÇAS POR ESCRITÓRIO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuração Asaas por escritório.
 * Cada escritório conecta sua própria API key do Asaas.
 */
export const asaasConfig = mysqlTable("asaas_config", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdAsaas").notNull().unique(),
  apiKeyEncrypted: text("apiKeyEncryptedAsaas"),
  apiKeyIv: varchar("apiKeyIvAsaas", { length: 64 }),
  apiKeyTag: varchar("apiKeyTagAsaas", { length: 64 }),
  modo: mysqlEnum("modoAsaas", ["sandbox", "producao"]).default("producao").notNull(),
  status: mysqlEnum("statusAsaas", ["conectado", "desconectado", "erro"]).default("desconectado").notNull(),
  webhookToken: varchar("webhookTokenAsaas", { length: 128 }),
  ultimoTeste: timestamp("ultimoTesteAsaas"),
  mensagemErro: varchar("mensagemErroAsaas", { length: 512 }),
  saldo: varchar("saldoAsaas", { length: 32 }),
  createdAt: timestamp("createdAtAsaasConfig").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtAsaasConfig").defaultNow().onUpdateNow().notNull(),
});

export type AsaasConfig = typeof asaasConfig.$inferSelect;
export type InsertAsaasConfig = typeof asaasConfig.$inferInsert;

/**
 * Vínculo entre contatos do CRM e clientes do Asaas.
 * Linkado por CPF/CNPJ. Cada contato pode ter no máximo 1 vínculo Asaas.
 */
export const asaasClientes = mysqlTable("asaas_clientes", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdAsaasCli").notNull(),
  contatoId: int("contatoIdAsaas").notNull(),
  asaasCustomerId: varchar("asaasCustomerId", { length: 64 }).notNull(),
  cpfCnpj: varchar("cpfCnpjAsaas", { length: 18 }).notNull(),
  nome: varchar("nomeAsaasCli", { length: 255 }),
  sincronizadoEm: timestamp("sincronizadoEmAsaas").defaultNow().notNull(),
});

export type AsaasCliente = typeof asaasClientes.$inferSelect;
export type InsertAsaasCliente = typeof asaasClientes.$inferInsert;

/**
 * Espelho local das cobranças do Asaas.
 * Mantido sincronizado via webhook e polling.
 */
export const asaasCobrancas = mysqlTable("asaas_cobrancas", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdAsaasCob").notNull(),
  contatoId: int("contatoIdAsaasCob"),
  asaasPaymentId: varchar("asaasPaymentId", { length: 64 }).notNull(),
  asaasCustomerId: varchar("asaasCustomerIdCob", { length: 64 }).notNull(),
  valor: varchar("valorAsaas", { length: 20 }).notNull(),
  valorLiquido: varchar("valorLiquidoAsaas", { length: 20 }),
  vencimento: varchar("vencimentoAsaas", { length: 10 }).notNull(),
  formaPagamento: mysqlEnum("formaPagAsaas", ["BOLETO", "CREDIT_CARD", "PIX", "UNDEFINED"]).notNull(),
  status: varchar("statusAsaasCob", { length: 64 }).notNull(),
  descricao: varchar("descricaoAsaas", { length: 512 }),
  invoiceUrl: text("invoiceUrlAsaas"),
  bankSlipUrl: text("bankSlipUrlAsaas"),
  pixQrCodePayload: text("pixQrCodePayload"),
  dataPagamento: varchar("dataPagamentoAsaas", { length: 10 }),
  externalReference: varchar("externalRefAsaas", { length: 255 }),
  createdAt: timestamp("createdAtAsaasCob").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtAsaasCob").defaultNow().onUpdateNow().notNull(),
});

export type AsaasCobranca = typeof asaasCobrancas.$inferSelect;
export type InsertAsaasCobranca = typeof asaasCobrancas.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATES DE MENSAGEM — Respostas rapidas por escritorio
// ═══════════════════════════════════════════════════════════════════════════════

export const mensagemTemplates = mysqlTable("mensagem_templates", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdTpl").notNull(),
  titulo: varchar("tituloTpl", { length: 100 }).notNull(),
  conteudo: text("conteudoTpl").notNull(),
  categoria: mysqlEnum("categoriaTpl", ["saudacao", "cobranca", "agendamento", "juridico", "encerramento", "outro"]).default("outro").notNull(),
  atalho: varchar("atalhoTpl", { length: 20 }),
  criadoPor: int("criadoPorTpl").notNull(),
  createdAt: timestamp("createdAtTpl").defaultNow().notNull(),
});

export type MensagemTemplate = typeof mensagemTemplates.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// CRÉDITOS JUDIT — Sistema de créditos por escritório
// ═══════════════════════════════════════════════════════════════════════════════

export const juditCreditos = mysqlTable("judit_creditos", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdJCred").notNull(),
  saldo: int("saldoJCred").default(0).notNull(),
  totalComprado: int("totalCompradoJCred").default(0).notNull(),
  totalConsumido: int("totalConsumidoJCred").default(0).notNull(),
  updatedAt: timestamp("updatedAtJCred").defaultNow().onUpdateNow().notNull(),
});

export const juditTransacoes = mysqlTable("judit_transacoes", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdJTx").notNull(),
  tipo: mysqlEnum("tipoJTx", ["compra", "consumo", "bonus", "estorno"]).notNull(),
  quantidade: int("quantidadeJTx").notNull(),
  saldoAnterior: int("saldoAnteriorJTx").notNull(),
  saldoDepois: int("saldoDepoisJTx").notNull(),
  operacao: varchar("operacaoJTx", { length: 64 }).notNull(),
  detalhes: varchar("detalhesJTx", { length: 512 }),
  userId: int("userIdJTx").notNull(),
  createdAt: timestamp("createdAtJTx").defaultNow().notNull(),
});

/**
 * Notas internas do admin sobre clientes — visíveis apenas no painel admin.
 *
 * Usado pelo time de suporte/financeiro pra registrar contexto sobre um
 * cliente: "Ligou reclamando do bug X em 15/03", "Pediu desconto e
 * negamos", "Cliente VIP", etc. Não é visível pro próprio cliente.
 */
export const clienteNotasAdmin = mysqlTable("cliente_notas_admin", {
  id: int("id").autoincrement().primaryKey(),
  /** Sobre qual usuário/escritório é a nota */
  userId: int("userIdNota").notNull(),
  /** Quem criou a nota (admin) */
  autorAdminId: int("autorAdminIdNota").notNull(),
  /** Conteúdo livre (markdown permitido) */
  conteudo: text("conteudoNota").notNull(),
  /** Categoria opcional pra filtrar/destacar */
  categoria: mysqlEnum("categoriaNota", ["geral", "financeiro", "suporte", "comercial", "alerta"]).default("geral").notNull(),
  createdAt: timestamp("createdAtNota").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtNota").defaultNow().onUpdateNow().notNull(),
});

export type ClienteNotaAdmin = typeof clienteNotasAdmin.$inferSelect;
export type InsertClienteNotaAdmin = typeof clienteNotasAdmin.$inferInsert;
