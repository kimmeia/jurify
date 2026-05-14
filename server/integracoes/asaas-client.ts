/**
 * Asaas API Client — Client HTTP tipado para a API v3 do Asaas.
 *
 * Documentação: https://docs.asaas.com/reference
 *
 * Auth: header `access_token: $ASAAS_API_KEY`
 * Base URLs:
 *   Produção: https://api.asaas.com/v3
 *   Sandbox:  https://sandbox.asaas.com/api/v3
 *
 * Cada escritório conecta sua própria API key.
 */

import axios, { type AxiosInstance, type AxiosError } from "axios";
import { AsaasRateGuard, type AsaasRateGuardInstance, RateLimitError } from "./asaas-rate-guard";
import { dataHojeBR } from "../../shared/escritorio-types";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface AsaasCustomer {
  id: string;
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  externalReference?: string;
  deleted: boolean;
}

export interface AsaasCustomerInput {
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  postalCode?: string;
  address?: string;
  addressNumber?: string;
  province?: string;
  externalReference?: string;
  /**
   * Agrupador visual no painel Asaas (https://www.asaas.com/api/v3/customers).
   * Usado para refletir o atendente responsável do cliente — facilita filtros
   * e recortes no relatório do Asaas.
   */
  groupName?: string;
}

export type AsaasBillingType = "BOLETO" | "CREDIT_CARD" | "PIX" | "UNDEFINED";

export type AsaasPaymentStatus =
  | "PENDING"
  | "RECEIVED"
  | "CONFIRMED"
  | "OVERDUE"
  | "REFUNDED"
  | "RECEIVED_IN_CASH"
  | "REFUND_REQUESTED"
  | "REFUND_IN_PROGRESS"
  | "CHARGEBACK_REQUESTED"
  | "CHARGEBACK_DISPUTE"
  | "AWAITING_CHARGEBACK_REVERSAL"
  | "DUNNING_REQUESTED"
  | "DUNNING_RECEIVED"
  | "AWAITING_RISK_ANALYSIS"
  | "AUTHORIZED";

export interface AsaasPayment {
  id: string;
  customer: string;
  dateCreated: string;
  dueDate: string;
  value: number;
  netValue: number;
  billingType: AsaasBillingType;
  status: AsaasPaymentStatus;
  description?: string;
  externalReference?: string;
  invoiceUrl: string;
  bankSlipUrl?: string;
  transactionReceiptUrl?: string;
  invoiceNumber?: string;
  deleted: boolean;
  paymentDate?: string;
  clientPaymentDate?: string;
  /** Data de confirmação no Asaas — preenchido quando status=CONFIRMED
   *  (PIX confirmado, cartão autorizado, boleto registrado) antes do
   *  crédito ser efetivado em conta. Pra status=RECEIVED, prefira
   *  `paymentDate` (data do crédito). Usado como fallback de
   *  "data do pagamento" quando `paymentDate` ainda não está disponível. */
  confirmedDate?: string;
  originalValue?: number;
  interestValue?: number;
  fine?: {
    value: number;
    type: "FIXED" | "PERCENTAGE";
  };
  interest?: {
    value: number;
    type: "FIXED" | "PERCENTAGE";
  };
  discount?: {
    value: number;
    dueDateLimitDays: number;
    type: "FIXED" | "PERCENTAGE";
  };
}

export interface AsaasPaymentInput {
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  dueDate: string;
  description?: string;
  externalReference?: string;
  fine?: { value: number; type?: "FIXED" | "PERCENTAGE" };
  interest?: { value: number; type?: "FIXED" | "PERCENTAGE" };
  discount?: { value: number; dueDateLimitDays: number; type?: "FIXED" | "PERCENTAGE" };
  /** Redirect automático após pagamento (PIX/cartão apenas) */
  callback?: {
    successUrl: string;
    autoRedirect?: boolean;
  };
}

export interface AsaasPixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

export interface AsaasBalance {
  balance: number;
}

export interface AsaasListResponse<T> {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: T[];
}

export interface AsaasSubscription {
  id: string;
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  nextDueDate: string;
  cycle: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "BIMONTHLY" | "QUARTERLY" | "SEMIANNUALLY" | "YEARLY";
  description?: string;
  status: "ACTIVE" | "INACTIVE" | "EXPIRED";
  deleted: boolean;
  externalReference?: string;
}

