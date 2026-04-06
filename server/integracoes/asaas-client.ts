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

  constructor(apiKey: string, modo?: "sandbox" | "producao") {
    this.modo = modo || detectMode(apiKey);
    const baseURL = getBaseUrl(this.modo);

    this.api = axios.create({
      baseURL,
      headers: {
        access_token: apiKey,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
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
    const res = await this.api.post("/payments", input);
    return res.data;
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

  async buscarCobranca(id: string): Promise<AsaasPayment> {
    const res = await this.api.get(`/payments/${id}`);
    return res.data;
  }

  async excluirCobranca(id: string): Promise<void> {
    await this.api.delete(`/payments/${id}`);
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
    const res = await this.api.post("/subscriptions", input);
    return res.data;
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
