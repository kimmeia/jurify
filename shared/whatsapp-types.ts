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

/**
 * Formata JID para número de telefone limpo.
 *
 * IMPORTANTE: WhatsApp tem 2 tipos de identificadores:
 *   1. Phone Number (PN): "5511999999999@s.whatsapp.net" — número real
 *   2. Linked ID (LID):  "123456789012345@lid"          — id interno opaco
 *
 * Quando um contato responde, dependendo da versão do WhatsApp e do protocolo
 * de criptografia, o JID pode vir como LID. O número do LID NÃO é um telefone
 * — usar isso como `telefone` causa duplicação de contato.
 *
 * Esta função retorna apenas a parte numérica de JIDs do tipo PN, ou string
 * vazia para LIDs (que devem ser tratados pelo chamador via senderPn/lookups).
 */
export function jidToPhone(jid: string): string {
  if (!jid) return "";
  // LID não é um telefone — caller deve usar senderPn ou lookup por chatId
  if (jid.endsWith("@lid")) return "";
  return jid
    .replace(/@s\.whatsapp\.net$/, "")
    .replace(/@g\.us$/, "")
    .replace(/@.*$/, ""); // Catch-all para qualquer outro sufixo
}

/** Verifica se um JID é do tipo LID (linked id, não-telefone) */
export function isLidJid(jid: string): boolean {
  return !!jid && jid.endsWith("@lid");
}

/** Formata número de telefone para JID */
export function phoneToJid(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  return `${clean}@s.whatsapp.net`;
}

/**
 * Normaliza um número brasileiro:
 *   - Remove tudo que não for dígito
 *   - Garante prefixo 55 (Brasil) se não tiver
 *   - Garante o "9" do celular após DDD se faltar
 *
 * Aceita formatos:
 *   "85999990000"          -> "5585999990000"
 *   "(85) 99999-0000"      -> "5585999990000"
 *   "+55 85 99999-0000"    -> "5585999990000"
 *   "5585999990000"        -> "5585999990000"
 */
export function normalizePhoneBR(input: string): string {
  let clean = (input || "").replace(/\D/g, "");
  if (!clean) return "";
  // Se começar com 0, remover (acesso de longa distância)
  if (clean.startsWith("0")) clean = clean.slice(1);
  // Se não tem DDI, adiciona 55
  if (clean.length === 10 || clean.length === 11) {
    clean = "55" + clean;
  }
  return clean;
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
