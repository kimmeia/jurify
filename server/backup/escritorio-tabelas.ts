/**
 * Allowlist explícita das tabelas que entram no backup do escritório.
 *
 * Toda tabela com `escritorioId` precisa estar EM UMA das três listas:
 *   - INCLUIR: faz parte do backup (dados ou configs sem segredo).
 *   - EXCLUIR_SEGREDO: contém chaves criptografadas, tokens, senhas
 *     compartilhadas. Restore manual via reconfiguração das integrações.
 *   - EXCLUIR_NAO_RELEVANTE: auditoria, métricas internas Jurify, ou
 *     dados que não fazem sentido no backup do escritório.
 *
 * O teste em `__tests__/backup-allowlist.test.ts` falha se aparecer
 * qualquer tabela nova com `escritorioId` que não esteja classificada.
 * Isso força decisão consciente quando uma feature nova adiciona tabela
 * — evita lacuna silenciosa no backup.
 *
 * Pra colunas sensíveis dentro de tabelas que devem ser incluídas (ex:
 * `agentesIa.openaiApiKey`), declare em `colunasOmitir`. O exporter
 * remove a coluna do JSON e adiciona um placeholder no SQL.
 */
export interface TabelaBackup {
  /** Nome da tabela no MySQL (snake_case). */
  nomeBanco: string;
  /** Coluna escritórioId real (alguns nomes variam: escritorioIdContato etc). */
  colunaEscritorio: string;
  /** Colunas com segredos criptografados — omitidas do export. */
  colunasOmitir?: string[];
  /**
   * Categoria pra UX: "dados" aparece como "Dados operacionais" no
   * preview do backup; "configs" como "Configurações do escritório".
   */
  categoria: "dados" | "configs";
}

export const TABELAS_INCLUIR: TabelaBackup[] = [
  // ─── DADOS OPERACIONAIS ──────────────────────────────────────────────
  { nomeBanco: "colaboradores", colunaEscritorio: "escritorioId", categoria: "dados" },
  { nomeBanco: "convites_colaborador", colunaEscritorio: "escritorioId", categoria: "dados" },
  { nomeBanco: "contatos", colunaEscritorio: "escritorioIdContato", categoria: "dados" },
  { nomeBanco: "cliente_anotacoes", colunaEscritorio: "escritorioId", categoria: "dados" },
  { nomeBanco: "cliente_arquivos", colunaEscritorio: "escritorioId", categoria: "dados" },
  { nomeBanco: "cliente_pastas", colunaEscritorio: "escritorioIdPasta", categoria: "dados" },
  { nomeBanco: "cliente_processos", colunaEscritorio: "escritorioIdCliProc", categoria: "dados" },
  { nomeBanco: "conversas", colunaEscritorio: "escritorioIdConv", categoria: "dados" },
  { nomeBanco: "leads", colunaEscritorio: "escritorioIdLead", categoria: "dados" },
  { nomeBanco: "agendamentos", colunaEscritorio: "escritorioId", categoria: "dados" },
  { nomeBanco: "tarefas", colunaEscritorio: "escritorioIdTarefa", categoria: "dados" },
  { nomeBanco: "kanban_funis", colunaEscritorio: "escritorioIdKF", categoria: "dados" },
  { nomeBanco: "kanban_cards", colunaEscritorio: "escritorioIdKCard", categoria: "dados" },
  { nomeBanco: "kanban_tags", colunaEscritorio: "escritorioIdKTag", categoria: "dados" },
  { nomeBanco: "assinaturas_digitais", colunaEscritorio: "escritorioId", categoria: "dados" },
  // Financeiro:
  { nomeBanco: "asaas_clientes", colunaEscritorio: "escritorioIdAsaasCli", categoria: "dados" },
  { nomeBanco: "asaas_cobrancas", colunaEscritorio: "escritorioIdAsaasCob", categoria: "dados" },
  { nomeBanco: "asaas_config_cobranca_pai", colunaEscritorio: "escritorioIdAcCp", categoria: "dados" },
  { nomeBanco: "despesas", colunaEscritorio: "escritorioIdDesp", categoria: "dados" },
  { nomeBanco: "comissoes_fechadas", colunaEscritorio: "escritorioIdComFech", categoria: "dados" },
  { nomeBanco: "comissoes_agenda", colunaEscritorio: "escritorioIdComAg", categoria: "dados" },
  { nomeBanco: "comissoes_lancamentos_log", colunaEscritorio: "escritorioIdComLog", categoria: "dados" },
  // Métricas de atendimento:
  { nomeBanco: "atendimento_metricas_diarias", colunaEscritorio: "escritorioIdMetrica", categoria: "dados" },
  // Judit (monitoramento de processos — não inclui chaves):
  { nomeBanco: "judit_monitoramentos", colunaEscritorio: "escritorioIdJuditMon", categoria: "dados" },
  // Motor próprio (Spike) — eventos detectados por scrapers/DJE. Conteúdo é
  // texto público de movimentação, sem segredos. CPFs em dje_publicacoes já
  // ficam fora do backup (tabela não tem escritorioId direto).
  { nomeBanco: "eventos_processo", colunaEscritorio: "escritorioId", categoria: "dados" },

  // ─── CONFIGS DO ESCRITÓRIO ────────────────────────────────────────────
  { nomeBanco: "campos_personalizados_cliente", colunaEscritorio: "escritorioIdCpc", categoria: "configs" },
  { nomeBanco: "cargos_personalizados", colunaEscritorio: "escritorioId", categoria: "configs" },
  { nomeBanco: "categorias_cobranca", colunaEscritorio: "escritorioIdCatCob", categoria: "configs" },
  { nomeBanco: "categorias_despesa", colunaEscritorio: "escritorioIdCatDesp", categoria: "configs" },
  { nomeBanco: "regra_comissao", colunaEscritorio: "escritorioIdRegraCom", categoria: "configs" },
  { nomeBanco: "regra_comissao_faixas", colunaEscritorio: "escritorioIdFaixa", categoria: "configs" },
  { nomeBanco: "mensagem_templates", colunaEscritorio: "escritorioIdTpl", categoria: "configs" },
  { nomeBanco: "modelos_contrato", colunaEscritorio: "escritorioIdModCt", categoria: "configs" },
  { nomeBanco: "smartflow_cenarios", colunaEscritorio: "escritorioIdSF", categoria: "configs" },
  { nomeBanco: "smartflow_execucoes", colunaEscritorio: "escritorioIdExec", categoria: "configs" },
  // Agentes IA — chaves API criptografadas são omitidas do export:
  {
    nomeBanco: "agentes_ia",
    colunaEscritorio: "escritorioId",
    categoria: "configs",
    colunasOmitir: ["openaiApiKey", "apiKeyIv", "apiKeyTag"],
  },
  { nomeBanco: "agente_ia_documentos", colunaEscritorio: "escritorioIdIaDoc", categoria: "configs" },
  { nomeBanco: "agente_chat_threads", colunaEscritorio: "escritorioIdThread", categoria: "configs" },
];

