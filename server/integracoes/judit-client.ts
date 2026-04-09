/**
 * JuditClient — Wrapper HTTP para a API da Judit.IO
 *
 * Documentação: https://docs.judit.io/introduction/introduction
 *
 * Arquitetura da API:
 * - Requests Service (requests.prod.judit.io): Criação e consulta de requisições
 * - Lawsuits Service (lawsuits.production.judit.io): Acesso ao datalake
 * - Tracking Service (tracking.prod.judit.io): Monitoramento de processos
 *
 * Autenticação: Header "api-key" (NÃO usa Bearer token)
 * Rate limit: 500 req/min (padrão)
 */

import axios, { AxiosInstance, AxiosError } from "axios";

// ═══════════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════════

export interface JuditTesteConexaoResult {
  ok: boolean;
  mensagem: string;
  detalhes?: string;
}

export type JuditSearchType = "lawsuit_cnj" | "cpf" | "cnpj" | "oab" | "name";

export interface JuditRequestPayload {
  search: {
    search_type: JuditSearchType;
    search_key: string;
    search_params?: {
      lawsuit_instance?: number;
      filter?: Record<string, unknown>;
      pagination?: Record<string, unknown>;
    };
  };
  cache_ttl_in_days?: number;
  with_attachments?: boolean;
  callback_url?: string;
  /** ID da credencial do cofre Judit — necessário pra acessar processos em segredo de justiça */
  credential_id?: string;
}

export interface JuditRequestResponse {
  request_id: string;
  status: string;
  search: {
    search_type: string;
    search_key: string;
    response_type: string;
  };
  created_at: string;
  updated_at: string;
}

export interface JuditTrackingPayload {
  recurrence: number;
  search: {
    search_type: JuditSearchType;
    search_key: string;
    search_params?: {
      lawsuit_instance?: number;
      filter?: Record<string, unknown>;
      pagination?: Record<string, unknown>;
    };
  };
  with_attachments?: boolean;
  callback_url?: string;
  notification_emails?: string[];
  notification_filters?: {
    /** Palavras-chave que disparam alerta quando aparecem numa movimentação */
    step_terms?: string[];
  };
  /**
   * ID de credencial do cofre (cadastrada via POST /credentials).
   * Obrigatória pra monitorar processos em segredo de justiça.
   */
  credential_id?: string;
  /**
   * Quando true, este tracking não monitora movimentações de processos
   * já conhecidos — monitora apenas NOVAS AÇÕES distribuídas contra a
   * pessoa/empresa. Recebe webhook event_type="new_lawsuit".
   *
   * Usar apenas com search_type cpf/cnpj/oab/name (nunca lawsuit_cnj).
   */
  only_new_lawsuits?: boolean;
}