export interface AsaasCallbackConfig {
  /**
   * URL para onde o cliente é redirecionado após pagamento confirmado.
   * Só funciona pra métodos com confirmação instantânea: PIX, cartão.
   * Boleto NÃO faz auto-redirect (compensação é assíncrona).
   *
   * IMPORTANTE: o domínio desta URL precisa estar cadastrado nos dados
   * comerciais da conta Asaas (Configurações da Conta → Informações),
   * senão o redirecionamento falha.
   */
  successUrl: string;
  /** true = redireciona automaticamente, false = mostra botão "Ir para o site" */
  autoRedirect?: boolean;
}

export interface AsaasSubscriptionInput {
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  nextDueDate: string;
  cycle: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "BIMONTHLY" | "QUARTERLY" | "SEMIANNUALLY" | "YEARLY";
  description?: string;
  externalReference?: string;
  fine?: { value: number; type?: "FIXED" | "PERCENTAGE" };
  interest?: { value: number; type?: "FIXED" | "PERCENTAGE" };
  callback?: AsaasCallbackConfig;
}

export interface AsaasInstallmentInput {
  customer: string;
  billingType: AsaasBillingType;
  totalValue: number;
  installmentCount: number;
  dueDate: string;
  description?: string;
  externalReference?: string;
  fine?: { value: number; type?: "FIXED" | "PERCENTAGE" };
  interest?: { value: number; type?: "FIXED" | "PERCENTAGE" };
}

export interface AsaasInstallment {
  id: string;
  customer: string;
  value: number;
  installmentCount: number;
  billingType: AsaasBillingType;
  description?: string;
  status: string;
  externalReference?: string;
  deleted: boolean;
}

export interface AsaasTesteResult {
  ok: boolean;
  mensagem: string;
  detalhes?: string;
  saldo?: number;
  modo?: "sandbox" | "producao";
}

/**
 * Item do extrato financeiro Asaas (`GET /v3/financialTransactions`).
 *
 * `value` é POSITIVO pra crédito (cobrança recebida, estorno) e NEGATIVO
 * pra débito (taxa de cobrança, transferência saindo, notificação, etc).
 * `balance` é o saldo da conta APÓS aplicar essa movimentação — útil pra
 * reconciliar.
 *
 * `type` é um discriminador que mapeia o que aconteceu. Tipos conhecidos
 * (lista pode variar — código trata novos tipos como categoria genérica):
 *  - PAYMENT_RECEIVED / PAYMENT_OVERDUE_RECEIVED — crédito da cobrança
 *  - PAYMENT_FEE — taxa cobrada por cobrança recebida
 *  - PAYMENT_REVERSAL — estorno
 *  - TRANSFER — transferência PIX/TED saindo
 *  - TRANSFER_FEE / TRANSFER_REVERSAL_FEE — taxa por transferência
 *  - REFUND_REQUEST_FEE — taxa de pedido de estorno
 *  - ASAAS_CARD_RECHARGE / ASAAS_CARD_BALANCE_REFUND — operações cartão Asaas
 *  - ASAAS_CARD_TRANSACTION / ASAAS_CARD_TRANSACTION_FEE — débito cartão Asaas
 *  - NOTIFICATION_FEE — cobrança por notificação (SMS/WhatsApp/voz/e-mail)
 *  - ANTICIPATION_FEE — taxa de antecipação
 *  - CONTRACTUAL_EFFECT_SETTLEMENT_DEBIT / _CREDIT — efeitos contratuais
 *  - BACEN_JUDICIAL_LOCK / _UNLOCK — bloqueio judicial
 *  - PROMOTIONAL_CODE_CREDIT — bônus promocional
 *  - CUSTOMER_INTERNAL_TRANSFER — entre contas Asaas
 *  - (qualquer outro que o Asaas introduzir no futuro)
 */
export interface AsaasFinancialTransaction {
  object: string;
  id: string;
  value: number;
  balance: number;
  type: string;
  date: string;
  description: string | null;
  payment?: string | null;
  transfer?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

function detectMode(apiKey: string): "sandbox" | "producao" {
  // Sandbox keys: $aact_YTU5... or $aact_hmlg_... (homologação)
  // Production keys: $aact_prod_... or other patterns
  const lower = apiKey.toLowerCase();
  if (lower.includes("sandbox") || lower.includes("hmlg") || apiKey.startsWith("$aact_YTU5")) {
    return "sandbox";
  }
  return "producao";
}

function getBaseUrl(modo: "sandbox" | "producao"): string {
  return modo === "sandbox"
    ? "https://sandbox.asaas.com/api/v3"
    : "https://api.asaas.com/v3";
}

export class AsaasClient {
  private api: AxiosInstance;
  public modo: "sandbox" | "producao";
  private guard: AsaasRateGuardInstance;