/**
 * Tabelas com `escritorioId` que NÃO entram no backup porque guardam
 * segredos (chaves API, webhook tokens, OAuth tokens). Restore =
 * reconfigurar as integrações manualmente (~2 min cada).
 */
export const EXCLUIR_SEGREDO: ReadonlyArray<{ nomeBanco: string; motivo: string }> = [
  { nomeBanco: "asaas_config", motivo: "API key criptografada + webhook token" },
  { nomeBanco: "judit_credenciais", motivo: "API keys do Judit" },
  { nomeBanco: "canais_integrados", motivo: "Tokens WhatsApp/Meta/IA, webhook secrets" },
  { nomeBanco: "cofre_credenciais", motivo: "CPF/OAB + senha + TOTP do motor próprio criptografados — restore = recadastrar" },
];

/**
 * Tabelas com `escritorioId` que não entram no backup por não fazerem
 * sentido pro dono (auditoria de webhook, financeiro interno Jurify).
 */
export const EXCLUIR_NAO_RELEVANTE: ReadonlyArray<{ nomeBanco: string; motivo: string }> = [
  { nomeBanco: "integracao_audit_log", motivo: "Auditoria de integrações — log interno" },
  { nomeBanco: "asaas_webhook_eventos", motivo: "Idempotency log de webhooks — não tem valor pro dono" },
  { nomeBanco: "judit_creditos", motivo: "Créditos do escritório no Judit — financeiro Jurify" },
  { nomeBanco: "judit_transacoes", motivo: "Histórico de uso Judit — financeiro Jurify" },
];

/**
 * Lista plana de TODAS as tabelas com `escritorioId` (de qualquer
 * grupo). Usada pelo teste de enforcement. Atualizar quando schema
 * adicionar tabela nova.
 */
export const TODAS_TABELAS_COM_ESCRITORIO_ID: ReadonlyArray<string> = [
  ...TABELAS_INCLUIR.map((t) => t.nomeBanco),
  ...EXCLUIR_SEGREDO.map((t) => t.nomeBanco),
  ...EXCLUIR_NAO_RELEVANTE.map((t) => t.nomeBanco),
];

/**
 * Tabelas-satélite: NÃO têm `escritorioId` próprio mas pertencem ao
 * escopo do escritório via FK indireta. Sem elas o backup é incompleto
 * (cards sem coluna, conversas sem mensagens, etc).
 *
 * O exporter executa o `filtroSql` (que é o WHERE depois do `WHERE`)
 * via subquery pra pegar só as linhas desse escritório.
 */
