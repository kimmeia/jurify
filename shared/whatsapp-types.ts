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
 * Gera as variantes de um número BR pra resolução de JID no WhatsApp.
 *
 * Quirk: alguns números BR de celular existem no servidor do WhatsApp APENAS
 * sem o "9" antecipado (registros antigos pré-2012, ou contas migradas que
 * nunca atualizaram). Mandar pra `5585999999999@s.whatsapp.net` dá erro de
 * "no such user" — o JID válido é `558599999999@s.whatsapp.net`.
 *
 * Esta função recebe um número limpo e devolve as duas variantes possíveis
 * (com e sem o 9), pra serem testadas via `socket.onWhatsApp([...])`. A
 * primeira variante do array é a "preferida" (versão moderna com 9 quando
 * a entrada já tem 13 dígitos; sem 9 quando entrada tem 12).
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
 * Resolve o JID válido pra um número de telefone consultando o servidor do
 * WhatsApp via `socket.onWhatsApp([variantes])`. Resolve a quirk dos números
 * BR sem "9" antecipado (ver `phoneVariantsBR`).
 *
 * Retorna:
 *   - JID com `@s.whatsapp.net` quando o número está registrado
 *   - `null` quando NENHUMA variante existe no WhatsApp (cliente não tem)
 *
 * Cache em memória (TTL 1h) — evita chamada extra a cada mensagem pro mesmo
 * número. Cache por número canônico (mesma resolução pra todos os formatos).
 *
 * `socket` aqui é o WASocket do Baileys (tipado como `any` porque o import
 * dinâmico não dá pra tipar sem trazer Baileys pra `shared/`).
 */
const jidCache = new Map<string, { jid: string | null; expiresAt: number }>();
const JID_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

export async function resolverJidValido(
  socket: { onWhatsApp: (numbers: string[]) => Promise<Array<{ exists: boolean; jid: string }>> },
  phone: string,
): Promise<string | null> {
  const variantes = phoneVariantsBR(phone);
  if (variantes.length === 0) return null;

  // Cache lookup pela primeira variante (canônica)
  const cacheKey = variantes[0];
  const cached = jidCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.jid;
  }

  try {
    // onWhatsApp aceita lista — Baileys consulta o servidor numa só round-trip
    const results = await socket.onWhatsApp(variantes);
    const valido = (results || []).find((r) => r?.exists)?.jid || null;
    jidCache.set(cacheKey, { jid: valido, expiresAt: Date.now() + JID_CACHE_TTL_MS });
    return valido;
  } catch {
    // Em caso de erro de rede, faz fallback pro JID da variante preferida.
    // Não cacheia (pode ser falha temporária).
    return `${variantes[0]}@s.whatsapp.net`;
  }
}

/** Limpa o cache de resolução de JID. Útil em testes ou quando o user reconecta. */
export function limparCacheJid(): void {
  jidCache.clear();
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