  constructor(apiKey: string, modo?: "sandbox" | "producao") {
    this.modo = modo || detectMode(apiKey);
    const baseURL = getBaseUrl(this.modo);
    this.guard = AsaasRateGuard.forApiKey(apiKey);

    this.api = axios.create({
      baseURL,
      headers: {
        access_token: apiKey,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    // Camadas 1, 2, 3, 4 do rate guard são aplicadas em cada request via
    // interceptors. Lança RateLimitError (sem retentativa) quando uma
    // camada bloqueia. `__asaasGuardHeld` só é setado APÓS acquire bem
    // sucedido — sinal pro interceptor de response saber se deve liberar
    // (evita decrementar inflight que nunca foi incrementado quando
    // Camada 1/2/4 abortou antes da Camada 3).
    this.api.interceptors.request.use(async (config) => {
      const method = (config.method || "get").toUpperCase();
      const url = config.url || "";
      await this.guard.acquire(method, url);
      (config as any).__asaasGuardHeld = method;
      return config;
    });

    this.api.interceptors.response.use(
      (response) => {
        const held = (response.config as any).__asaasGuardHeld;
        const url = response.config.url || "";
        if (held) this.guard.release(held);
        this.guard.recordResponse(url, response.headers as any);
        return response;
      },
      (error: AxiosError) => {
        const cfg = error.config as any;
        const held = cfg?.__asaasGuardHeld;
        const url = cfg?.url || "";
        if (held) this.guard.release(held);

        if (error.response) {
          this.guard.recordResponse(url, error.response.headers as any);
          if (error.response.status === 429) {
            const retryAfter = error.response.headers["retry-after"];
            const retryAfterSec = retryAfter ? Number(retryAfter) : undefined;
            this.guard.recordRateLimitError(url, retryAfterSec);
          }
        }
        return Promise.reject(error);
      },
    );
  }

  // ─── TESTE DE CONEXÃO ──────────────────────────────────────────────────────

  async testarConexao(): Promise<AsaasTesteResult> {
    try {
      const res = await this.api.get<AsaasBalance>("/finance/balance");
      return {
        ok: true,
        mensagem: `Conectado com sucesso (${this.modo})`,
        saldo: res.data.balance,
        modo: this.modo,
      };
    } catch (err) {
      // RateLimitError vem do rate guard local (cota 12h, janela 60s, etc).
      // NÃO é erro do Asaas — não desconectar. Mensagem padronizada pra
      // que o router classifique como rate limit e mantenha a key salva
      // em `aguardando_validacao` (regex do router checa "rate_limit").
      if (err instanceof RateLimitError) {
        return {
          ok: false,
          mensagem: "rate_limit: guard local bloqueou (cota próxima do limite)",
          detalhes: err.message,
        };
      }
      const axErr = err as AxiosError<any>;
      if (axErr.response) {
        const status = axErr.response.status;
        const data = axErr.response.data;
        const errors = data?.errors;
        const msg = Array.isArray(errors) ? errors.map((e: any) => e.description).join("; ") : JSON.stringify(data).slice(0, 300);

        if (status === 401) {
          return { ok: false, mensagem: "API key inválida ou expirada", detalhes: msg };
        }
        return { ok: false, mensagem: `Erro HTTP ${status}`, detalhes: msg };
      }
      if (axErr.code === "ECONNABORTED") {
        return { ok: false, mensagem: "Timeout — Asaas não respondeu em 15s" };
      }
      return { ok: false, mensagem: "Erro de conexão", detalhes: axErr.message };
    }
  }

  // ─── CLIENTES ──────────────────────────────────────────────────────────────

  async listarClientes(offset = 0, limit = 100): Promise<AsaasListResponse<AsaasCustomer>> {
    const res = await this.api.get("/customers", { params: { offset, limit } });
    return res.data;
  }

  async buscarClientePorCpfCnpj(cpfCnpj: string): Promise<AsaasCustomer | null> {
    const res = await this.api.get<AsaasListResponse<AsaasCustomer>>("/customers", {
      params: { cpfCnpj: cpfCnpj.replace(/\D/g, "") },
    });
    return res.data.data.length > 0 ? res.data.data[0] : null;
  }

  /**
   * Retorna TODOS os customers do Asaas com o CPF/CNPJ informado.
   * O Asaas permite duplicatas (regra de unicidade fraca): um mesmo CPF
   * pode aparecer em múltiplos customers, geralmente por imports antigos,
   * cadastro manual ou webhooks que não deduplicaram. Ignora os deletados.
   *
   * Usa paginação — caso raro, mas possível em bases grandes.
   */
  async buscarTodosClientesPorCpfCnpj(cpfCnpj: string): Promise<AsaasCustomer[]> {
    const cpfLimpo = cpfCnpj.replace(/\D/g, "");
    if (!cpfLimpo) return [];

    const resultados: AsaasCustomer[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    // Cap defensivo: se a API começar a retornar hasMore=true indefinidamente
    // (bug do lado deles ou loop em base inconsistente), abortamos depois de
    // 10 páginas. 10×100 = 1000 customers com o mesmo CPF é cenário impossível
    // na prática (já são duplicatas demais).
    const MAX_PAGINAS = 10;
    let paginas = 0;

    while (hasMore && paginas < MAX_PAGINAS) {
      const res = await this.api.get<AsaasListResponse<AsaasCustomer>>("/customers", {
        params: { cpfCnpj: cpfLimpo, offset, limit },
      });
      for (const c of res.data.data) {
        if (c.deleted) continue;
        const cpfRemoto = (c.cpfCnpj || "").replace(/\D/g, "");
        // Conferência final local (Asaas às vezes faz prefix match).
        if (cpfRemoto === cpfLimpo) resultados.push(c);
      }
      hasMore = res.data.hasMore;
      // Avança pelo número de itens REALMENTE recebidos, não pelo `limit`
      // pedido. Quando a API retorna menos do que o cap (página final ou
      // backend inconsistente), incrementar pelo `limit` pula registros.
      const recebidos = res.data.data.length;
      if (recebidos === 0) break;
      offset += recebidos;
      paginas++;
    }

    return resultados;
  }

  /**
   * Busca clientes no Asaas por telefone (phone ou mobilePhone).
   * Asaas pode retornar múltiplos (ex.: responsável legal ou familiar
   * compartilhando telefone). A chamada é feita separada por campo e a
   * conferência final é local, apenas com dígitos, para evitar match
   * parcial caso a API faça prefix search.
   */
  async buscarClientesPorTelefone(telefone: string): Promise<AsaasCustomer[]> {
    const telLimpo = telefone.replace(/\D/g, "");
    if (!telLimpo) return [];

    const resultados = new Map<string, AsaasCustomer>();

    for (const campo of ["phone", "mobilePhone"] as const) {
      try {
        const res = await this.api.get<AsaasListResponse<AsaasCustomer>>("/customers", {
          params: { [campo]: telLimpo },
        });
        for (const c of res.data.data) {
          if (c.deleted) continue;
          const phoneMatch = (c.phone || "").replace(/\D/g, "");
          const mobileMatch = (c.mobilePhone || "").replace(/\D/g, "");
          if (phoneMatch === telLimpo || mobileMatch === telLimpo) {
            resultados.set(c.id, c);
          }
        }
      } catch {
        /* tenta próximo campo */
      }
    }

    return Array.from(resultados.values());
  }

  async criarCliente(input: AsaasCustomerInput): Promise<AsaasCustomer> {
    const res = await this.api.post("/customers", input);
    return res.data;
  }

  async atualizarCliente(id: string, input: Partial<AsaasCustomerInput>): Promise<AsaasCustomer> {
    const res = await this.api.put(`/customers/${id}`, input);
    return res.data;
  }

  async buscarCliente(id: string): Promise<AsaasCustomer> {
    const res = await this.api.get(`/customers/${id}`);
    return res.data;
  }

  // ─── COBRANÇAS ─────────────────────────────────────────────────────────────

  async criarCobranca(input: AsaasPaymentInput): Promise<AsaasPayment> {
    try {
      const res = await this.api.post("/payments", input);
      return res.data;
    } catch (err) {
      const axErr = err as AxiosError<any>;
      if (axErr.response) {
        const data = axErr.response.data;
        const errors = data?.errors;
        const msgs = Array.isArray(errors)
          ? errors
              .map((e: any) => `${e.code ?? ""}: ${e.description ?? JSON.stringify(e)}`)
              .join(" | ")
          : typeof data === "string"
          ? data
          : JSON.stringify(data).slice(0, 500);
        throw new Error(`Asaas rejeitou criarCobranca (${axErr.response.status}): ${msgs}`);
      }
      throw err;
    }
  }

  async listarCobrancas(params?: {
    customer?: string;
    status?: AsaasPaymentStatus;
    offset?: number;
    limit?: number;
  }): Promise<AsaasListResponse<AsaasPayment>> {
    const res = await this.api.get("/payments", { params });
    return res.data;
  }

  /**
   * Lista cobranças filtradas por janela de data. Usado pelo cron de
   * sincronização histórica em janelas curtas — pega só o que foi
   * criado num intervalo específico, paginado. Filtros suportados:
   *  - `dateCreatedGe`/`dateCreatedLe`: data de criação no Asaas
   *  - `paymentDateGe`/`paymentDateLe`: data do pagamento (status=RECEIVED)
   *  - `dueDateGe`/`dueDateLe`: data de vencimento
   * Datas em formato ISO YYYY-MM-DD. A API Asaas espera os parâmetros
   * com colchetes (ex: `dateCreated[ge]`), montados aqui em `params` raw.
   */
  async listarCobrancasPorJanela(params: {
    dateCreatedGe?: string;
    dateCreatedLe?: string;
    paymentDateGe?: string;
    paymentDateLe?: string;
    dueDateGe?: string;
    dueDateLe?: string;
    /** Quando preenchido, restringe à conta do customer específico. */
    customer?: string;
    offset?: number;
    limit?: number;
  }): Promise<AsaasListResponse<AsaasPayment>> {
    const raw: Record<string, string | number> = {};
    if (params.dateCreatedGe) raw["dateCreated[ge]"] = params.dateCreatedGe;
    if (params.dateCreatedLe) raw["dateCreated[le]"] = params.dateCreatedLe;
    if (params.paymentDateGe) raw["paymentDate[ge]"] = params.paymentDateGe;
    if (params.paymentDateLe) raw["paymentDate[le]"] = params.paymentDateLe;
    if (params.dueDateGe) raw["dueDate[ge]"] = params.dueDateGe;
    if (params.dueDateLe) raw["dueDate[le]"] = params.dueDateLe;
    if (params.customer) raw["customer"] = params.customer;
    if (typeof params.offset === "number") raw["offset"] = params.offset;
    raw["limit"] = params.limit ?? 100;
    const res = await this.api.get("/payments", { params: raw });
    return res.data;
  }

  async buscarCobranca(id: string): Promise<AsaasPayment> {
    const res = await this.api.get(`/payments/${id}`);
    return res.data;
  }

  async excluirCobranca(id: string): Promise<void> {
    await this.api.delete(`/payments/${id}`);
  }

  /**
   * Confirma recebimento manual (em dinheiro/PIX manual/transferência).
   * `value` defaults ao valor da cobrança quando ausente; `paymentDate`
   * default hoje. POST `/payments/:id/receiveInCash` — endpoint Asaas
   * estável e documentado, usado quando o pagamento veio por fora do
   * Asaas mas precisa ser refletido no painel/relatórios.
   */
  async confirmarRecebimentoEmDinheiro(
    id: string,
    params?: { value?: number; paymentDate?: string; notifyCustomer?: boolean },
  ): Promise<AsaasPayment> {
    const body: Record<string, unknown> = {
      // Default "hoje" no fuso BR — após 21h BRT a versão UTC viraria
      // amanhã, registrando pagamento com data futura no Asaas.
      paymentDate: params?.paymentDate ?? dataHojeBR(),
      notifyCustomer: params?.notifyCustomer ?? false,
    };
    if (typeof params?.value === "number") body.value = params.value;
    const res = await this.api.post(`/payments/${id}/receiveInCash`, body);
    return res.data;
  }

  async obterPixQrCode(paymentId: string): Promise<AsaasPixQrCode> {
    const res = await this.api.get(`/payments/${paymentId}/pixQrCode`);
    return res.data;
  }

  async obterLinhaDigitavel(paymentId: string): Promise<{ identificationField: string; nossoNumero: string; barCode: string }> {
    const res = await this.api.get(`/payments/${paymentId}/identificationField`);
    return res.data;
  }

  // ─── COBRANÇAS POR CLIENTE (resumo financeiro) ─────────────────────────────

  async resumoFinanceiroCliente(customerId: string): Promise<{
    total: number;
    pendente: number;
    vencido: number;
    pago: number;
    cobrancas: AsaasPayment[];
  }> {
    // Buscar todas cobranças do cliente (últimas 100)
    const res = await this.api.get<AsaasListResponse<AsaasPayment>>("/payments", {
      params: { customer: customerId, limit: 100 },
    });

    const cobrancas = res.data.data.filter((p) => !p.deleted);
    let pendente = 0;
    let vencido = 0;
    let pago = 0;

    for (const c of cobrancas) {
      if (c.status === "PENDING") pendente += c.value;
      else if (c.status === "OVERDUE") vencido += c.value;
      else if (c.status === "RECEIVED" || c.status === "CONFIRMED" || c.status === "RECEIVED_IN_CASH") pago += c.value;
    }

    return { total: pendente + vencido + pago, pendente, vencido, pago, cobrancas };
  }

  // ─── ASSINATURAS ───────────────────────────────────────────────────────────

  async criarAssinatura(input: AsaasSubscriptionInput): Promise<AsaasSubscription> {
    try {
      const res = await this.api.post("/subscriptions", input);
      return res.data;
    } catch (err) {
      const axErr = err as AxiosError<any>;
      if (axErr.response) {
        // Monta mensagem amigável com os erros estruturados do Asaas
        const data = axErr.response.data;
        const errors = data?.errors;
        const msgs = Array.isArray(errors)
          ? errors
              .map((e: any) => `${e.code ?? ""}: ${e.description ?? JSON.stringify(e)}`)
              .join(" | ")
          : typeof data === "string"
          ? data
          : JSON.stringify(data).slice(0, 500);
        throw new Error(`Asaas rejeitou criarAssinatura (${axErr.response.status}): ${msgs}`);
      }
      throw err;
    }
  }

  async listarAssinaturas(params?: {
    customer?: string;
    offset?: number;
    limit?: number;
  }): Promise<AsaasListResponse<AsaasSubscription>> {
    const res = await this.api.get("/subscriptions", { params });
    return res.data;
  }

  async cancelarAssinatura(id: string): Promise<void> {
    await this.api.delete(`/subscriptions/${id}`);
  }

  // ─── PARCELAMENTOS ─────────────────────────────────────────────────────

  async criarParcelamento(input: AsaasInstallmentInput): Promise<AsaasInstallment> {
    const res = await this.api.post("/installments", input);
    return res.data;
  }

  async listarParcelamentos(params?: {
    customer?: string;
    offset?: number;
    limit?: number;
  }): Promise<AsaasListResponse<AsaasInstallment>> {
    const res = await this.api.get("/installments", { params });
    return res.data;
  }

  async buscarParcelamento(id: string): Promise<AsaasInstallment> {
    const res = await this.api.get(`/installments/${id}`);
    return res.data;
  }

  async excluirParcelamento(id: string): Promise<void> {
    await this.api.delete(`/installments/${id}`);
  }

  async listarCobrancasParcelamento(installmentId: string): Promise<AsaasListResponse<AsaasPayment>> {
    const res = await this.api.get(`/installments/${installmentId}/payments`);
    return res.data;
  }

  // ─── SALDO ─────────────────────────────────────────────────────────────────

  async obterSaldo(): Promise<AsaasBalance> {
    const res = await this.api.get("/finance/balance");
    return res.data;
  }

  // ─── EXTRATO FINANCEIRO ───────────────────────────────────────────────────

  /**
   * Lista movimentações da conta Asaas (extrato completo: cobranças
   * recebidas, taxas, transferências PIX/TED, notificações, mensalidade,
   * antecipações, etc).
   *
   * Datas em formato ISO YYYY-MM-DD. Limite máximo do Asaas é 100 itens
   * por página. Pra cobrir vários meses, paginar via `offset`.
   */
  async listarMovimentacoes(params: {
    startDate?: string;
    finishDate?: string;
    offset?: number;
    limit?: number;
  }): Promise<AsaasListResponse<AsaasFinancialTransaction>> {
    const res = await this.api.get("/financialTransactions", {
      params: {
        ...(params.startDate ? { startDate: params.startDate } : {}),
        ...(params.finishDate ? { finishDate: params.finishDate } : {}),
        offset: params.offset ?? 0,
        limit: params.limit ?? 100,
      },
    });
    return res.data;
  }

  // ─── WEBHOOK CONFIG ────────────────────────────────────────────────────────

  async configurarWebhook(url: string, accessToken: string, email: string = "noreply@calcsaas.app"): Promise<any> {
    const res = await this.api.post("/webhook", {
      url,
      email,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: accessToken,
    });
    return res.data;
  }
}
