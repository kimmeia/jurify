/**
 * Tipos compartilhados — WhatsApp
 */

export interface WhatsappMensagemRecebida {
  chatId: string; // jid do remetente (ex: 5511999999999@s.whatsapp.net)
  nome: string;
  telefone: string;
  conteudo: string;
  tipo: "texto" | "imagem" | "audio" | "video" | "documento" | "sticker" | "localizacao" | "contato" | "sistema";
  mediaUrl?: string;
  timestamp: number;
  messageId: string;
  isGroup: boolean;
  quotedMessageId?: string;
  // Resposta a mensagem interativa (botão clicado ou item de lista selecionado).
  // Preenchido SÓ quando o webhook recebe `type=interactive` da Cloud API.
  // O ID é o que foi definido no envio (`buttonReply.id` / `listReply.id`) —
  // usado pelo engine SmartFlow pra rotear sem ambiguidade (sem regex de
  // título/número, que erra com emoji ou typo).
  interactiveReply?: {
    tipo: "button" | "list";
    id: string;
    titulo: string;
  };
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
 * Gera as variantes de um número BR pra resolução de JID no WhatsApp.
 *
 * Quirk: alguns números BR de celular existem no servidor do WhatsApp APENAS
 * sem o "9" antecipado (registros antigos pré-2012, ou contas migradas que
 * nunca atualizaram). Mandar pra `5585999999999@s.whatsapp.net` dá erro de
 * "no such user" — o JID válido é `558599999999@s.whatsapp.net`.
 *
 * Esta função recebe um número limpo e devolve as duas variantes possíveis
 * (com e sem o 9). A primeira variante do array é a "preferida" (versão
 * moderna com 9 quando a entrada já tem 13 dígitos; sem 9 quando entrada
 * tem 12).
 *
 * Exemplos:
 *   "5585999999999"  → ["5585999999999", "558599999999"]
 *   "558599999999"   → ["558599999999", "5585999999999"]
 *   "5511987654321"  → ["5511987654321", "551187654321"]
 *   "12025551234"    → ["12025551234"] (não-BR, sem variante)
 *   "85999999999"    → ["5585999999999", "558599999999"] (faltava DDI 55)
 */
export function phoneVariantsBR(phone: string): string[] {
  const clean = (phone || "").replace(/\D/g, "");
  if (!clean) return [];

  // Heurística pra reconhecer um número como BR:
  //   • Já tem DDI 55 (12 ou 13 dígitos com prefixo "55")        → BR confirmado
  //   • 10/11 dígitos sem prefixo "1" (DDI dos EUA/Canadá)        → assume BR
  //   • Caso contrário (DDI explícito de outro país, etc)         → passa direto
  // Critério "não começa com 1" evita falso positivo pra números US (DDI 1)
  // de 11 dígitos, que é o conflito mais comum no app brasileiro.
  let canonical: string;
  if (clean.startsWith("55") && (clean.length === 12 || clean.length === 13)) {
    canonical = clean;
  } else if ((clean.length === 10 || clean.length === 11) && !clean.startsWith("1")) {
    canonical = "55" + clean;
  } else {
    return [clean]; // DDI estrangeiro ou formato exótico — passa direto
  }

  // canonical agora tem 12 ou 13 dígitos com prefixo 55.
  const ddd = canonical.slice(2, 4);
  const resto = canonical.slice(4);

  // Variante "com 9": resto começa com "9" + 8 dígitos = 9 dígitos total
  // Variante "sem 9": resto tem 8 dígitos
  let comNove: string;
  let semNove: string;
  if (resto.length === 9 && resto.startsWith("9")) {
    comNove = canonical;
    semNove = `55${ddd}${resto.slice(1)}`;
  } else if (resto.length === 8) {
    semNove = canonical;
    comNove = `55${ddd}9${resto}`;
  } else {
    return [canonical]; // Tamanho fora do esperado — não gera variante
  }

  // Ordem: o original primeiro (preferido), variante depois (fallback)
  return canonical === comNove ? [comNove, semNove] : [semNove, comNove];
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
