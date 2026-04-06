/**
 * Tipos compartilhados — WhatsApp Baileys
 * Etapa 3: Conexão WhatsApp via QR Code com Baileys
 */

export type WhatsappSessionStatus =
  | "aguardando_qr"
  | "conectando"
  | "conectado"
  | "desconectado"
  | "erro"
  | "banido";

export interface WhatsappSessionInfo {
  canalId: number;
  status: WhatsappSessionStatus;
  qrCode?: string; // base64 data URI do QR code
  telefone?: string;
  nomeDispositivo?: string;
  ultimaMensagemAt?: string;
  mensagemErro?: string;
  uptime?: number; // segundos desde conexão
}

export interface WhatsappMensagemRecebida {
  chatId: string; // jid do remetente (ex: 5511999999999@s.whatsapp.net)
  nome: string;
  telefone: string;
  conteudo: string;
  tipo: "texto" | "imagem" | "audio" | "video" | "documento" | "sticker" | "localizacao" | "contato";
  mediaUrl?: string;
  timestamp: number;
  messageId: string;
  isGroup: boolean;
  quotedMessageId?: string;
}

export interface WhatsappMensagemEnviar {
  telefone: string; // formato: 5511999999999
  conteudo: string;
  tipo?: "texto" | "imagem" | "audio" | "documento";
  mediaUrl?: string;
  mediaCaption?: string;
}

export interface WhatsappContatoInfo {
  jid: string;
  nome: string;
  telefone: string;
  imgUrl?: string;
}

export const WHATSAPP_STATUS_LABELS: Record<WhatsappSessionStatus, string> = {
  aguardando_qr: "Aguardando QR Code",
  conectando: "Conectando...",
  conectado: "Conectado",
  desconectado: "Desconectado",
  erro: "Erro",
  banido: "Número Banido",
};

export const WHATSAPP_STATUS_CORES: Record<WhatsappSessionStatus, string> = {
  aguardando_qr: "text-amber-600 bg-amber-50 border-amber-200",
  conectando: "text-blue-600 bg-blue-50 border-blue-200",
  conectado: "text-emerald-600 bg-emerald-50 border-emerald-200",
  desconectado: "text-gray-600 bg-gray-50 border-gray-200",
  erro: "text-red-600 bg-red-50 border-red-200",
  banido: "text-red-800 bg-red-100 border-red-300",
};

/** Formata JID para número de telefone limpo */
export function jidToPhone(jid: string): string {
  // Remover sufixos de JID do WhatsApp
  return jid
    .replace(/@s\.whatsapp\.net$/, "")
    .replace(/@g\.us$/, "")
    .replace(/@lid$/, "")
    .replace(/@.*$/, ""); // Catch-all para qualquer outro sufixo
}

/** Formata número de telefone para JID */
export function phoneToJid(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  return `${clean}@s.whatsapp.net`;
}

/** Formata número BR para exibição: +55 (11) 99999-9999 */
export function formatPhoneBR(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  if (clean.length === 13) {
    return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`;
  }
  if (clean.length === 12) {
    return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 8)}-${clean.slice(8)}`;
  }
  return phone;
}
