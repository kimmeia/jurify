import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, bigint, boolean, index, decimal, uniqueIndex, primaryKey } from "drizzle-orm/mysql-core";

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
   * - openIds legados de OAuth externo (contas antigas)
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
  /** Método de login: 'email', 'google', 'demo' (pode conter valores legados em contas antigas) */
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
  /**
   * Quando o usuário aceitou os Termos de Uso + Política de Privacidade.
   * Required pra signup novo (LGPD: aceite explícito e auditável). Pode
   * ser null em contas antigas — aí pedimos aceite no próximo login
   * (TODO frontend).
   */
  aceitouTermosEm: timestamp("aceitouTermosEm"),
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
  /** Tipo: movimentacao, sistema, plano, nova_acao */
  tipo: mysqlEnum("tipoNotif", ["movimentacao", "sistema", "plano", "nova_acao"]).default("sistema").notNull(),
  /** ID do processo relacionado (se tipo = movimentacao) */
  processoId: int("processoId"),
  /**
   * Se a notif veio de um evento_processo específico, referência aqui
   * pra deep-link no drawer. Sem FK formal pra simplificar cleanup de
   * eventos antigos. NULL pra notifs sem evento associado (sistema,
   * plano).
   */
  eventoId: bigint("eventoId", { mode: "number" }),
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
  /**
   * Feature flag do motor próprio de monitoramento jurídico.
   * Quando true, os monitoramentos deste escritório usam scrapers
   * próprios (PJe/E-SAJ/Eproc/DJE) em vez da Judit. Default false
   * para garantir que escritórios existentes continuem na Judit
   * (plano B) até a migração explícita pós-Spike.
   *
   * Em ambiente production, esta flag é ignorada se
   * JURIFY_AMBIENTE !== "staging" durante o Spike — proteção contra
   * ativação acidental antes da paridade comprovada.
   */
  usarMotorProprio: boolean("usarMotorProprio").default(false).notNull(),
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
export const colaboradores = mysqlTable(
  "colaboradores",
  {
    id: int("id").autoincrement().primaryKey(),
    escritorioId: int("escritorioId").notNull(), // FK → escritorios.id
    userId: int("userId").notNull(), // FK → users.id
    cargo: mysqlEnum("cargo", ["dono", "gestor", "atendente", "estagiario", "sdr"]).notNull(),
    departamento: varchar("departamento", { length: 64 }),
    ativo: boolean("ativo").default(true).notNull(),
    maxAtendimentosSimultaneos: int("maxAtendimentosSimultaneos").default(5).notNull(),
    recebeLeadsAutomaticos: boolean("recebeLeadsAutomaticos").default(true).notNull(),
    ultimaAtividade: timestamp("ultimaAtividade"),
    ultimaDistribuicao: timestamp("ultimaDistribuicao"),
    cargoPersonalizadoId: int("cargoPersonalizadoId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    // Barra race em aceitarConvite: se duas abas aceitam o mesmo convite
    // simultaneamente, a segunda tentativa de INSERT falha com duplicate
    // key (o código captura e retorna sucesso idempotente).
    uqEscritorioUser: uniqueIndex("colaboradores_escritorio_user_uq").on(
      t.escritorioId,
      t.userId,
    ),
  }),
);

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
  /**
   * Cargo do convite. Pode ser um dos defaults ("gestor", "atendente",
   * "estagiario") OU o nome de um cargo personalizado criado pelo
   * escritório (ex: "advogados", "secretaria"). Validado em runtime
   * pelo backend (`enviarConvite`). Quando o convite é aceito,
   * `aceitarConvite` resolve `cargoPersonalizadoId` por nome.
   */
  cargo: varchar("cargoConvite", { length: 64 }).notNull(),
  departamento: varchar("departamentoConvite", { length: 64 }),
  token: varchar("token", { length: 128 }).notNull().unique(),
  status: mysqlEnum("statusConvite", ["pendente", "aceito", "expirado", "cancelado"]).default("pendente").notNull(),
  convidadoPorId: int("convidadoPorId").notNull(), // FK → colaboradores.id
  aceitoPorUserId: int("aceitoPorUserId"), // FK → users.id (preenchido ao aceitar)
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /**
   * Resultado do envio do email pelo Resend. False quando convite criado
   * mas email rejeitado (domínio não verificado, quota, etc). Permite
   * `reenviarConvite` tentar de novo + admin ver pendências.
   */
  emailEnviado: boolean("emailEnviado").default(false).notNull(),
  ultimoErroEmail: varchar("ultimoErroEmail", { length: 512 }),
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
  /** Cliente vinculado (opcional). Permite que o "responsável do cliente"
   *  veja o agendamento mesmo não tendo sido o criador/responsável direto. */
  contatoId: int("contatoIdAgend"),
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
  tipo: mysqlEnum("tipoCanal", ["whatsapp_qr", "whatsapp_api", "instagram", "facebook", "telefone_voip", "calcom", "chatgpt", "claude"]).notNull(),
  nome: varchar("nomeCanal", { length: 128 }),
  status: mysqlEnum("statusCanal", ["conectado", "desconectado", "pendente", "erro", "banido"]).default("pendente").notNull(),
  configEncrypted: text("configEncrypted"),
  configIv: varchar("configIv", { length: 64 }),
  configTag: varchar("configTag", { length: 64 }),
  webhookSecret: varchar("webhookSecret", { length: 128 }),
  telefone: varchar("telefoneCanal", { length: 20 }),
  ultimaSync: timestamp("ultimaSyncCanal"),
  mensagemErro: varchar("mensagemErro", { length: 512 }),
  // Texto fixo enviado quando uma mensagem chega e o SmartFlow não tem cenário
  // para responder. Se null/vazio, nada é enviado (operador atende manual).
  autoReplyFallback: text("autoReplyFallback"),
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
  /** Telefones secundários (JSON array). Permite cadastrar múltiplos números
   *  pro mesmo contato (ex: pessoal + comercial). A busca por telefone
   *  verifica principal + secundários + histórico. */
  telefonesSecundarios: text("telefonesSecundarios"),
  email: varchar("emailContato", { length: 320 }),
  cpfCnpj: varchar("cpfCnpj", { length: 18 }),
  origem: mysqlEnum("origemContato", ["whatsapp", "instagram", "facebook", "telefone", "manual", "site", "asaas"]).default("manual").notNull(),
  tags: text("tagsContato"),
  observacoes: text("observacoesContato"),
  responsavelId: int("responsavelIdContato"),
  /**
   * Atendente responsável padrão pelo cliente (FK → colaboradores.id).
   * Usado como sugestão default ao criar cobrança e como `groupName` no Asaas.
   * Cobranças sincronizadas que vêm sem `externalReference` herdam este atendente.
   */
  atendenteResponsavelId: int("atendenteRespIdContato"),
  /**
   * Cliente está aguardando o envio de documentos (RG, procuração, comprovante,
   * etc). Quando true, aparece no card "Aguardando documentação" do dashboard
   * e em filtro próprio na lista de clientes. SmartFlow pode usar essa flag
   * como condição em gatilhos (ex: WhatsApp automático cobrando docs).
   */
  documentacaoPendente: boolean("documentacaoPendente").default(false).notNull(),
  /**
   * Observações livres do que está pendente. Ex: "Falta RG e procuração
   * assinada". O atendente preenche ao marcar a flag e atualiza conforme
   * recebe os documentos.
   */
  documentacaoObservacoes: text("documentacaoObservacoes"),
  /**
   * Valores dos campos personalizados do escritório (definidos em
   * `camposPersonalizadosCliente`). JSON serializado com formato:
   * `{ "<chave>": "<valor>" }`. Nulo quando o cliente ainda não tem
   * nenhum valor definido. Disponível no SmartFlow como
   * `{{cliente.campos.<chave>}}`.
   */
  camposPersonalizados: text("camposPersonalizadosContato"),
  /**
   * Qualificação civil — usadas em contratos. Todos opcionais (cliente
   * vem do WhatsApp/lead com pouca info; o operador completa quando
   * faz o contrato). Disponíveis no SmartFlow como `{{cliente.profissao}}`,
   * `{{cliente.estadoCivil}}`, etc.
   */
  profissao: varchar("profissaoContato", { length: 100 }),
  estadoCivil: mysqlEnum("estadoCivilContato", [
    "solteiro",
    "casado",
    "divorciado",
    "viuvo",
    "uniao_estavel",
  ]),
  nacionalidade: varchar("nacionalidadeContato", { length: 50 }),
  /** Endereço estruturado. CEP no formato "12345-678" (com hífen). */
  cep: varchar("cepContato", { length: 9 }),
  logradouro: varchar("logradouroContato", { length: 200 }),
  numeroEndereco: varchar("numeroEnderecoContato", { length: 20 }),
  complemento: varchar("complementoContato", { length: 100 }),
  bairro: varchar("bairroContato", { length: 100 }),
  cidade: varchar("cidadeContato", { length: 100 }),
  uf: varchar("ufContato", { length: 2 }),
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
  /**
   * Área de especialização do agente (ex: "Direito Trabalhista", "Análise
   * Processual", "Recepção"). Usada pra categorizar na UI e filtrar quando
   * outros módulos precisam selecionar qual agente invocar.
   */
  areaConhecimento: varchar("areaConhecimentoAgenteIa", { length: 128 }),
  modelo: varchar("modelo", { length: 64 }).notNull().default("gpt-4o-mini"),
  prompt: text("prompt").notNull(),
  ativo: boolean("ativo").notNull().default(false),
  canalId: int("canalId"),
  openaiApiKey: text("openaiApiKey"),
  apiKeyIv: varchar("apiKeyIv", { length: 64 }),
  apiKeyTag: varchar("apiKeyTag", { length: 64 }),
  maxTokens: int("maxTokens").notNull().default(500),
  temperatura: varchar("temperatura", { length: 10 }).notNull().default("0.70"),
  /**
   * Módulos onde este agente pode ser invocado: CSV de
   * "atendimento,analiseProcessual,resumos,documentos,calculos,pesquisa".
   * Null/vazio = disponível em todos os módulos que suportarem agentes.
   */
  modulosPermitidos: varchar("modulosPermitidosAgenteIa", { length: 500 }),
  /**
   * ID do usuário (colaborador) que criou o agente. Usado pelo controle de
   * permissões `verProprios` — colaboradores só podem editar seus próprios agentes.
   */
  criadoPor: int("criadoPorAgenteIa"),
  createdAt: timestamp("createdAtAgente").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtAgente").defaultNow().onUpdateNow().notNull(),
});

export type AgenteIa = typeof agentesIa.$inferSelect;
export type InsertAgenteIa = typeof agentesIa.$inferInsert;

/**
 * Documentos de treinamento vinculados a um agente do escritório.
 * Mesma estrutura da `agente_documentos` do admin mas scoped ao
 * escritório (via `agenteId` → agentes_ia.id).
 *
 * Usado pra RAG: quando o agente é invocado, seu contexto inclui
 * os documentos aqui listados.
 */
export const agenteIaDocumentos = mysqlTable("agente_ia_documentos", {
  id: int("id").autoincrement().primaryKey(),
  agenteId: int("agenteIdIaDoc").notNull(),
  escritorioId: int("escritorioIdIaDoc").notNull(),
  nome: varchar("nomeIaDoc", { length: 255 }).notNull(),
  tipo: mysqlEnum("tipoIaDoc", ["arquivo", "link", "texto"]).notNull(),
  url: varchar("urlIaDoc", { length: 1024 }),
  conteudo: text("conteudoIaDoc"),
  tamanho: int("tamanhoIaDoc"),
  mimeType: varchar("mimeTypeIaDoc", { length: 128 }),
  createdAt: timestamp("createdAtIaDoc").defaultNow().notNull(),
});