export interface JuditTracking {
  tracking_id: string;
  user_id: string;
  status: "created" | "updating" | "updated" | "paused" | "deleted";
  recurrence: number;
  search: {
    search_type: string;
    search_key: string;
    response_type: string;
  };
  tracked_items_count: number;
  tracked_items_steps_count: number;
  with_attachments: boolean;
  notification_emails?: string[];
  notification_filters?: {
    step_terms: string[];
  };
  hour_range?: number;
  tags: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface JuditTrackingListResponse {
  page: number;
  page_count: number;
  all_pages_count: number;
  all_count: number;
  page_data: JuditTracking[];
}

export interface JuditLawsuit {
  code: string;
  instance: number;
  name: string;
  tribunal_acronym: string;
  county: string;
  city: string;
  state: string;
  distribution_date: string;
  status?: string;
  phase?: string;
  area?: string;
  justice_description?: string;
  judge?: string;
  amount?: number;
  last_step?: {
    step_id: string;
    step_date: string;
    content: string;
    steps_count: number;
  };
  subjects?: Array<{ code: string; name: string }>;
  parties?: Array<{
    name: string;
    side: "Active" | "Passive";
    person_type: string;
    main_document?: string;
    documents?: Array<{ document: string; document_type: string }>;
    lawyers?: Array<{
      name: string;
      main_document?: string;
      documents?: Array<{ document: string; document_type: string }>;
    }>;
  }>;
  classifications?: Array<{ code: string; name: string }>;
  steps?: Array<{
    step_id: string;
    step_date: string;
    content: string;
    step_type?: string;
    private?: boolean;
  }>;
  attachments?: Array<{
    attachment_id: string;
    attachment_name: string;
    extension: string;
    status: string;
    attachment_date?: string;
  }>;
}

/** Body de erro retornado quando response_type === "application_error" */
export interface JuditApplicationError {
  message?: string;
  code?: string;
  details?: string;
}

export interface JuditResponseItem {
  request_id: string;
  response_id: string;
  response_type: string;
  /** Pode ser um lawsuit (sucesso) ou um erro (response_type === "application_error") */
  response_data: JuditLawsuit | JuditApplicationError;
  user_id: string;
  created_at: string;
  tags?: Record<string, unknown>;
}

export interface JuditResponsesPage {
  request_status: string;
  page: number;
  page_count: number;
  all_pages_count: number;
  all_count: number;
  page_data: JuditResponseItem[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

const REQUESTS_BASE = "https://requests.prod.judit.io";
const TRACKING_BASE = "https://tracking.prod.judit.io";
const CRAWLER_BASE = "https://crawler.prod.judit.io";

// ═══════════════════════════════════════════════════════════════════════════════
// TIPOS — COFRE DE CREDENCIAIS
// ═══════════════════════════════════════════════════════════════════════════════

export interface JuditCredencialInput {
  /**
   * Tribunal + sistema, ou "*" como curinga.
   * Exemplos: "tjsp", "trf3", "tst", "*"
   */
  system_name: string;
  /** Etiqueta livre pro admin identificar — ex: "Dr. João Silva" */
  customer_key: string;
  /** CPF ou número OAB do advogado */
  username: string;
  /** Senha do tribunal */
  password: string;
  /** Dados customizados — usado pra 2FA (secret) */
  custom_data?: {
    secret?: string;
    [key: string]: string | undefined;
  };
}

export interface JuditCredencialResposta {
  /** ID opaco retornado pela Judit — use pra referenciar depois */
  credential_id?: string;
  id?: string;
  system_name: string;
  customer_key: string;
  username: string;
  status?: string;
  created_at?: string;
}

export class JuditClient {
  private requestsApi: AxiosInstance;
  private trackingApi: AxiosInstance;
  private crawlerApi: AxiosInstance;

  constructor(apiKey: string) {
    const headers = {
      "api-key": apiKey,
      "Content-Type": "application/json",
    };

    this.requestsApi = axios.create({
      baseURL: REQUESTS_BASE,
      headers,
      timeout: 15000,
    });

    this.trackingApi = axios.create({
      baseURL: TRACKING_BASE,
      headers,
      timeout: 15000,
    });

    this.crawlerApi = axios.create({
      baseURL: CRAWLER_BASE,
      headers,
      timeout: 20000,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COFRE DE CREDENCIAIS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Cadastra uma credencial de tribunal no cofre da Judit.
   *
   * A Judit criptografa a senha e NÃO permite recuperar depois —
   * pra alterar, é necessário remover e recadastrar.
   *
   * Endpoint: POST https://crawler.prod.judit.io/credentials
   * Body: { credentials: [ {...} ] }
   */
  async cadastrarCredencial(credencial: JuditCredencialInput): Promise<JuditCredencialResposta> {
    try {
      const res = await this.crawlerApi.post("/credentials", {
        credentials: [credencial],
      });
      // Pode retornar array ou objeto único — normaliza
      const data = res.data;
      if (Array.isArray(data)) return data[0];
      if (data?.credentials && Array.isArray(data.credentials)) return data.credentials[0];
      return data;
    } catch (err) {
      const axErr = err as AxiosError<any>;
      if (axErr.response) {
        const data = axErr.response.data;
        const msg =
          data?.message ||
          data?.error ||
          JSON.stringify(data).slice(0, 300);
        throw new Error(
          `Judit rejeitou cadastrarCredencial (${axErr.response.status}): ${msg}`,
        );
      }
      throw err;
    }
  }

  /**
   * Lista todas as credenciais cadastradas no cofre.
   * Útil pra exibir no admin do Jurify quais credenciais já existem.
   */
  async listarCredenciais(): Promise<JuditCredencialResposta[]> {
    try {
      const res = await this.crawlerApi.get("/credentials");
      const data = res.data;
      if (Array.isArray(data)) return data;
      if (data?.credentials && Array.isArray(data.credentials)) return data.credentials;
      return [];
    } catch (err) {
      const axErr = err as AxiosError<any>;
      if (axErr.response?.status === 404) return [];
      throw err;
    }
  }

  /**
   * Remove uma credencial do cofre. A credencial fica indisponível
   * imediatamente, e processos que dependiam dela param de ser
   * acessíveis até um replacement ser cadastrado.
   */
  async deletarCredencial(credentialId: string): Promise<void> {
    try {
      await this.crawlerApi.delete(`/credentials/${encodeURIComponent(credentialId)}`);
    } catch (err) {
      const axErr = err as AxiosError<any>;
      if (axErr.response?.status === 404) {
        // Já não existe — considera sucesso
        return;
      }
      if (axErr.response) {
        const data = axErr.response.data;
        const msg = data?.message || data?.error || JSON.stringify(data).slice(0, 300);
        throw new Error(`Judit rejeitou deletarCredencial (${axErr.response.status}): ${msg}`);
      }
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TESTE DE CONEXÃO
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Testa se a API key é válida.
   * Tenta GET /requests primeiro, se falhar tenta GET /tracking como fallback.
   * Mostra o erro completo da Judit para debug.
   */
  async testarConexao(): Promise<JuditTesteConexaoResult> {
    // Tracking funciona sem filtros de data — testar primeiro
    const resultado = await this._testarEndpoint(this.trackingApi, "/tracking", "Tracking", { page: 1, page_size: 5 });
    if (resultado.ok) return resultado;

    // Fallback: tentar Requests com datas obrigatórias
    const now = new Date();
    const gte = new Date(now.getTime() - 30 * 86400000).toISOString();
    const lte = now.toISOString();
    const fallback = await this._testarEndpoint(this.requestsApi, "/requests", "Requests", {
      page: 1, page_size: 5, created_at_gte: gte, created_at_lte: lte,
    });
    return fallback;
  }

  private async _testarEndpoint(
    api: AxiosInstance,
    path: string,
    label: string,
    params?: Record<string, unknown>
  ): Promise<JuditTesteConexaoResult> {
    try {
      const res = await api.get(path, { params: params || { page: 1, page_size: 5 } });

      if (res.status === 200) {
        return {
          ok: true,
          mensagem: `Conexão estabelecida com sucesso (via ${label})`,
        };
      }

      return {
        ok: false,
        mensagem: `Resposta inesperada: HTTP ${res.status}`,
      };
    } catch (err) {
      const axiosErr = err as AxiosError<any>;

      if (axiosErr.response) {
        const status = axiosErr.response.status;
        const data = axiosErr.response.data;

        // Extrair mensagem detalhada da Judit
        const juditMsg = data?.error?.message || data?.message || "";
        const juditData = data?.error?.data || "";
        const juditName = data?.error?.name || "";
        const fullDetail = [
          `HTTP ${status}`,
          juditName,
          juditMsg,
          juditData,
          juditName || juditMsg ? "" : JSON.stringify(data).slice(0, 300),
        ].filter(Boolean).join(" — ");

        if (status === 401) {
          return {
            ok: false,
            mensagem: `API key não autorizada (${label})`,
            detalhes: fullDetail,
          };
        }

        if (status === 403) {
          return {
            ok: false,
            mensagem: `Acesso negado (${label})`,
            detalhes: fullDetail,
          };
        }

        return {
          ok: false,
          mensagem: `Erro HTTP ${status} (${label})`,
          detalhes: fullDetail,
        };
      }

      if (axiosErr.code === "ECONNABORTED") {
        return {
          ok: false,
          mensagem: `Timeout — servidor Judit não respondeu em 15s (${label})`,
        };
      }

      return {
        ok: false,
        mensagem: `Erro de conexão (${label})`,
        detalhes: axiosErr.message,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONSULTAS (Requests Service)
  // ─────────────────────────────────────────────────────────────────────────

  /** Cria uma requisição de busca processual (assíncrona) */
  async criarRequest(payload: JuditRequestPayload): Promise<JuditRequestResponse> {
    const res = await this.requestsApi.post("/requests", payload);
    return res.data;
  }

  /** Consulta o status de uma requisição */
  async consultarRequest(requestId: string): Promise<JuditRequestResponse> {
    const res = await this.requestsApi.get(`/requests/${requestId}`);
    return res.data;
  }

  /** Busca as respostas de uma requisição (paginado) */
  async buscarRespostas(requestId: string, page = 1, pageSize = 20): Promise<JuditResponsesPage> {
    const res = await this.requestsApi.get("/responses", {
      params: { request_id: requestId, page, page_size: Math.max(5, pageSize) },
    });
    return res.data;
  }

  /** Busca respostas de um tracking (histórico de monitoramento) */
  async buscarRespostasTracking(
    trackingId: string,
    page = 1,
    pageSize = 50,
    createdAtGte?: string,
    createdAtLte?: string
  ): Promise<JuditResponsesPage> {
    const params: Record<string, unknown> = {
      page,
      page_size: pageSize,
      order: "desc",
    };
    if (createdAtGte) params.created_at_gte = createdAtGte;
    if (createdAtLte) params.created_at_lte = createdAtLte;

    const res = await this.requestsApi.get(`/responses/tracking/${trackingId}`, { params });
    return res.data;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MONITORAMENTO (Tracking Service)
  // ─────────────────────────────────────────────────────────────────────────

  /** Cria um monitoramento processual */
  async criarMonitoramento(payload: JuditTrackingPayload): Promise<JuditTracking> {
    const res = await this.trackingApi.post("/tracking", payload);
    return res.data;
  }

  /** Lista todos os monitoramentos (paginado) */
  async listarMonitoramentos(
    page = 1,
    pageSize = 50,
    status?: string,
    searchType?: string
  ): Promise<JuditTrackingListResponse> {
    const params: Record<string, unknown> = { page, page_size: pageSize };
    if (status) params.status = status;
    if (searchType) params.search_type = searchType;

    const res = await this.trackingApi.get("/tracking", { params });
    return res.data;
  }

  /** Consulta informações de um monitoramento específico */
  async consultarMonitoramento(trackingId: string): Promise<JuditTracking> {
    const res = await this.trackingApi.get("/tracking", {
      params: { tracking_id: trackingId },
    });
    return res.data;
  }

  /** Atualiza um monitoramento (recurrence, search, tags) */
  async atualizarMonitoramento(
    trackingId: string,
    data: Partial<JuditTrackingPayload>
  ): Promise<JuditTracking> {
    const res = await this.trackingApi.patch(`/tracking/${trackingId}`, data);
    return res.data;
  }

  /** Pausa um monitoramento */
  async pausarMonitoramento(trackingId: string): Promise<JuditTracking> {
    const res = await this.trackingApi.post(`/tracking/${trackingId}/pause`);
    return res.data;
  }

  /** Reativa um monitoramento pausado */
  async reativarMonitoramento(trackingId: string): Promise<JuditTracking> {
    const res = await this.trackingApi.post(`/tracking/${trackingId}/resume`);
    return res.data;
  }

  /** Deleta um monitoramento */
  async deletarMonitoramento(trackingId: string): Promise<JuditTracking> {
    const res = await this.trackingApi.delete(`/tracking/${trackingId}`);
    return res.data;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cria uma instância do JuditClient a partir da API key descriptografada.
 * Usar apenas no backend — nunca expor a key para o frontend.
 */
export function criarJuditClient(apiKey: string): JuditClient {
  return new JuditClient(apiKey);
}
