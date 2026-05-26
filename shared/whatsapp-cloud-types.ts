/**
 * Tipos compartilhados — WhatsApp Cloud API oficial (Meta).
 *
 * Cobre os "serviços" da API oficial além do envio de texto:
 *   - Message Templates (Management API da WABA)
 *   - Business Profile (perfil do número)
 *   - Mensagens interativas (botões / listas) e reações
 *
 * Mantido client-safe (sem imports de server) — usado tanto no router
 * quanto na UI de Configurações.
 */

// ─── Message Templates ───────────────────────────────────────────────────────

export type WACategoriaTemplate = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export type WAStatusTemplate =
  | "APPROVED"
  | "PENDING"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED"
  | "IN_APPEAL"
  | "PENDING_DELETION";

export type WAFormatoBotao = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";

export interface WABotaoTemplate {
  type: WAFormatoBotao;
  text: string;
  url?: string;
  phone_number?: string;
}

export interface WAComponenteTemplate {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  text?: string;
  buttons?: WABotaoTemplate[];
  example?: Record<string, unknown>;
}

/** Template como retornado por GET /{waba-id}/message_templates */
export interface WACloudTemplate {
  id: string;
  name: string;
  language: string;
  status: WAStatusTemplate;
  category: WACategoriaTemplate;
  components: WAComponenteTemplate[];
}

/** Input estruturado pra criar um template (POST /{waba-id}/message_templates) */
export interface WACriarTemplateInput {
  nome: string;
  idioma: string;
  categoria: WACategoriaTemplate;
  corpo: string;
  /** Exemplos pros {{1}}, {{2}}... do corpo — exigido pela Meta quando há variáveis. */
  exemplosCorpo?: string[];
  cabecalhoTexto?: string;
  rodapeTexto?: string;
  botoes?: WABotaoTemplate[];
}

export const WA_STATUS_TEMPLATE_LABELS: Record<WAStatusTemplate, string> = {
  APPROVED: "Aprovado",
  PENDING: "Em análise",
  REJECTED: "Rejeitado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
  IN_APPEAL: "Em recurso",
  PENDING_DELETION: "Exclusão pendente",
};

export const WA_STATUS_TEMPLATE_CORES: Record<WAStatusTemplate, string> = {
  APPROVED: "text-emerald-700 bg-emerald-50 border-emerald-200",
  PENDING: "text-amber-700 bg-amber-50 border-amber-200",
  REJECTED: "text-red-700 bg-red-50 border-red-200",
  PAUSED: "text-orange-700 bg-orange-50 border-orange-200",
  DISABLED: "text-gray-600 bg-gray-50 border-gray-200",
  IN_APPEAL: "text-blue-700 bg-blue-50 border-blue-200",
  PENDING_DELETION: "text-gray-600 bg-gray-50 border-gray-200",
};

export const WA_CATEGORIA_TEMPLATE_LABELS: Record<WACategoriaTemplate, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

export const WA_IDIOMAS_TEMPLATE: { code: string; label: string }[] = [
  { code: "pt_BR", label: "Português (Brasil)" },
  { code: "pt_PT", label: "Português (Portugal)" },
  { code: "en_US", label: "Inglês (EUA)" },
  { code: "es", label: "Espanhol" },
  { code: "es_AR", label: "Espanhol (Argentina)" },
];

/**
 * Conta quantas variáveis posicionais ({{1}}, {{2}}...) existem num texto de
 * template. A Meta exige um exemplo pra cada variável na criação.
 *
 * Retorna o MAIOR índice encontrado (não a contagem de ocorrências): "{{1}} e
 * {{1}} de novo, mais {{2}}" → 2. Isso reflete quantos parâmetros distintos o
 * template espera no envio.
 */
export function contarVariaveisTemplate(texto: string): number {
  if (!texto) return 0;
  let maior = 0;
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > maior) maior = n;
  }
  return maior;
}

/**
 * Valida o nome de um template segundo as regras da Meta: apenas letras
 * minúsculas, números e underscore, até 512 caracteres. Retorna `null` se
 * válido ou uma mensagem de erro acionável.
 */
export function validarNomeTemplate(nome: string): string | null {
  if (!nome || !nome.trim()) return "Informe um nome para o template.";
  if (nome.length > 512) return "Nome muito longo (máximo 512 caracteres).";
  if (!/^[a-z0-9_]+$/.test(nome)) {
    return "Nome inválido: use apenas letras minúsculas, números e underscore (_), sem espaços ou acentos.";
  }
  return null;
}

// ─── Business Profile ────────────────────────────────────────────────────────

export type WAVerticalNegocio =
  | "UNDEFINED"
  | "OTHER"
  | "AUTO"
  | "BEAUTY"
  | "APPAREL"
  | "EDU"
  | "ENTERTAIN"
  | "EVENT_PLAN"
  | "FINANCE"
  | "GROCERY"
  | "GOVT"
  | "HOTEL"
  | "HEALTH"
  | "NONPROFIT"
  | "PROF_SERVICES"
  | "RETAIL"
  | "TRAVEL"
  | "RESTAURANT"
  | "NOT_A_BIZ";

export interface WABusinessProfile {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  vertical?: WAVerticalNegocio;
  websites?: string[];
  profile_picture_url?: string;
}

export const WA_VERTICAIS_LABELS: { value: WAVerticalNegocio; label: string }[] = [
  { value: "PROF_SERVICES", label: "Serviços profissionais" },
  { value: "FINANCE", label: "Finanças" },
  { value: "EDU", label: "Educação" },
  { value: "HEALTH", label: "Saúde" },
  { value: "GOVT", label: "Governo" },
  { value: "NONPROFIT", label: "Sem fins lucrativos" },
  { value: "RETAIL", label: "Varejo" },
  { value: "OTHER", label: "Outro" },
  { value: "UNDEFINED", label: "Não definido" },
];

// ─── Mensagens interativas ───────────────────────────────────────────────────

export interface WABotaoResposta {
  /** ID retornado no webhook quando o usuário clica. Até 256 chars. */
  id: string;
  /** Texto exibido no botão. Até 20 chars. */
  titulo: string;
}

export interface WAItemLista {
  id: string;
  titulo: string;
  descricao?: string;
}

export interface WASecaoLista {
  titulo: string;
  itens: WAItemLista[];
}