export type AgenteIaDocumento = typeof agenteIaDocumentos.$inferSelect;
export type InsertAgenteIaDocumento = typeof agenteIaDocumentos.$inferInsert;

/**
 * Chat interno dos agentes IA — threads (conversas) + mensagens.
 *
 * Usado pela tela /agentes-ia/:id/chat onde o advogado conversa direto com
 * o agente (confecção de peças, análise de casos, pesquisa, etc). Separado
 * das tabelas `conversas`/`mensagens` porque aquelas são do Atendimento ao
 * cliente final (exigem canalId, status de atendimento, etc) — o chat
 * interno é muito mais simples e não compartilha semântica.
 */
export const agenteChatThreads = mysqlTable("agente_chat_threads", {
  id: int("id").autoincrement().primaryKey(),
  agenteId: int("agenteIdThread").notNull(),
  escritorioId: int("escritorioIdThread").notNull(),
  usuarioId: int("usuarioIdThread").notNull(),
  titulo: varchar("tituloThread", { length: 200 }).notNull().default("Nova conversa"),
  arquivada: boolean("arquivadaThread").notNull().default(false),
  createdAt: timestamp("createdAtThread").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtThread").defaultNow().onUpdateNow().notNull(),
});

export type AgenteChatThread = typeof agenteChatThreads.$inferSelect;
export type InsertAgenteChatThread = typeof agenteChatThreads.$inferInsert;

export const agenteChatMensagens = mysqlTable("agente_chat_mensagens", {
  id: int("id").autoincrement().primaryKey(),
  threadId: int("threadIdMsg").notNull(),
  role: mysqlEnum("roleMsg", ["user", "assistant", "system"]).notNull(),
  conteudo: text("conteudoMsg").notNull(),
  anexoUrl: varchar("anexoUrlMsg", { length: 1024 }),
  anexoNome: varchar("anexoNomeMsg", { length: 255 }),
  anexoMime: varchar("anexoMimeMsg", { length: 128 }),
  /** Texto extraído do anexo p/ passar como contexto quando possível (TXT/MD/CSV/JSON) */
  anexoConteudo: text("anexoConteudoMsg"),
  tokensUsados: int("tokensUsadosMsg").notNull().default(0),
  createdAt: timestamp("createdAtMsg").defaultNow().notNull(),
});

export type AgenteChatMensagem = typeof agenteChatMensagens.$inferSelect;
export type InsertAgenteChatMensagem = typeof agenteChatMensagens.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 5 — MÓDULO CLIENTES (Arquivos + Anotações)
// ═══════════════════════════════════════════════════════════════════════════════

export const clienteArquivos = mysqlTable("cliente_arquivos", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioId").notNull(),
  contatoId: int("contatoId").notNull(),
  pastaId: int("pastaIdArquivo"), // null = arquivo na raiz (sem pasta)
  nome: varchar("nome", { length: 255 }).notNull(),
  tipo: varchar("tipo", { length: 255 }),
  tamanho: int("tamanho"),
  url: text("url").notNull(),
  uploadPor: int("uploadPor"),
  createdAt: timestamp("createdAtArquivo").defaultNow().notNull(),
});

export type ClienteArquivo = typeof clienteArquivos.$inferSelect;
export type InsertClienteArquivo = typeof clienteArquivos.$inferInsert;

/**
 * Pastas de documentos do cliente — organização em árvore N-ária.
 * parentId auto-referencial: null = pasta na raiz do cliente; caso contrário,
 * aponta para a pasta mãe. Exclusão é recursiva e definitiva (apaga subpastas
 * e arquivos dentro).
 */
export const clientePastas = mysqlTable("cliente_pastas", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdPasta").notNull(),
  contatoId: int("contatoIdPasta").notNull(),
  parentId: int("parentIdPasta"), // null = pasta na raiz
  nome: varchar("nomePasta", { length: 128 }).notNull(),
  criadoPor: int("criadoPorPasta"),
  createdAt: timestamp("createdAtPasta").defaultNow().notNull(),
});

export type ClientePasta = typeof clientePastas.$inferSelect;
export type InsertClientePasta = typeof clientePastas.$inferInsert;

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

/**
 * Processos vinculados a um cliente — permite ao escritório registrar
 * quais processos representam cada cliente, com opção de monitorar.
 */
export const clienteProcessos = mysqlTable("cliente_processos", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdCliProc").notNull(),
  contatoId: int("contatoIdCliProc").notNull(),
  /** Número CNJ do processo */
  numeroCnj: varchar("numeroCnjCliProc", { length: 30 }).notNull(),
  /** Apelido/descrição livre (ex: "Divórcio", "Trabalhista") */
  apelido: varchar("apelidoCliProc", { length: 255 }),
  /** Tribunal identificado */
  tribunal: varchar("tribunalCliProc", { length: 16 }),
  /** Classe processual */
  classe: varchar("classeCliProc", { length: 255 }),
  /** Valor da causa */
  valorCausa: int("valorCausaCliProc"),
  /** Polo do cliente (ativo/passivo) */
  polo: mysqlEnum("poloCliProc", ["ativo", "passivo", "interessado"]),
  /**
   * Tipo do processo: extrajudicial (negociação, mediação fora do
   * tribunal) ou litigioso (ajuizado, em tramitação judicial).
   * Default 'litigioso' por ser o mais comum no fluxo do escritório.
   */
  tipo: mysqlEnum("tipoCliProc", ["extrajudicial", "litigioso"]).default("litigioso").notNull(),
  criadoPor: int("criadoPorCliProc"),
  createdAt: timestamp("createdAtCliProc").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtCliProc").defaultNow().onUpdateNow().notNull(),
});

/**
 * Anotações livres por processo do cliente. Cada atendente pode adicionar
 * notas curtas de andamento (audiência marcada, despacho recebido, parte
 * contrária respondeu, etc) sem precisar criar tarefa formal.
 *
 * Imutável após criação (não tem update). Pra corrigir, exclui e cria
 * outra. Mantém auditoria limpa.
 */
export const clienteProcessoAnotacoes = mysqlTable("cliente_processo_anotacoes", {
  id: int("id").autoincrement().primaryKey(),
  processoId: int("processoIdAnot").notNull(),
  autorUserId: int("autorUserIdAnot").notNull(),
  conteudo: text("conteudoAnot").notNull(),
  createdAt: timestamp("createdAtAnot").defaultNow().notNull(),
}, (t) => ({
  cpaProcessoIdx: index("cpa_processo_idx").on(t.processoId),
}));

export type ClienteProcessoAnotacao = typeof clienteProcessoAnotacoes.$inferSelect;
export type InsertClienteProcessoAnotacao = typeof clienteProcessoAnotacoes.$inferInsert;

export type ClienteProcesso = typeof clienteProcessos.$inferSelect;
export type InsertClienteProcesso = typeof clienteProcessos.$inferInsert;

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

// ═══════════════════════════════════════════════════════════════════════════════
// JUDIT — REMOVIDO 08/05/2026
// ═══════════════════════════════════════════════════════════════════════════════
// Tabelas juditMonitoramentos / juditCredenciais / juditNovasAcoes /
// juditRespostas removidas (DROP) na migration 0070_remove_judit.sql.
// Substituídas pelo motor próprio:
//   - Cofre: cofre_credenciais (já existe)
//   - Sessões: cofre_sessoes (já existe)
//   - Eventos: motor_proprio_eventos (já existe)
//   - Monitoramentos: motor_proprio_monitoramentos (Sprint 2)

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
  status: mysqlEnum("statusAsaas", ["conectado", "desconectado", "erro", "aguardando_validacao"]).default("desconectado").notNull(),
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
 *
 * O Asaas permite múltiplos customers com o mesmo CPF/CNPJ (duplicatas
 * geradas por imports antigos, cadastro manual, webhooks legados, etc).
 * No nosso lado unificamos tudo sob UM contato do CRM: pode haver N linhas
 * aqui com o mesmo contatoId, uma para cada asaasCustomerId.
 *
 * `primario` marca qual dos N é usado para CRIAR novas cobranças. Os demais
 * servem apenas para puxar o histórico financeiro (sync). Sempre deve haver
 * exatamente um primário por contato; secundários têm primario=false.
 */
export const asaasClientes = mysqlTable("asaas_clientes", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdAsaasCli").notNull(),
  contatoId: int("contatoIdAsaas").notNull(),
  asaasCustomerId: varchar("asaasCustomerId", { length: 64 }).notNull(),
  cpfCnpj: varchar("cpfCnpjAsaas", { length: 18 }).notNull(),
  nome: varchar("nomeAsaasCli", { length: 255 }),
  primario: boolean("primarioAsaasCli").notNull().default(true),
  sincronizadoEm: timestamp("sincronizadoEmAsaas").defaultNow().notNull(),
  /**
   * Flag de soft-disable. Cron de sync skipa rows com ativo=false.
   * Marcado false quando o Asaas retorna 403 sistemicamente pra
   * GET /payments?customer=X — chave sem permissão de ler aquele
   * customer. Admin pode reativar via UI quando resolver.
   */
  ativo: boolean("ativo").notNull().default(true),
  ultimoErro403Em: timestamp("ultimoErro403Em"),
  ultimoErro403Mensagem: varchar("ultimoErro403Mensagem", { length: 255 }),
});

export type AsaasCliente = typeof asaasClientes.$inferSelect;
export type InsertAsaasCliente = typeof asaasClientes.$inferInsert;

/**
 * Espelho local das cobranças do Asaas.
 * Mantido sincronizado via webhook e polling.
 */