export interface TabelaBackupSatelite {
  nomeBanco: string;
  /** Cláusula WHERE (sem o `WHERE`). Usa `?` pra escritorioId. */
  filtroSql: string;
  categoria: "dados" | "configs";
  colunasOmitir?: string[];
}

export const TABELAS_SATELITE: TabelaBackupSatelite[] = [
  {
    nomeBanco: "agendamento_lembretes",
    filtroSql: "agendamentoId IN (SELECT id FROM agendamentos WHERE escritorioId = ?)",
    categoria: "dados",
  },
  {
    nomeBanco: "mensagens",
    filtroSql: "conversaIdMsg IN (SELECT id FROM conversas WHERE escritorioIdConv = ?)",
    categoria: "dados",
  },
  {
    nomeBanco: "agente_chat_mensagens",
    filtroSql: "threadIdMsg IN (SELECT id FROM agente_chat_threads WHERE escritorioIdThread = ?)",
    categoria: "configs",
  },
  {
    nomeBanco: "cliente_processo_anotacoes",
    filtroSql: "processoIdAnot IN (SELECT id FROM cliente_processos WHERE escritorioIdCliProc = ?)",
    categoria: "dados",
  },
  {
    nomeBanco: "permissoes_cargo",
    filtroSql: "cargoId IN (SELECT id FROM cargos_personalizados WHERE escritorioId = ?)",
    categoria: "configs",
  },
  {
    nomeBanco: "smartflow_passos",
    filtroSql: "cenarioIdPasso IN (SELECT id FROM smartflow_cenarios WHERE escritorioIdSF = ?)",
    categoria: "configs",
  },
  {
    nomeBanco: "kanban_colunas",
    filtroSql: "funilIdKC IN (SELECT id FROM kanban_funis WHERE escritorioIdKF = ?)",
    categoria: "dados",
  },
  {
    nomeBanco: "kanban_movimentacoes",
    filtroSql: "cardIdKMov IN (SELECT id FROM kanban_cards WHERE escritorioIdKCard = ?)",
    categoria: "dados",
  },
  {
    nomeBanco: "comissoes_fechadas_itens",
    filtroSql: "comissaoFechadaIdItem IN (SELECT id FROM comissoes_fechadas WHERE escritorioIdComFech = ?)",
    categoria: "dados",
  },
];

/**
 * Ordem topológica de INSERT pro import: pais antes de filhos.
 * DELETE roda em ordem REVERSA. Inclui tabelas com escritorioId +
 * tabelas-satélite. Self-ref de cliente_pastas é resolvida com
 * SET FOREIGN_KEY_CHECKS=0 durante o import.
 *
 * Ordem derivada das FKs entre tabelas do escopo (FKs pra users,
 * escritorios, judit_credenciais ficam fora). Ver
 * docs/backup-fk-graph.md ou a investigação da PR.
 */
export const ORDEM_TOPOLOGICA: ReadonlyArray<string> = [
  // RAÍZES — sem FK pra dentro do escopo:
  "contatos",
  "cargos_personalizados",
  "kanban_funis",
  "kanban_tags",
  "categorias_cobranca",
  "categorias_despesa",
  "regra_comissao",
  "regra_comissao_faixas",
  "mensagem_templates",
  "modelos_contrato",
  "campos_personalizados_cliente",
  "smartflow_cenarios",
  "agentes_ia",
  "comissoes_agenda",
  "judit_monitoramentos",
  "atendimento_metricas_diarias",

  // NÍVEL 1 — depende só de raízes:
  "cliente_pastas", // self-ref OK com FK_CHECKS=0
  "cliente_anotacoes",
  "cliente_arquivos",
  "conversas",
  "leads",
  "agendamentos",
  "asaas_clientes",
  "asaas_cobrancas",
  "asaas_config_cobranca_pai",
  "despesas",
  "comissoes_fechadas",
  "smartflow_passos",
  "kanban_colunas",
  "agente_ia_documentos",
  "agente_chat_threads",
  "permissoes_cargo",
  "colaboradores",
  "assinaturas_digitais",
  "convites_colaborador",

  // NÍVEL 2:
  "cliente_processos",
  "eventos_processo", // FK opcional pra judit_monitoramentos (raiz)
  "agendamento_lembretes",
  "mensagens",
  "kanban_cards",
  "comissoes_fechadas_itens",
  "comissoes_lancamentos_log",
  "agente_chat_mensagens",
  "smartflow_execucoes",
  "tarefas",

  // NÍVEL 3:
  "cliente_processo_anotacoes",
  "kanban_movimentacoes",
];
