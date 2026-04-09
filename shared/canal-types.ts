/**
 * Tipos compartilhados — Canais de Integração
 * Fase 2: WhatsApp, Instagram, Facebook, VoIP
 */

export type TipoCanal = "whatsapp_qr" | "whatsapp_api" | "instagram" | "facebook" | "telefone_voip" | "calcom" | "chatgpt";
export type StatusCanal = "conectado" | "desconectado" | "pendente" | "erro" | "banido";

export const TIPO_CANAL_LABELS: Record<TipoCanal, string> = {
  whatsapp_qr: "WhatsApp (QR Code)",
  whatsapp_api: "WhatsApp (API Oficial)",
  instagram: "Instagram",
  facebook: "Facebook Messenger",
  telefone_voip: "Telefone (VoIP)",
  calcom: "Cal.com (Agendamento)",
  chatgpt: "OpenAI / ChatGPT",
};

export const TIPO_CANAL_DESCRICAO: Record<TipoCanal, string> = {
  whatsapp_qr: "Conexão via QR Code — gratuita, sem custo por mensagem. Indicada para baixo volume.",
  whatsapp_api: "API Oficial Meta — robusta, sem risco de ban. Custo por conversa (~R$ 0,30).",
  instagram: "Mensagens diretas do Instagram via Meta Graph API.",
  facebook: "Messenger da página do Facebook via Meta Graph API.",
  telefone_voip: "Ligações telefônicas via Twilio — gravação e transcrição disponíveis.",
  calcom: "Agendamento online integrado ao CRM.",
  chatgpt: "API Key OpenAI para agentes de IA.",
};

export const TIPO_CANAL_ICONE: Record<TipoCanal, string> = {
  whatsapp_qr: "MessageCircle",
  whatsapp_api: "MessageCircle",
  instagram: "Instagram",
  facebook: "Facebook",
  telefone_voip: "Phone",
  calcom: "Calendar",
  chatgpt: "Bot",
};

export const STATUS_CANAL_LABELS: Record<StatusCanal, string> = {
  conectado: "Conectado",
  desconectado: "Desconectado",
  pendente: "Pendente",
  erro: "Erro",
  banido: "Banido",
};

export const STATUS_CANAL_CORES: Record<StatusCanal, string> = {
  conectado: "text-emerald-600 bg-emerald-50 border-emerald-200",
  desconectado: "text-gray-600 bg-gray-50 border-gray-200",
  pendente: "text-amber-600 bg-amber-50 border-amber-200",
  erro: "text-red-600 bg-red-50 border-red-200",
  banido: "text-red-800 bg-red-100 border-red-300",
};

/** Campos de configuração por tipo de canal (para o formulário) */
export interface ConfigWhatsappQR {
  // Sem config manual — sessão gerida pelo servidor via Baileys
}

export interface ConfigWhatsappAPI {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  businessAccountId: string;
}

export interface ConfigInstagram {
  pageId: string;
  accessToken: string;
}

export interface ConfigFacebook {
  pageId: string;
  accessToken: string;
}

export interface ConfigVoIP {
  twilioSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
}

export interface CanalInfo {
  id: number;
  escritorioId: number;
  tipo: TipoCanal;
  nome: string;
  status: StatusCanal;
  telefone?: string;
  ultimaSync?: string;
  mensagemErro?: string;
  createdAt: string;
}