export const asaasCobrancas = mysqlTable(
  "asaas_cobrancas",
  {
    id: int("id").autoincrement().primaryKey(),
    escritorioId: int("escritorioIdAsaasCob").notNull(),
    contatoId: int("contatoIdAsaasCob"),
    /** ID do pagamento no Asaas. NULL pra cobrança manual (sem
     *  integração — cliente pagou em dinheiro/cartão presencial). */
    asaasPaymentId: varchar("asaasPaymentId", { length: 64 }),
    /** ID do customer no Asaas. NULL pra cobrança manual quando o
     *  contato não está vinculado ao Asaas. */
    asaasCustomerId: varchar("asaasCustomerIdCob", { length: 64 }),
    /**
     * Origem da cobrança:
     *  - 'asaas': criada via API Asaas, status sincronizado por webhook
     *  - 'manual': lançada na UI sem passar por Asaas (ex: cliente
     *     pagou presencialmente em dinheiro). Operador marca paga
     *     manualmente.
     */
    origem: mysqlEnum("origemAsaasCob", ["asaas", "manual"]).default("asaas").notNull(),
    valor: varchar("valorAsaas", { length: 20 }).notNull(),
    valorLiquido: varchar("valorLiquidoAsaas", { length: 20 }),
    vencimento: varchar("vencimentoAsaas", { length: 10 }).notNull(),
    formaPagamento: mysqlEnum("formaPagAsaas", [
      "BOLETO",
      "CREDIT_CARD",
      "PIX",
      "UNDEFINED",
      "DINHEIRO",
      "TRANSFERENCIA",
      "OUTRO",
    ]).notNull(),
    status: varchar("statusAsaasCob", { length: 64 }).notNull(),
    descricao: varchar("descricaoAsaas", { length: 512 }),
    invoiceUrl: text("invoiceUrlAsaas"),
    bankSlipUrl: text("bankSlipUrlAsaas"),
    pixQrCodePayload: text("pixQrCodePayload"),
    dataPagamento: varchar("dataPagamentoAsaas", { length: 10 }),
    externalReference: varchar("externalRefAsaas", { length: 255 }),
    /** Atendente que receberá comissão por esta cobrança (FK → colaboradores.id). */
    atendenteId: int("atendenteIdAsaasCob"),
    /** Categoria da cobrança (FK → categorias_cobranca.id). */
    categoriaId: int("categoriaIdAsaasCob"),
    /**
     * Override manual de elegibilidade para comissão.
     * NULL = obedece flag da categoria; TRUE/FALSE = força.
     */
    comissionavelOverride: boolean("comissionavelOverrideAsaasCob"),
    /**
     * Identificador local de parcelamento (nanoid).
     *
     * Em vez de usar o /installments do Asaas (que junta tudo no cartão de
     * crédito), o sistema cria N cobranças avulsas com vencimentos mensais
     * sequenciais e amarra elas pelo mesmo `parcelamentoLocalId`. Resultado:
     * cliente paga cada parcela com o método que quiser (cartão/PIX/boleto
     * por parcela) e o CRM agrupa visualmente como "Parcelamento Nx".
     *
     * NULL pra cobranças avulsas (não-parcelado) e pras parceladas legadas
     * criadas via /installments (que mantêm o asaasParentId no Asaas).
     */
    parcelamentoLocalId: varchar("parcelamentoLocalId", { length: 64 }),
    /** Número da parcela atual (1, 2, 3...). NULL pra avulsas. */
    parcelaAtual: int("parcelaAtual"),
    /** Total de parcelas do parcelamento. NULL pra avulsas. */
    parcelaTotal: int("parcelaTotal"),
    createdAt: timestamp("createdAtAsaasCob").defaultNow().notNull(),
    updatedAt: timestamp("updatedAtAsaasCob").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    // Retry do Asaas (rede/timeout) pode reenviar o mesmo PAYMENT_CREATED.
    // Garante no banco que uma cobrança só existe uma vez por escritório —
    // o handler usa INSERT ... ON DUPLICATE KEY UPDATE e vira idempotente.
    uqPayment: uniqueIndex("asaas_cob_escr_payment_uq").on(
      t.escritorioId,
      t.asaasPaymentId,
    ),
    // Acelera relatório de comissão (filtra por atendente + período).
    idxAtendentePagamento: index("asaas_cob_atendente_pag_idx").on(
      t.escritorioId,
      t.atendenteId,
      t.dataPagamento,
    ),
    // Acelera lookup de parcelamento (agrupar parcelas no CRM).
    idxParcelamentoLocal: index("asaas_cob_parcel_local_idx").on(
      t.parcelamentoLocalId,
    ),
  }),
);

export type AsaasCobranca = typeof asaasCobrancas.$inferSelect;
export type InsertAsaasCobranca = typeof asaasCobrancas.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// ASAAS WEBHOOK — EVENTOS JÁ PROCESSADOS (idempotência do SmartFlow)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Vínculo N:M entre cobranças e ações (cliente_processos).
 *
 * Permite "1 cobrança ativa N ações" (cenário do pacote: cobro R$ 3.000
 * e isso fecha 3 ações distintas) e "N cobranças por ação" (parcelamento).
 *
 * Quando um pagamento entra (webhook PAYMENT_RECEIVED), o dispatcher
 * busca as ações vinculadas e dispara `pagamento_recebido` UMA VEZ por
 * ação (cada execução do SmartFlow tem o contexto da ação dela). Sem
 * vínculo nenhum, dispara 1 evento legado (sem `acaoId`).
 *
 * `ON DELETE CASCADE`:
 *   - cobrancaId: se a cobrança é deletada, o vínculo some (não tem mais
 *     o que vincular). Mantém ação intacta.
 *   - processoId: se a ação é deletada, vínculo some (cobrança continua
 *     existindo mas perde a referência).
 */
export const cobrancaAcoes = mysqlTable(
  "cobranca_acoes",
  {
    cobrancaId: int("cobrancaIdAc").notNull(),
    processoId: int("processoIdAc").notNull(),
    createdAt: timestamp("createdAtCobAc").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.cobrancaId, t.processoId] }),
    idxCobranca: index("cob_acoes_cob_idx").on(t.cobrancaId),
    idxProcesso: index("cob_acoes_proc_idx").on(t.processoId),
  }),
);

export type CobrancaAcao = typeof cobrancaAcoes.$inferSelect;
export type InsertCobrancaAcao = typeof cobrancaAcoes.$inferInsert;

/**
 * Registro de eventos do webhook Asaas já processados. Evita que retries do
 * Asaas disparem SmartFlow (WhatsApp/e-mail de confirmação) em duplicata.
 *
 * Chave única (escritorio + paymentId + eventType): um mesmo payment pode
 * legitimamente receber eventos distintos (PAYMENT_RECEIVED, PAYMENT_OVERDUE,
 * etc.), mas cada combinação processa uma única vez.
 */
export const asaasWebhookEventos = mysqlTable(
  "asaas_webhook_eventos",
  {
    id: int("id").autoincrement().primaryKey(),
    escritorioId: int("escritorioIdWhEv").notNull(),
    asaasPaymentId: varchar("asaasPaymentIdWhEv", { length: 64 }).notNull(),
    eventType: varchar("eventTypeWhEv", { length: 64 }).notNull(),
    /**
     * ID da ação (cliente_processos.id) que gerou este disparo.
     *
     * Quando uma cobrança está vinculada a N ações via `cobranca_acoes`,
     * o dispatcher dispara N eventos `pagamento_recebido` (1 por ação),
     * cada um com seu próprio contexto. Idempotência fica por
     * `(escritorio, payment, evento, acao)` em vez de só
     * `(escritorio, payment, evento)`.
     *
     * `0` (default) = cobrança SEM ação vinculada (legado / sem multi-ação).
     * Uso de NOT NULL com DEFAULT 0 (em vez de NULL) é proposital: MySQL
     * trata NULLs como distintos em UNIQUE, então 2 NULLs do retry do
     * Asaas burlariam a idempotência.
     */
    acaoId: int("acaoIdWhEv").notNull().default(0),
    processedAt: timestamp("processedAtWhEv").defaultNow().notNull(),
  },
  (t) => ({
    uqEvento: uniqueIndex("asaas_wh_ev_uq").on(
      t.escritorioId,
      t.asaasPaymentId,
      t.eventType,
      t.acaoId,
    ),
  }),
);

export type AsaasWebhookEvento = typeof asaasWebhookEventos.$inferSelect;
export type InsertAsaasWebhookEvento = typeof asaasWebhookEventos.$inferInsert;

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
// CRÉDITOS MOTOR PRÓPRIO — Sistema de créditos por escritório
// ═══════════════════════════════════════════════════════════════════════════════
// Renomeado de judit_creditos / judit_transacoes na migration 0070
// (pós-remoção do Judit). Schema preservado.

export const escritorioCreditos = mysqlTable("escritorio_creditos", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdJCred").notNull(),
  saldo: int("saldoJCred").default(0).notNull(),
  totalComprado: int("totalCompradoJCred").default(0).notNull(),
  totalConsumido: int("totalConsumidoJCred").default(0).notNull(),
  cotaMensal: int("cotaMensal").default(0).notNull(),
  ultimoReset: timestamp("ultimoReset"),
  updatedAt: timestamp("updatedAtJCred").defaultNow().onUpdateNow().notNull(),
});

// Aliases pra compat retroativa enquanto migra todos os call sites
export const motorCreditos = escritorioCreditos;

export const escritorioTransacoes = mysqlTable("escritorio_transacoes", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdJTx").notNull(),
  tipo: mysqlEnum("tipoJTx", ["compra", "consumo", "bonus", "estorno", "reset_mensal"]).notNull(),
  quantidade: int("quantidadeJTx").notNull(),
  saldoAnterior: int("saldoAnteriorJTx").notNull(),
  saldoDepois: int("saldoDepoisJTx").notNull(),
  operacao: varchar("operacaoJTx", { length: 64 }).notNull(),
  detalhes: varchar("detalhesJTx", { length: 512 }),
  userId: int("userIdJTx").notNull(),
  createdAt: timestamp("createdAtJTx").defaultNow().notNull(),
});

// Aliases pra retrocompatibilidade com código que ainda importa nomes
// antigos. Removidos em sprint posterior conforme refator avança.
export const motorTransacoes = escritorioTransacoes;
export const juditCreditos = escritorioCreditos;
export const juditTransacoes = escritorioTransacoes;

/**
 * Motor próprio — Monitoramentos.
 *
 * Cobre 2 cenários:
 *   - tipo='movimentacoes': monitora UM processo específico (CNJ).
 *     Cron polls cada N horas → detecta movs novas → cria evento.
 *   - tipo='novas_acoes': monitora pessoa (CPF/CNPJ). Cron polls
 *     cada N horas → busca por documento → detecta CNJs novos →
 *     cria evento "nova_acao".
 *
 * Eventos detectados são gravados em `eventos_processo` (sem FK
 * porque Drizzle/MySQL não dá conta de FK polimórficas).
 */
export const motorMonitoramentos = mysqlTable("motor_monitoramentos", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorio_id").notNull(),
  criadoPor: int("criado_por").notNull(),
  tipoMonitoramento: mysqlEnum("tipo_monitoramento", ["movimentacoes", "novas_acoes"]).notNull(),
  searchType: mysqlEnum("search_type", ["lawsuit_cnj", "cpf", "cnpj"]).notNull(),
  searchKey: varchar("search_key", { length: 64 }).notNull(),
  apelido: varchar("apelido", { length: 255 }),
  tribunal: varchar("tribunal", { length: 16 }).notNull(),
  credencialId: int("credencial_id"),
  status: mysqlEnum("status", ["ativo", "pausado", "erro"]).default("ativo").notNull(),
  recurrenceHoras: int("recurrence_horas").default(6).notNull(),
  ultimaConsultaEm: timestamp("ultima_consulta_em"),
  ultimaMovimentacaoEm: timestamp("ultima_movimentacao_em"),
  ultimaMovimentacaoTexto: text("ultima_movimentacao_texto"),
  totalAtualizacoes: int("total_atualizacoes").default(0).notNull(),
  totalNovasAcoes: int("total_novas_acoes").default(0).notNull(),
  hashUltimasMovs: varchar("hash_ultimas_movs", { length: 64 }),
  cnjsConhecidos: text("cnjs_conhecidos"),
  /**
   * Capa do processo serializada (classeProcesso, juiz, vara,
   * valorCausaCentavos, dataDistribuicao, etc.). Persistida pelo cron
   * + pela busca sob demanda — frontend lê daqui em vez de re-consultar
   * o tribunal a cada refresh.
   */
  capaJson: text("capa_json"),
  /**
   * Partes do processo serializadas (autor, réu, advogados, polos).
   * Mesmo padrão de capaJson.
   */
  partesJson: text("partes_json"),
  ultimaCobrancaEm: timestamp("ultima_cobranca_em"),
  ultimoErro: text("ultimo_erro"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type MotorMonitoramento = typeof motorMonitoramentos.$inferSelect;
export type InsertMotorMonitoramento = typeof motorMonitoramentos.$inferInsert;

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

/**
 * Audit log — toda ação sensível executada por admin do Jurify ou via
 * impersonation deve ser registrada aqui. Imutável (apenas INSERTs).
 *
 * Compliance + troubleshooting: "quem promoveu fulano a admin?",
 * "quem suspendeu este escritório e quando?", "este admin entrou como
 * cliente X em qual horário?".
 */
export const auditLog = mysqlTable("audit_log", {
  id: int("id").autoincrement().primaryKey(),
  /** ID do usuário ator (admin que executou). */
  actorUserId: int("actorUserIdAudit").notNull(),
  /** Nome do ator no momento do log (snapshot, evita join no read). */
  actorName: varchar("actorNameAudit", { length: 255 }),
  /**
   * Identificador da ação. Ex: "user.bloquear", "escritorio.suspender",
   * "user.impersonar", "user.resetSenha", "plano.editar".
   */
  acao: varchar("acaoAudit", { length: 100 }).notNull(),
  /** Tipo do alvo: "user" | "escritorio" | "plano" | "subscription" | etc */
  alvoTipo: varchar("alvoTipoAudit", { length: 50 }),
  /** ID numérico do alvo (quando aplicável) */
  alvoId: int("alvoIdAudit"),
  /** Nome/email do alvo no momento do log (snapshot pra leitura rápida) */
  alvoNome: varchar("alvoNomeAudit", { length: 255 }),
  /** JSON com payload livre (motivo, valores antes/depois, etc) */
  detalhes: text("detalhesAudit"),
  /** IP de origem da request (X-Forwarded-For ou socket) */
  ip: varchar("ipAudit", { length: 64 }),
  createdAt: timestamp("createdAtAudit").defaultNow().notNull(),
}, (t) => ({
  idxActor: index("idx_audit_actor").on(t.actorUserId),
  idxAcao: index("idx_audit_acao").on(t.acao),
  idxCreated: index("idx_audit_created").on(t.createdAt),
}));

export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;

/**
 * Overrides de planos — permite o admin alterar preço/features dos
 * planos definidos em `server/billing/products.ts` SEM precisar de
 * deploy. Linha em planos_overrides "vence" o hardcoded.
 *
 * Cada linha referencia um planId (que precisa existir em PLANS).
 * Campos null = mantém valor do hardcoded. Campos não-null sobrescrevem.
 */
export const planosOverrides = mysqlTable("planos_overrides", {
  id: int("id").autoincrement().primaryKey(),
  /** ID do plano em PLANS (ex: "iniciante", "profissional", "escritorio") */
  planId: varchar("planIdOverride", { length: 64 }).notNull().unique(),
  /** Override do nome (null = usa o de PLANS) */
  name: varchar("nameOverride", { length: 100 }),
  /** Override da descrição */
  description: varchar("descriptionOverride", { length: 500 }),
  /** Override do preço mensal em centavos */
  priceMonthly: int("priceMonthlyOverride"),
  /** Override do preço anual em centavos */
  priceYearly: int("priceYearlyOverride"),
  /** Features (array JSON) — null = usa as de PLANS */
  features: text("featuresOverride"),
  /** Marca como popular (badge "Mais Popular") */
  popular: boolean("popularOverride"),
  /** Plano oculto da página /plans (mas continua válido pra subscriptions existentes) */
  oculto: boolean("ocultoOverride").default(false),
  updatedBy: int("updatedByOverride"),
  updatedAt: timestamp("updatedAtOverride").defaultNow().onUpdateNow().notNull(),
});

export type PlanoOverride = typeof planosOverrides.$inferSelect;
export type InsertPlanoOverride = typeof planosOverrides.$inferInsert;

/**
 * Cupons de desconto — admin cria, cliente aplica no checkout.
 *
 * Aplicado via Asaas como discount na primeira cobrança da assinatura
 * OU como percentual recorrente. Validade controlada pela data e pelo
 * limite de usos.
 */
export const cupons = mysqlTable("cupons", {
  id: int("id").autoincrement().primaryKey(),
  /** Código que o cliente digita (case-insensitive) */
  codigo: varchar("codigoCupom", { length: 64 }).notNull().unique(),
  /** Descrição interna pro admin */
  descricao: varchar("descricaoCupom", { length: 255 }),
  /** Tipo de desconto */
  tipo: mysqlEnum("tipoCupom", ["percentual", "valorFixo"]).notNull(),
  /** Valor do desconto (% se percentual, centavos se valorFixo) */
  valor: int("valorCupom").notNull(),
  /** Data inicial de validade (pode ser passada → válido desde já) */
  validoDe: timestamp("validoDeCupom"),
  /** Data final de validade (null = sem expiração) */
  validoAte: timestamp("validoAteCupom"),
  /** Limite total de usos (null = ilimitado) */
  maxUsos: int("maxUsosCupom"),
  /** Contador de usos (incrementado no resgate) */
  usos: int("usosCupom").default(0).notNull(),
  /** Cupom ativo? Admin pode desativar sem deletar pra preservar histórico */
  ativo: boolean("ativoCupom").default(true).notNull(),
  /** Restringe a planos específicos (CSV de planIds, null = todos) */
  planosIds: varchar("planosIdsCupom", { length: 500 }),
  criadoPor: int("criadoPorCupom"),
  createdAt: timestamp("createdAtCupom").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtCupom").defaultNow().onUpdateNow().notNull(),
});

export type Cupom = typeof cupons.$inferSelect;
export type InsertCupom = typeof cupons.$inferInsert;

/**
 * Agentes de IA globais (admin-level) — criados pelo dono do Jurify
 * pra serem usados por todos os módulos (atendimento, futuros).
 *
 * Diferente de `agentes_ia` (tabela por escritório), estes agentes são
 * da plataforma inteira. Cada agente tem:
 *   - Prompt e modelo (GPT-4o, etc)
 *   - Ativo/inativo
 *   - Área de conhecimento (ex: "Direito Trabalhista", "FAQ Jurify")
 *   - Documentos de treinamento (via tabela agente_documentos)
 *
 * A API key do OpenAI é puxada da integração `openai` em admin_integracoes
 * (singleton), então não precisa ser armazenada no agente.
 */
export const agentesAdmin = mysqlTable("agentes_admin", {
  id: int("id").autoincrement().primaryKey(),
  nome: varchar("nomeAgenteAdmin", { length: 128 }).notNull(),
  descricao: varchar("descricaoAgenteAdmin", { length: 512 }),
  areaConhecimento: varchar("areaConhecimentoAgente", { length: 128 }),
  modelo: varchar("modeloAgente", { length: 64 }).notNull().default("gpt-4o-mini"),
  /** Prompt de sistema — define a "personalidade" e instruções do agente */
  prompt: text("promptAgente").notNull(),
  /** Temperatura do modelo (0.0 a 2.0) */
  temperatura: varchar("temperaturaAgente", { length: 10 }).notNull().default("0.70"),
  /** Máximo de tokens na resposta */
  maxTokens: int("maxTokensAgente").notNull().default(800),
  /** Ativo — pode ser referenciado por outros módulos */
  ativo: boolean("ativoAgente").notNull().default(true),
  /** Módulos onde este agente pode ser usado (CSV: "atendimento,resumos,calculos") */
  modulosPermitidos: varchar("modulosPermitidosAgente", { length: 500 }),
  criadoPor: int("criadoPorAgente"),
  createdAt: timestamp("createdAtAgenteAdmin").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtAgenteAdmin").defaultNow().onUpdateNow().notNull(),
});

export type AgenteAdmin = typeof agentesAdmin.$inferSelect;
export type InsertAgenteAdmin = typeof agentesAdmin.$inferInsert;

/**
 * Documentos de treinamento vinculados a um agente admin.
 *
 * Pode ser:
 *   - Arquivo uploadado (PDF, DOCX, TXT, MD) — `tipo: "arquivo"`, `url` = path local
 *   - Link externo — `tipo: "link"`, `url` = URL HTTP(S)
 *   - Texto colado direto — `tipo: "texto"`, `conteudo` inline no campo
 *
 * Usado pelo pipeline de RAG/contexto quando o agente é invocado.
 * Quando a integração OpenAI Assistants API estiver ativa, estes docs
 * podem ser enviados como `file` ao Assistant.
 */
export const agenteDocumentos = mysqlTable("agente_documentos", {
  id: int("id").autoincrement().primaryKey(),
  agenteId: int("agenteIdDoc").notNull(),
  nome: varchar("nomeDoc", { length: 255 }).notNull(),
  tipo: mysqlEnum("tipoDoc", ["arquivo", "link", "texto"]).notNull(),
  /** URL: path do arquivo (/uploads/...) OU URL externa */
  url: varchar("urlDoc", { length: 1024 }),
  /** Texto colado diretamente (pra tipo="texto") */
  conteudo: text("conteudoDoc"),
  /** Tamanho em bytes (só arquivos) */
  tamanho: int("tamanhoDoc"),
  /** MIME type do arquivo */
  mimeType: varchar("mimeTypeDoc", { length: 128 }),
  createdAt: timestamp("createdAtDoc").defaultNow().notNull(),
});

export type AgenteDocumento = typeof agenteDocumentos.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// SMARTFLOW — Automações inteligentes
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cenário de automação — um fluxo completo (ex: "Atendimento + Agendamento").
 * Cada cenário tem um gatilho e uma sequência de passos.
 */
export const smartflowCenarios = mysqlTable("smartflow_cenarios", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdSF").notNull(),
  nome: varchar("nomeSF", { length: 128 }).notNull(),
  descricao: varchar("descricaoSF", { length: 512 }),
  /** Gatilho que inicia o fluxo */
  gatilho: mysqlEnum("gatilhoSF", [
    "whatsapp_mensagem",
    "mensagem_canal",
    "novo_lead",
    "agendamento_criado",
    "agendamento_cancelado",
    "agendamento_remarcado",
    "agendamento_lembrete",
    "pagamento_recebido",
    "pagamento_vencido",
    "pagamento_proximo_vencimento",
    "manual",
  ]).notNull(),
  /** Se o cenário está ativo (recebe eventos) */
  ativo: boolean("ativoSF").default(true).notNull(),
  /** Configuração geral do cenário (JSON) */
  config: text("configSF"),
  /** Configuração específica do gatilho (JSON — canais, dias de atraso, etc.) */
  configGatilho: text("configGatilhoSF"),
  criadoPor: int("criadoPorSF"),
  createdAt: timestamp("createdAtSF").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtSF").defaultNow().onUpdateNow().notNull(),
});

export type SmartflowCenario = typeof smartflowCenarios.$inferSelect;

/**
 * Passo de um cenário — cada ação no fluxo.
 */
export const smartflowPassos = mysqlTable("smartflow_passos", {
  id: int("id").autoincrement().primaryKey(),
  cenarioId: int("cenarioIdPasso").notNull(),
  ordem: int("ordemPasso").default(0).notNull(),
  /** Tipo do passo */
  tipo: mysqlEnum("tipoPasso", [
    "ia_classificar",                // IA classifica intenção da mensagem
    "ia_responder",                  // IA gera resposta contextual
    "calcom_horarios",               // busca horários disponíveis no Cal.com
    "calcom_agendar",                // cria agendamento no Cal.com
    "calcom_listar",                 // lista bookings do Cal.com (contexto)
    "calcom_cancelar",               // cancela booking no Cal.com
    "calcom_remarcar",               // reagenda booking no Cal.com
    "whatsapp_enviar",               // envia mensagem no WhatsApp
    "transferir",                    // transfere pra humano
    "condicional",                   // if/else baseado em condição
    "esperar",                       // delay (follow-up)
    "webhook",
    "kanban_criar_card",             // cria card no Kanban
    "kanban_mover_card",             // move card pra outra coluna
    "kanban_atribuir_responsavel",   // define responsável de um card
    "kanban_tags",                   // adiciona/remove/define tags do card
    "asaas_gerar_cobranca",          // cria cobrança avulsa no Asaas
    "asaas_cancelar_cobranca",       // cancela cobrança Asaas pelo ID
    "asaas_consultar_valor_aberto",  // grava resumo financeiro no contexto
    "asaas_marcar_recebida",         // confirma recebimento manual
    "definir_variavel",              // grava variável no contexto da execução
    "definir_campo_personalizado",   // persiste em contatos.camposPersonalizados
  ]).notNull(),
  /** Configuração do passo (JSON — prompt, template, condição, etc) */
  config: text("configPasso"),
  /**
   * UUID estável gerado pelo editor. Permite que edges do ReactFlow
   * referenciem passos mesmo após delete+insert do save (IDs autoincrement
   * mudam, `clienteId` não). Null em cenários legados lineares.
   */
  clienteId: varchar("clienteIdPasso", { length: 36 }),
  /**
   * Mapa de saída por ramo (JSON). Chaves: "default" ou `cond_<id>` ou
   * "fallback". Valores: `id` do passo alvo. Se null, o engine segue pro
   * próximo passo por `ordem` (comportamento linear legado).
   */
  proximoSe: text("proximoSePasso"),
  createdAt: timestamp("createdAtPasso").defaultNow().notNull(),
});

export type SmartflowPasso = typeof smartflowPassos.$inferSelect;

/**
 * Execução de um cenário — log de cada vez que o fluxo rodou.
 */
export const smartflowExecucoes = mysqlTable("smartflow_execucoes", {
  id: int("id").autoincrement().primaryKey(),
  cenarioId: int("cenarioIdExec").notNull(),
  escritorioId: int("escritorioIdExec").notNull(),
  /** ID da conversa/contato que iniciou o fluxo */
  contatoId: int("contatoIdExec"),
  conversaId: int("conversaIdExec"),
  /** Status da execução */
  status: mysqlEnum("statusExec", ["rodando", "concluido", "erro", "cancelado"]).default("rodando").notNull(),
  /** Passo atual (se rodando) */
  passoAtual: int("passoAtualExec").default(0).notNull(),
  /** Contexto da execução — dados coletados ao longo dos passos (JSON) */
  contexto: text("contextoExec"),
  /** Mensagem de erro (se status=erro) */
  erro: varchar("erroExec", { length: 512 }),
  /**
   * Quando a execução está em passo "esperar", este timestamp indica
   * quando o scheduler deve retomar do próximo passo. Null = não está
   * aguardando delay.
   */
  retomarEm: timestamp("retomarEmExec"),
  createdAt: timestamp("createdAtExec").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtExec").defaultNow().onUpdateNow().notNull(),
});

export type SmartflowExecucao = typeof smartflowExecucoes.$inferSelect;
export type InsertAgenteDocumento = typeof agenteDocumentos.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// KANBAN — Gestão visual de processos em produção
// ═══════════════════════════════════════════════════════════════════════════════

/** Funil (board) — um quadro kanban completo */
export const kanbanFunis = mysqlTable("kanban_funis", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdKF").notNull(),
  nome: varchar("nomeKF", { length: 128 }).notNull(),
  descricao: varchar("descricaoKF", { length: 512 }),
  cor: varchar("corKF", { length: 16 }),
  /** Prazo padrão em dias para cards novos (default 15) */
  prazoPadraoDias: int("prazoPadraoDiasKF").default(15).notNull(),
  criadoPor: int("criadoPorKF"),
  createdAt: timestamp("createdAtKF").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtKF").defaultNow().onUpdateNow().notNull(),
});

/** Coluna de um funil */
export const kanbanColunas = mysqlTable("kanban_colunas", {
  id: int("id").autoincrement().primaryKey(),
  funilId: int("funilIdKC").notNull(),
  nome: varchar("nomeKC", { length: 64 }).notNull(),
  cor: varchar("corKC", { length: 16 }),
  ordem: int("ordemKC").default(0).notNull(),
  createdAt: timestamp("createdAtKC").defaultNow().notNull(),
});

/** Card (processo/caso) dentro de uma coluna */
export const kanbanCards = mysqlTable("kanban_cards", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdKCard").notNull(),
  colunaId: int("colunaIdKCard").notNull(),
  titulo: varchar("tituloKCard", { length: 255 }).notNull(),
  descricao: text("descricaoKCard"),
  cnj: varchar("cnjKCard", { length: 30 }),
  clienteId: int("clienteIdKCard"),
  responsavelId: int("responsavelIdKCard"),
  prioridade: mysqlEnum("prioridadeKCard", ["alta", "media", "baixa"]).default("media").notNull(),
  prazo: timestamp("prazoKCard"),
  tags: varchar("tagsKCard", { length: 255 }),
  /** ID do pagamento Asaas que originou o card (evita duplicata) */
  asaasPaymentId: varchar("asaasPaymentIdKCard", { length: 64 }),
  /**
   * ID da ação (cliente_processos.id) que esse card representa.
   *
   * Quando o SmartFlow cria card com `processoId` no contexto (multi-ação),
   * o passo `kanban_criar_card` busca card existente por
   * `(escritorioId, processoId, clienteId)` em vez de `asaasPaymentId`.
   * Resultado: 1 card por (cliente, ação) — não duplica em parcelamento
   * nem em pacote de ações compartilhando paymentId.
   *
   * NULL = card legado (criado por SmartFlow antigo ou via UI direto).
   */
  processoId: int("processoIdKCard"),
  /** Se o card está atrasado (prazo vencido sem mover) */
  atrasado: boolean("atrasadoKCard").default(false).notNull(),
  ordem: int("ordemKCard").default(0).notNull(),
  createdAt: timestamp("createdAtKCard").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtKCard").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  // Acelera lookup "card existente pra (escritorio, processo, cliente)"
  // — usado pela idempotência do passo `kanban_criar_card` no SmartFlow.
  idxProcessoCliente: index("kanban_cards_proc_cli_idx").on(
    t.escritorioId, t.processoId, t.clienteId,
  ),
}));

/** Log de movimentações de cards entre colunas — pra medir tempo por etapa */
export const kanbanMovimentacoes = mysqlTable("kanban_movimentacoes", {
  id: int("id").autoincrement().primaryKey(),
  cardId: int("cardIdKMov").notNull(),
  colunaOrigemId: int("colunaOrigemIdKMov").notNull(),
  colunaDestinoId: int("colunaDestinoIdKMov").notNull(),
  movidoPorId: int("movidoPorIdKMov"),
  createdAt: timestamp("createdAtKMov").defaultNow().notNull(),
});

/** Tags padronizadas do escritório com cores */
export const kanbanTags = mysqlTable("kanban_tags", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdKTag").notNull(),
  nome: varchar("nomeKTag", { length: 32 }).notNull(),
  cor: varchar("corKTag", { length: 16 }).notNull(),
  createdAt: timestamp("createdAtKTag").defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPOS PERSONALIZADOS DE CLIENTE
// Cada escritório define campos extras pra capturar no cadastro do cliente
// (ex: "Número OAB", "Data audiência", "Tipo de processo"). Os valores ficam
// em `contatos.camposPersonalizados` (JSON) e o catálogo de definições aqui.
// Disponíveis no SmartFlow como `{{cliente.campos.<chave>}}`.
// ═══════════════════════════════════════════════════════════════════════════════

export const camposPersonalizadosCliente = mysqlTable("campos_personalizados_cliente", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdCpc").notNull(),
  /** Chave usada nas variáveis ({{cliente.campos.<chave>}}). camelCase,
   *  sem espaços. Único por escritório. */
  chave: varchar("chaveCpc", { length: 48 }).notNull(),
  /** Label exibido no formulário do cliente. Ex: "Número OAB". */
  label: varchar("labelCpc", { length: 64 }).notNull(),
  /** Tipo do campo: texto / numero / data / textarea / select / boolean. */
  tipo: mysqlEnum("tipoCpc", ["texto", "numero", "data", "textarea", "select", "boolean"]).default("texto").notNull(),
  /** Pra tipo=select: opções como JSON array de strings. Nulo nos outros tipos. */
  opcoes: text("opcoesCpc"),
  /** Texto auxiliar exibido como hint abaixo do campo. */
  ajuda: varchar("ajudaCpc", { length: 200 }),
  obrigatorio: boolean("obrigatorioCpc").default(false).notNull(),
  /** Quando true (default), aparece no formulário de cadastro do cliente.
   *  Quando false, o campo existe só pra automações (SmartFlow lê via
   *  `{{cliente.campos.<chave>}}` mas operadora não o vê no cadastro). */
  mostrarCadastro: boolean("mostrarCadastroCpc").default(true).notNull(),
  /** Ordem de exibição no formulário (ascendente). */
  ordem: int("ordemCpc").default(0).notNull(),
  createdAt: timestamp("createdAtCpc").defaultNow().notNull(),
});

export type CampoPersonalizadoCliente = typeof camposPersonalizadosCliente.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// TETOS LEGAIS COM TIMELINE
// Armazena limites de taxa de juros que mudam ao longo do tempo via
// resolução/portaria. O engine de cálculos busca o teto vigente na data
// do contrato — evita aplicar norma nova retroativamente.
// ═══════════════════════════════════════════════════════════════════════════════

export const tetosLegais = mysqlTable("tetos_legais", {
  id: int("id").autoincrement().primaryKey(),
  /** Categoria do teto (identifica a combinação modalidade+vínculo):
   *  'cheque_especial', 'consignado_inss', 'consignado_servidor',
   *  'cartao_credito_100pct', etc. */
  categoria: varchar("categoriaTetoLeg", { length: 64 }).notNull(),
  /** Taxa mensal máxima permitida (% a.m.) Ex: 1.8500 */
  tetoMensal: varchar("tetoMensalLeg", { length: 20 }).notNull(),
  /** Fundamentação legal completa (norma, número, ano) */
  fundamento: varchar("fundamentoLeg", { length: 512 }).notNull(),
  /** Data de início da vigência (YYYY-MM-DD) */
  vigenciaDe: varchar("vigenciaDeLeg", { length: 10 }).notNull(),
  /** Data de fim da vigência (YYYY-MM-DD). NULL = vigente até hoje */
  vigenciaAte: varchar("vigenciaAteLeg", { length: 10 }),
  /** Observação adicional (ex: "Aplica-se a PF e MEI") */
  observacao: text("observacaoLeg"),
  createdAt: timestamp("createdAtTetoLeg").defaultNow().notNull(),
});

export type TetoLegal = typeof tetosLegais.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCEIRO PLUS — CATEGORIAS, COMISSÕES E DESPESAS
// Habilita: comissão flat para atendentes (com filtros multicamada), categorização
// de cobranças/despesas, contas a pagar e snapshot imutável de fechamentos.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Categorias de cobrança do escritório (ex: "Honorário inicial", "Mensalidade").
 * Cada categoria define se cobranças daquele tipo entram no cálculo de comissão
 * por padrão. Pode ser sobrescrito por cobrança via `asaas_cobrancas.comissionavelOverride`.
 */
export const categoriasCobranca = mysqlTable(
  "categorias_cobranca",
  {
    id: int("id").autoincrement().primaryKey(),
    escritorioId: int("escritorioIdCatCob").notNull(),
    nome: varchar("nomeCatCob", { length: 80 }).notNull(),
    comissionavel: boolean("comissionavelCatCob").default(true).notNull(),
    ativo: boolean("ativoCatCob").default(true).notNull(),
    createdAt: timestamp("createdAtCatCob").defaultNow().notNull(),
  },
  (t) => ({
    uqEscritorioNome: uniqueIndex("cat_cob_escr_nome_uq").on(
      t.escritorioId,
      t.nome,
    ),
  }),
);

export type CategoriaCobranca = typeof categoriasCobranca.$inferSelect;
export type InsertCategoriaCobranca = typeof categoriasCobranca.$inferInsert;

/** Categorias de despesa do escritório (ex: "Aluguel", "Salários"). */
export const categoriasDespesa = mysqlTable(
  "categorias_despesa",
  {
    id: int("id").autoincrement().primaryKey(),
    escritorioId: int("escritorioIdCatDesp").notNull(),
    nome: varchar("nomeCatDesp", { length: 80 }).notNull(),
    ativo: boolean("ativoCatDesp").default(true).notNull(),
    createdAt: timestamp("createdAtCatDesp").defaultNow().notNull(),
  },
  (t) => ({
    uqEscritorioNome: uniqueIndex("cat_desp_escr_nome_uq").on(
      t.escritorioId,
      t.nome,
    ),
  }),
);

export type CategoriaDespesa = typeof categoriasDespesa.$inferSelect;
export type InsertCategoriaDespesa = typeof categoriasDespesa.$inferInsert;

/** Contas a pagar do escritório (despesas operacionais). */
export const despesas = mysqlTable(
  "despesas",
  {
    id: int("id").autoincrement().primaryKey(),
    escritorioId: int("escritorioIdDesp").notNull(),
    categoriaId: int("categoriaIdDesp"),
    descricao: varchar("descricaoDesp", { length: 200 }).notNull(),
    /** Valor total da despesa em formato decimal "1234.56". */
    valor: decimal("valorDesp", { precision: 12, scale: 2 }).notNull(),
    /** Soma de pagamentos parciais já registrados. Quando bate ou supera
     *  `valor`, status vai pra "pago". Default 0. */
    valorPago: decimal("valorPagoDesp", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    /** Data de vencimento (YYYY-MM-DD). */
    vencimento: varchar("vencimentoDesp", { length: 10 }).notNull(),
    /** Data do último pagamento que quitou totalmente (YYYY-MM-DD); NULL
     *  enquanto não totalmente pago. Pagamentos parciais não preenchem. */
    dataPagamento: varchar("dataPagamentoDesp", { length: 10 }),
    status: mysqlEnum("statusDesp", [
      "pendente",
      "parcial",
      "pago",
      "vencido",
    ])
      .default("pendente")
      .notNull(),
    recorrencia: mysqlEnum("recorrenciaDesp", ["nenhuma", "semanal", "mensal", "anual"])
      .default("nenhuma")
      .notNull(),
    observacoes: text("observacoesDesp"),
    criadoPorUserId: int("criadoPorUserIdDesp").notNull(),
    createdAt: timestamp("createdAtDesp").defaultNow().notNull(),
    updatedAt: timestamp("updatedAtDesp").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    idxEscritorioVencimento: index("desp_escr_venc_idx").on(
      t.escritorioId,
      t.vencimento,
    ),
    idxEscritorioStatus: index("desp_escr_status_idx").on(
      t.escritorioId,
      t.status,
    ),
  }),
);

export type Despesa = typeof despesas.$inferSelect;
export type InsertDespesa = typeof despesas.$inferInsert;

/**
 * Regra global de comissão por escritório (singleton).
 *
 * Suporta dois modos:
 * - "flat": usa `aliquotaPercent` como alíquota única (modelo original).
 * - "faixas": usa as linhas em `regra_comissao_faixas` como tabela cumulativa —
 *   a faixa cujo `limiteAte` cobre o total recebido define a alíquota aplicada
 *   sobre toda a base.
 *
 * `baseFaixa` define o que classifica a faixa quando modo='faixas':
 * - "bruto": tudo que o atendente recebeu no período.
 * - "comissionavel": apenas o que sobra após filtros de categoria/mínimo/override.
 *
 * Cobranças abaixo de `valorMinimoCobranca` ficam fora do cálculo nos dois modos.
 */
export const regraComissao = mysqlTable(
  "regra_comissao",
  {
    id: int("id").autoincrement().primaryKey(),
    escritorioId: int("escritorioIdRegraCom").notNull(),
    aliquotaPercent: decimal("aliquotaPercentRegraCom", { precision: 5, scale: 2 })
      .default("0")
      .notNull(),
    modo: mysqlEnum("modoRegraCom", ["flat", "faixas"]).default("flat").notNull(),
    baseFaixa: mysqlEnum("baseFaixaRegraCom", ["bruto", "comissionavel"])
      .default("comissionavel")
      .notNull(),
    valorMinimoCobranca: decimal("valorMinimoCobRegraCom", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),
    updatedAt: timestamp("updatedAtRegraCom").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    uqEscritorio: uniqueIndex("regra_com_escritorio_uq").on(t.escritorioId),
  }),
);

export type RegraComissao = typeof regraComissao.$inferSelect;
export type InsertRegraComissao = typeof regraComissao.$inferInsert;

/**
 * Faixas progressivas da regra de comissão (singleton por escritório → N faixas).
 *
 * Convenção: as faixas são lidas em ordem crescente de `ordem`. A faixa "encaixa"
 * o total da base (recebido bruto ou comissionável) se este for ≤ `limiteAte`.
 * A última faixa pode ter `limiteAte = NULL` para representar "sem teto".
 */
export const regraComissaoFaixas = mysqlTable(
  "regra_comissao_faixas",
  {
    id: int("id").autoincrement().primaryKey(),
    escritorioId: int("escritorioIdFaixa").notNull(),
    ordem: int("ordemFaixa").notNull(),
    /** Cota superior da faixa (inclusiva). NULL = sem teto (última faixa). */
    limiteAte: decimal("limiteAteFaixa", { precision: 14, scale: 2 }),
    aliquotaPercent: decimal("aliquotaPercentFaixa", { precision: 5, scale: 2 })
      .notNull(),
    createdAt: timestamp("createdAtFaixa").defaultNow().notNull(),
  },
  (t) => ({
    idxEscritorioOrdem: index("faixa_escr_ordem_idx").on(t.escritorioId, t.ordem),
  }),
);

export type RegraComissaoFaixa = typeof regraComissaoFaixas.$inferSelect;
export type InsertRegraComissaoFaixa = typeof regraComissaoFaixas.$inferInsert;

/**
 * Snapshot imutável de fechamento de comissão.
 * Após "fechar período", os valores ficam congelados aqui — mudanças posteriores
 * em alíquota, categorias ou cobranças não afetam fechamentos passados.
 */
export const comissoesFechadas = mysqlTable(
  "comissoes_fechadas",
  {
    id: int("id").autoincrement().primaryKey(),
    escritorioId: int("escritorioIdComFech").notNull(),
    atendenteId: int("atendenteIdComFech").notNull(),
    /** Início do período (YYYY-MM-DD), inclusive. */
    periodoInicio: varchar("periodoInicioComFech", { length: 10 }).notNull(),
    /** Fim do período (YYYY-MM-DD), inclusive. */
    periodoFim: varchar("periodoFimComFech", { length: 10 }).notNull(),
    totalBrutoRecebido: decimal("totalBrutoRecebidoComFech", { precision: 14, scale: 2 })
      .notNull(),
    totalComissionavel: decimal("totalComissionavelComFech", { precision: 14, scale: 2 })
      .notNull(),
    totalNaoComissionavel: decimal("totalNaoComissionavelComFech", { precision: 14, scale: 2 })
      .notNull(),
    totalComissao: decimal("totalComissaoComFech", { precision: 14, scale: 2 }).notNull(),
    aliquotaUsada: decimal("aliquotaUsadaComFech", { precision: 5, scale: 2 }).notNull(),
    /** Modo da regra no momento do fechamento. Em "faixas", a `aliquotaUsada` reflete a faixa cumulativa atingida. */
    modoUsado: mysqlEnum("modoUsadoComFech", ["flat", "faixas"]).default("flat").notNull(),
    /** Base que classificou a faixa quando modoUsado='faixas'. NULL para "flat". */
    baseFaixaUsada: mysqlEnum("baseFaixaUsadaComFech", ["bruto", "comissionavel"]),
    /** JSON com a tabela de faixas vigente no momento do fechamento (apenas no modo "faixas"). */
    faixasUsadas: text("faixasUsadasComFech"),
    valorMinimoUsado: decimal("valorMinimoUsadoComFech", { precision: 12, scale: 2 })
      .notNull(),
    fechadoEm: timestamp("fechadoEmComFech").defaultNow().notNull(),
    fechadoPorUserId: int("fechadoPorUserIdComFech").notNull(),
    observacoes: text("observacoesComFech"),
    /** Origem do fechamento — 'manual' (botão "Fechar período") ou
     *  'automatico' (cron por agenda configurada em
     *  `comissoes_agenda`). Permite filtrar/auditar lançamentos
     *  automáticos no histórico. */
    origem: mysqlEnum("origemComFech", ["manual", "automatico"]).default("manual").notNull(),
    /** FK opcional pra `comissoes_agenda` quando origem='automatico'. */
    agendaId: int("agendaIdComFech"),
    /** FK opcional pra `despesas` — preenchida quando `fecharComissao`
     *  cria despesa pendente automática. Permite cascata na exclusão
     *  do fechamento. */
    despesaId: int("despesaIdComFech"),
  },
  (t) => ({
    idxEscritorioAtendente: index("com_fech_escr_atendente_idx").on(
      t.escritorioId,
      t.atendenteId,
    ),
  }),
);

export type ComissaoFechada = typeof comissoesFechadas.$inferSelect;
export type InsertComissaoFechada = typeof comissoesFechadas.$inferInsert;

/**
 * Itens (cobranças) que entraram no snapshot de comissão fechada.
 * `motivoExclusao` é NULL para itens comissionáveis e preenchido para os que
 * apareceram no relatório como "não comissionáveis":
 * 'categoria_nao_comissionavel' | 'abaixo_minimo' | 'override_manual'
 */
export const comissoesFechadasItens = mysqlTable("comissoes_fechadas_itens", {
  id: int("id").autoincrement().primaryKey(),
  comissaoFechadaId: int("comissaoFechadaIdItem").notNull(),
  asaasCobrancaId: int("asaasCobrancaIdItem").notNull(),
  valor: decimal("valorItem", { precision: 12, scale: 2 }).notNull(),
  foiComissionavel: boolean("foiComissionavelItem").notNull(),
  motivoExclusao: varchar("motivoExclusaoItem", { length: 32 }),
});

export type ComissaoFechadaItem = typeof comissoesFechadasItens.$inferSelect;
export type InsertComissaoFechadaItem = typeof comissoesFechadasItens.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// AGENDA E LOG DE LANÇAMENTOS AUTOMÁTICOS DE COMISSÃO
// Cada escritório configura quando o sistema deve fechar comissões
// automaticamente (dia do mês + hora local). O cron worker varre a tabela
// a cada 15 min e dispara fechamentos pendentes. O log abaixo serve pra
// idempotência: chave única (escritorio, periodo, atendente) impede que
// uma execução duplicada (deploy concorrente, restart) feche o mesmo
// período 2x.
// ═══════════════════════════════════════════════════════════════════════════════

export const comissoesAgenda = mysqlTable(
  "comissoes_agenda",
  {
    id: int("id").autoincrement().primaryKey(),
    escritorioId: int("escritorioIdComAg").notNull(),
    /** Liga/desliga o lançamento automático sem perder a config. */
    ativo: boolean("ativoComAg").default(true).notNull(),
    /** Dia do mês em que dispara (1-31). Se o mês não tem o dia
     *  configurado (ex: 31 em fevereiro), roda no último dia do mês. */
    diaDoMes: int("diaDoMesComAg").notNull(),
    /** Hora local (no fuso do escritório) no formato "HH:MM". */
    horaLocal: varchar("horaLocalComAg", { length: 5 }).notNull(),
    /** Escopo do período fechado. MVP: 'mes_anterior' (fecha mês cheio
     *  passado quando dispara). Futuro: 'mes_corrente_ate_ontem'. */
    escopoPeriodo: mysqlEnum("escopoPeriodoComAg", ["mes_anterior"]).default("mes_anterior").notNull(),
    criadoPorUserId: int("criadoPorUserIdComAg").notNull(),
    criadoEm: timestamp("criadoEmComAg").defaultNow().notNull(),
    atualizadoEm: timestamp("atualizadoEmComAg").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    // Por enquanto 1 agenda por escritório — simplifica o caso comum.
    // Se virar caso de uso, basta soltar a constraint.
    uqEscritorio: uniqueIndex("comissoes_agenda_escritorio_uq").on(t.escritorioId),
  }),
);

export type ComissaoAgenda = typeof comissoesAgenda.$inferSelect;

export const comissoesLancamentosLog = mysqlTable(
  "comissoes_lancamentos_log",
  {
    id: int("id").autoincrement().primaryKey(),
    escritorioId: int("escritorioIdComLog").notNull(),
    agendaId: int("agendaIdComLog").notNull(),
    atendenteId: int("atendenteIdComLog").notNull(),
    periodoInicio: varchar("periodoInicioComLog", { length: 10 }).notNull(),
    periodoFim: varchar("periodoFimComLog", { length: 10 }).notNull(),
    /** 'em_andamento' protege contra deploy concorrente; 'concluido'
     *  é o estado feliz; 'falhou' grava `mensagemErro` e permite retry
     *  manual. */
    status: mysqlEnum("statusComLog", ["em_andamento", "concluido", "falhou"]).notNull(),
    /** ID do `comissoes_fechadas` quando concluiu com sucesso. */
    comissaoFechadaId: int("comissaoFechadaIdComLog"),
    mensagemErro: text("mensagemErroComLog"),
    iniciadoEm: timestamp("iniciadoEmComLog").defaultNow().notNull(),
    finalizadoEm: timestamp("finalizadoEmComLog"),
  },
  (t) => ({
    // Idempotência: mesmo período + atendente + agenda só pode ter 1
    // entrada. Race entre 2 workers ⇒ INSERT segundo falha
    // (ER_DUP_ENTRY) e o segundo worker pula.
    uqExecucao: uniqueIndex("comissoes_log_execucao_uq").on(
      t.escritorioId,
      t.agendaId,
      t.atendenteId,
      t.periodoInicio,
      t.periodoFim,
    ),
    idxEscritorio: index("comissoes_log_escritorio_idx").on(
      t.escritorioId,
      t.iniciadoEm,
    ),
  }),
);

export type ComissaoLancamentoLog = typeof comissoesLancamentosLog.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// ROADMAP — Sugestões de melhoria com votação dos clientes
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Item de roadmap — uma sugestão/ideia/bug reportado por um cliente.
 * Visível pra todos os usuários logados (multi-escritório). Admin (role=admin)
 * troca o status. `contagemVotos` é denormalizado pra ordenação rápida — é
 * mantido pelo router de voto (não usa MySQL trigger).
 */
export const roadmapItens = mysqlTable("roadmap_itens", {
  id: int("id").autoincrement().primaryKey(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: text("descricao").notNull(),
  categoria: mysqlEnum("categoriaRoadmap", ["feature", "bug", "melhoria"]).default("melhoria").notNull(),
  status: mysqlEnum("statusRoadmap", [
    "aguardando_aprovacao",
    "novo",
    "em_analise",
    "planejado",
    "em_desenvolvimento",
    "lancado",
    "recusado",
  ]).default("aguardando_aprovacao").notNull(),
  criadoPor: int("criadoPor").notNull(),
  contagemVotos: int("contagemVotos").default(0).notNull(),
  createdAt: timestamp("createdAtRoadmap").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtRoadmap").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  roadmapStatusIdx: index("roadmap_itens_status_idx").on(t.status),
  roadmapVotosIdx: index("roadmap_itens_votos_idx").on(t.contagemVotos),
}));

export type RoadmapItem = typeof roadmapItens.$inferSelect;
export type InsertRoadmapItem = typeof roadmapItens.$inferInsert;

/**
 * Voto de um usuário num item de roadmap.
 * Constraint UNIQUE(itemId, userId) garante "1 voto por user por item".
 */
export const roadmapVotos = mysqlTable("roadmap_votos", {
  id: int("id").autoincrement().primaryKey(),
  itemId: int("itemId").notNull(),
  userId: int("userId").notNull(),
  createdAt: timestamp("createdAtVoto").defaultNow().notNull(),
}, (t) => ({
  roadmapVotosUnique: uniqueIndex("roadmap_votos_item_user_unique").on(t.itemId, t.userId),
}));

export type RoadmapVoto = typeof roadmapVotos.$inferSelect;
export type InsertRoadmapVoto = typeof roadmapVotos.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// PASSWORD RESET — Tokens pra "Esqueci minha senha"
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tokens de reset de senha. Cada solicitação cria UUID + expiração 1h.
 * Quando o user clica no link e troca a senha, marcamos `usadoEm` — o
 * mesmo token não roda 2x. Solicitações novas pro mesmo user invalidam
 * tokens anteriores ainda não usados.
 */
export const passwordResetTokens = mysqlTable("password_reset_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  expiraEm: timestamp("expiraEm").notNull(),
  usadoEm: timestamp("usadoEm"),
  createdAt: timestamp("createdAtTok").defaultNow().notNull(),
}, (t) => ({
  prtUserIdx: index("prt_user_idx").on(t.userId),
  prtExpiraIdx: index("prt_expira_idx").on(t.expiraEm),
}));

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// MODELOS DE CONTRATO — Templates DOCX com placeholders numerados ({{1}}, {{2}})
// que podem mapear pra variáveis (cliente.*, escritorio.*, data.*) ou pra
// preenchimento manual na hora de gerar. Inspirado nos templates do WhatsApp.
// ═══════════════════════════════════════════════════════════════════════════════

export const modelosContrato = mysqlTable("modelos_contrato", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioIdModCt").notNull(),
  nome: varchar("nomeModCt", { length: 150 }).notNull(),
  descricao: varchar("descricaoModCt", { length: 500 }),
  /** Path interno do DOCX (`/uploads/modelos-contrato/escritorio_<id>/<file>`). */
  arquivoUrl: varchar("arquivoUrlModCt", { length: 512 }).notNull(),
  /** Nome original do arquivo (preservado pra exibir + download). */
  arquivoNome: varchar("arquivoNomeModCt", { length: 255 }).notNull(),
  tamanho: int("tamanhoModCt"),
  /**
   * JSON com array de placeholders configurados:
   *  - `{numero, tipo:"variavel", variavel:"cliente.nome"}` — resolve
   *    automático no contexto do contato/escritório/data
   *  - `{numero, tipo:"manual", label:"Valor da causa", dica?:string}` —
   *    operador preenche no modal "Gerar contrato"
   */
  placeholders: text("placeholdersModCt").notNull(),
  /**
   * Pasta hierárquica (separador `/`), ex: "Contratos/Honorários".
   * NULL = raiz. MVP sem tabela `pastas` separada — pastas existem
   * implicitamente porque têm modelos dentro.
   */
  pasta: varchar("pasta", { length: 255 }),
  /**
   * Flag que marca o modelo como "contrato para assinatura digital".
   * Quando true, aparece no GerarContratoDialog (detalhe do cliente).
   * Quando false, fica oculto desse fluxo (petições, pareceres,
   * procurações que não exigem assinatura digital). Admin marca
   * manualmente.
   */
  ehParaAssinatura: boolean("ehParaAssinatura").notNull().default(false),
  criadoPorUserId: int("criadoPorUserIdModCt").notNull(),
  createdAt: timestamp("createdAtModCt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtModCt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  modCtEscIdx: index("modct_esc_idx").on(t.escritorioId),
  modCtPastaIdx: index("idx_modct_pasta").on(t.pasta),
  modCtEhParaAssinaturaIdx: index("idx_modct_eh_para_assinatura").on(
    t.escritorioId,
    t.ehParaAssinatura,
  ),
}));

export type ModeloContrato = typeof modelosContrato.$inferSelect;
export type InsertModeloContrato = typeof modelosContrato.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DE COMISSÃO POR PARCELAMENTO/ASSINATURA
// Quando criamos parcelamento ou assinatura no Asaas, persistimos a config
// de comissão (atendente, categoria, override) keyed pelo ID retornado.
// O webhook handler lê na criação de cada cobrança filha e aplica.
// ═══════════════════════════════════════════════════════════════════════════════

export const asaasConfigCobrancaPai = mysqlTable(
  "asaas_config_cobranca_pai",
  {
    id: int("id").autoincrement().primaryKey(),
    escritorioId: int("escritorioIdAcCp").notNull(),
    tipo: mysqlEnum("tipoAcCp", ["parcelamento", "assinatura"]).notNull(),
    /** ID retornado pelo Asaas — `installment.id` ou `subscription.id`. */
    asaasParentId: varchar("asaasParentIdAcCp", { length: 64 }).notNull(),
    atendenteId: int("atendenteIdAcCp"),
    categoriaId: int("categoriaIdAcCp"),
    comissionavelOverride: boolean("comissionavelOverrideAcCp"),
    createdAt: timestamp("createdAtAcCp").defaultNow().notNull(),
  },
  (t) => ({
    uqEscritorioParent: uniqueIndex("ac_cp_esc_parent_uq").on(
      t.escritorioId,
      t.asaasParentId,
    ),
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// MOTOR PRÓPRIO DE MONITORAMENTO JURÍDICO — base do Spike
// ═══════════════════════════════════════════════════════════════════════════════
// Tabelas isoladas, criadas pela migration 0050_motor_proprio_base.sql.
// Coexistem com judit_* durante a validação técnica. Após paridade ≥95%
// comprovada em staging, judit_* será renomeado para processos_* no
// Sprint 1 oficial. Por ora, motor próprio escreve em eventos_processo
// e Judit continua escrevendo em judit_respostas — ambos lidos pelo
// frontend via mesmo router tRPC quando feature flag estiver ligada.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cofre de Credenciais — armazena CPF/OAB + senha + 2FA TOTP do advogado
 * de forma criptografada (AES-256-GCM via server/escritorio/crypto-utils.ts).
 *
 * Usado pelo motor próprio para acessar sistemas autenticados (E-SAJ TJSP,
 * PJe restrito, Eproc) e capturar processos em segredo de justiça ou que
 * exigem login.
 *
 * SEGURANÇA: senha e TOTP secret nunca trafegam em claro depois do POST
 * inicial. Backend nunca retorna esses campos em API responses — só
 * `usernameMascarado` via `maskToken()`.
 */
export const cofreCredenciais = mysqlTable("cofre_credenciais", {
  id: int("id").autoincrement().primaryKey(),
  escritorioId: int("escritorioId").notNull(),
  /** Sistema de tribunal — ver `SistemaCofre` em shared/cofre-credenciais-types.ts */
  sistema: varchar("sistema", { length: 64 }).notNull(),
  /** Label amigável definida pelo admin */
  apelido: varchar("apelido", { length: 100 }).notNull(),
  /** Username (CPF ou OAB) criptografado */
  usernameEnc: text("usernameEnc").notNull(),
  usernameIv: varchar("usernameIv", { length: 64 }).notNull(),
  usernameTag: varchar("usernameTag", { length: 64 }).notNull(),
  /** Senha criptografada */
  passwordEnc: text("passwordEnc").notNull(),
  passwordIv: varchar("passwordIv", { length: 64 }).notNull(),
  passwordTag: varchar("passwordTag", { length: 64 }).notNull(),
  /** TOTP secret (base32) criptografado — null quando credencial não tem 2FA */
  totpSecretEnc: text("totpSecretEnc"),
  totpSecretIv: varchar("totpSecretIv", { length: 64 }),
  totpSecretTag: varchar("totpSecretTag", { length: 64 }),
  status: mysqlEnum("statusCofre", ["validando", "ativa", "erro", "expirada", "removida"])
    .default("validando")
    .notNull(),
  ultimoLoginSucessoEm: timestamp("ultimoLoginSucessoEm"),
  ultimoLoginTentativaEm: timestamp("ultimoLoginTentativaEm"),
  ultimoErro: text("ultimoErro"),
  criadoPor: int("criadoPor").notNull(),
  createdAt: timestamp("createdAtCofre").defaultNow().notNull(),
  updatedAt: timestamp("updatedAtCofre").defaultNow().onUpdateNow().notNull(),
});

export type CofreCredencial = typeof cofreCredenciais.$inferSelect;
export type InsertCofreCredencial = typeof cofreCredenciais.$inferInsert;

/**
 * Sessões persistidas — cookies criptografados resultantes de logins
 * bem-sucedidos. Permite que o robô acesse o sistema sem fazer login
 * a cada raspagem (relogin frequente dispara captcha/lockout).
 *
 * Cada credencial pode ter múltiplas sessões ao longo do tempo —
 * a sessão mais recente válida é usada; as antigas servem de auditoria.
 */
export const cofreSessoes = mysqlTable("cofre_sessoes", {
  id: int("id").autoincrement().primaryKey(),
  credencialId: int("credencialId").notNull(),
  /** JSON do storageState do Playwright (cookies + localStorage) criptografado */
  cookiesEnc: text("cookiesEnc").notNull(),
  cookiesIv: varchar("cookiesIv", { length: 64 }).notNull(),
  cookiesTag: varchar("cookiesTag", { length: 64 }).notNull(),
  capturadoEm: timestamp("capturadoEm").defaultNow().notNull(),
  /** Estimativa baseada em TTL típico do tribunal (geralmente 24-72h) */
  expiraEmEstimado: timestamp("expiraEmEstimado"),
  ultimoUsoEm: timestamp("ultimoUsoEm"),
});

export type CofreSessao = typeof cofreSessoes.$inferSelect;
export type InsertCofreSessao = typeof cofreSessoes.$inferInsert;

/**
 * Eventos detectados pelo motor próprio — granularidade superior a
 * juditRespostas. Cada linha é uma observação atômica: 1 movimentação,
 * 1 publicação no DJE, 1 nova ação distribuída, 1 mandado, etc.
 *
 * `hashDedup` é UNIQUE para garantir idempotência quando o worker
 * reentra na mesma página (reprocessamento, retries de fila).
 *
 * `monitoramentoId` é nullable: eventos descobertos via DJE podem não
 * ter monitoramento prévio (caso clássico: cliente foi citado em ação
 * nova).
 */
export const eventosProcesso = mysqlTable("eventos_processo", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  monitoramentoId: int("monitoramentoId"),
  escritorioId: int("escritorioId").notNull(),
  tipo: mysqlEnum("tipoEvento", [
    "movimentacao",
    "publicacao_dje",
    "nova_acao",
    "mandado",
    "intimacao",
    "citacao",
    "sentenca",
    "despacho",
    "audiencia",
    "outro",
  ]).notNull(),
  /** Quando o evento aconteceu no tribunal (não quando foi coletado) */
  dataEvento: timestamp("dataEvento").notNull(),
  fonte: mysqlEnum("fonteEvento", ["judit", "pje", "esaj", "eproc", "dje", "manual"]).notNull(),
  conteudo: text("conteudo").notNull(),
  /** Versão estruturada quando parser conseguiu extrair campos. JSON dentro de TEXT. */
  conteudoJson: text("conteudoJson"),
  cnjAfetado: varchar("cnjAfetado", { length: 32 }),
  /** SHA-256 de (tipo + cnj + dataEvento + 200 chars do conteudo) — UNIQUE */
  hashDedup: varchar("hashDedup", { length: 64 }).notNull(),
  lido: boolean("lido").default(false).notNull(),
  alertaEnviado: boolean("alertaEnviado").default(false).notNull(),
  alertaEnviadoEm: timestamp("alertaEnviadoEm"),
  createdAt: timestamp("createdAtEvento").defaultNow().notNull(),
});

export type EventoProcesso = typeof eventosProcesso.$inferSelect;
export type InsertEventoProcesso = typeof eventosProcesso.$inferInsert;

/**
 * DJE — Documentos baixados (1 PDF = 1 dia × 1 caderno × 1 tribunal).
 *
 * `hashConteudo` é UNIQUE para evitar reprocessamento quando o tribunal
 * retorna o mesmo conteúdo em datas diferentes (comum em dias sem
 * publicação onde o sistema serve o PDF do dia útil anterior).
 */
export const djeDocumentos = mysqlTable("dje_documentos", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** Identificação completa: ex "tjsp_caderno_1", "djen_unificado", "trt2_caderno_judiciario" */
  tribunal: varchar("tribunal", { length: 64 }).notNull(),
  sigla: varchar("sigla", { length: 32 }).notNull(),
  /** Formato preservado da URL original (alguns tribunais retornam DD/MM/YYYY) */
  dataPublicacao: varchar("dataPublicacao", { length: 10 }).notNull(),
  urlOrigem: text("urlOrigem").notNull(),
  s3Key: varchar("s3Key", { length: 512 }).notNull(),
  tamanhoBytes: bigint("tamanhoBytes", { mode: "number" }),
  paginas: int("paginas"),
  status: mysqlEnum("statusDje", ["baixado", "parseado", "indexado", "erro"])
    .default("baixado")
    .notNull(),
  ultimoErro: text("ultimoErro"),
  /** SHA-256 do binário do PDF — UNIQUE evita reprocessamento */
  hashConteudo: varchar("hashConteudo", { length: 64 }).notNull(),
  createdAt: timestamp("createdAtDjeDoc").defaultNow().notNull(),
  parseadoEm: timestamp("parseadoEm"),
  indexadoEm: timestamp("indexadoEm"),
});

export type DjeDocumento = typeof djeDocumentos.$inferSelect;
export type InsertDjeDocumento = typeof djeDocumentos.$inferInsert;

/**
 * DJE — Publicações individuais extraídas de um documento.
 *
 * LGPD: armazenamos CNJ, nomes de partes, OABs e CNPJs (todos públicos
 * por força do art. 93 IX da CF/88). CPF é único campo sensível — guardamos
 * apenas SHA-256 hex do CPF normalizado (sem máscara/espaços), nunca o
 * CPF cru. Match por CPF na busca compara hash com hash.
 *
 * `texto` está em LONGTEXT (criado pela migration) com FULLTEXT INDEX
 * para busca por nome de parte / advogado / palavra-chave.
 */
export const djePublicacoes = mysqlTable("dje_publicacoes", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  documentoId: bigint("documentoId", { mode: "number" }).notNull(),
  /** Posição da publicação dentro do PDF (ordem de aparição) */
  ordem: int("ordem").notNull(),
  cnjAfetado: varchar("cnjAfetado", { length: 32 }),
  /** JSON arrays — armazenados em TEXT por convenção do projeto */
  partesNomes: text("partesNomes"),
  /** Hashes SHA-256 dos CPFs das partes — sem CPFs crus (LGPD) */
  partesCpfsHash: text("partesCpfsHash"),
  partesCnpjs: text("partesCnpjs"),
  advogadosOabs: text("advogadosOabs"),
  /** Texto completo da publicação — alimenta FULLTEXT INDEX criado na migration */
  texto: text("texto").notNull(),
  /** SHA-256 do `texto` normalizado — UNIQUE evita duplicatas em retificações */
  hashDedup: varchar("hashDedup", { length: 64 }).notNull(),
  createdAt: timestamp("createdAtDjePub").defaultNow().notNull(),
});

export type DjePublicacao = typeof djePublicacoes.$inferSelect;
export type InsertDjePublicacao = typeof djePublicacoes.$inferInsert;

/**
 * Worker Jobs Log — auditoria de cada execução de adapter de tribunal,
 * crawler DJE ou job recorrente.
 *
 * NÃO é fila (BullMQ usa Redis para isso). É log persistido para
 * dashboard de saúde (`/admin/motor-proprio`) e debug pós-falha.
 */
export const workerJobsLog = mysqlTable("worker_jobs_log", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** Ex: workerName="tribunais", jobName="scrape_pje_trt2" */
  workerName: varchar("workerName", { length: 64 }).notNull(),
  jobName: varchar("jobName", { length: 128 }).notNull(),
  /** Categoria livre: ex "scrape_cnj", "dje_download", "esaj_login_validate" */
  tipo: varchar("tipoJob", { length: 64 }).notNull(),
  /** Payloads JSON dentro de TEXT (convenção do projeto) */
  payloadJson: text("payloadJson"),
  resultadoJson: text("resultadoJson"),
  status: mysqlEnum("statusJob", ["pendente", "em_andamento", "sucesso", "falha"])
    .default("pendente")
    .notNull(),
  tentativas: int("tentativas").default(0).notNull(),
  ultimoErro: text("ultimoErro"),
  iniciadoEm: timestamp("iniciadoEm"),
  finalizadoEm: timestamp("finalizadoEm"),
  createdAt: timestamp("createdAtJobLog").defaultNow().notNull(),
});

export type WorkerJobLog = typeof workerJobsLog.$inferSelect;
export type InsertWorkerJobLog = typeof workerJobsLog.$inferInsert;

export type AsaasConfigCobrancaPai = typeof asaasConfigCobrancaPai.$inferSelect;
