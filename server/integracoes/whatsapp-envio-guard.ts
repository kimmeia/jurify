/**
 * Travas de envio de template WhatsApp (mensagem iniciada pela empresa) pra
 * evitar que o escritório seja marcado como spam pela Meta e tenha a conta
 * restrita (erro 131031 "Business account has been locked" e afins) — como
 * ocorreu em jul/2026, resultando em 30 dias de restrição.
 *
 * Três camadas independentes, aplicadas antes de cada disparo de template:
 *
 *  1. DISJUNTOR (circuit breaker). Ao detectar um código de restrição/spam da
 *     Meta — síncrono no envio OU assíncrono no webhook `failed` — marca o
 *     canal como restrito (`canais_integrados.restritoMeta`) e PAUSA novos
 *     templates até liberar. Sem isso o sistema martelava a Meta com envios que
 *     voltavam 131031, agravando a reputação. Auto-cura: envio bem-sucedido ou
 *     reativação manual limpa a flag.
 *
 *  2. RATE LIMIT. Teto de disparos por canal em janelas curtas — mata o surto
 *     de teste repetido (a causa raiz do incidente) e disparo em massa
 *     acidental. Em memória por processo: suficiente pra travar rajadas; o
 *     disjuntor persistido é a rede de segurança real entre restarts.
 *
 *  3. OPT-IN. Template só sai pra contato que já iniciou conversa (sinal de
 *     consentimento). Template "frio" iniciado pela empresa é justamente o que
 *     a Meta trata como spam.
 */

import { canaisIntegrados, mensagens, conversas, asaasClientes } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { createLogger } from "../_core/logger";

const log = createLogger("whatsapp-envio-guard");

/**
 * Códigos de erro da Meta que indicam restrição de conta / spam / violação de
 * política — tripam o disjuntor. NÃO inclui limites "saudáveis" por
 * destinatário (131049/130497 = teto de marketing por usuário, normais) nem
 * erros de configuração — esses não são restrição de conta.
 */
export const META_CODIGOS_RESTRICAO = new Set<number>([
  131031, // Business account has been locked (restrição de conta)
  368, // Temporarily blocked for policies violations
  131048, // Spam rate limit hit (qualidade/spam)
]);

/**
 * Extrai indício de restrição de uma mensagem de erro da Meta. Formato típico
 * vindo do webhook/canal-envio: "131031: Business account has been locked".
 * Casa por CÓDIGO (primeiro número da string) e, como reforço, por TEXTO
 * (conta bloqueada/restrita/violação). Retorna null quando não é restrição.
 */
export function detectarRestricaoMeta(
  erro: string | null | undefined,
): { codigo: number; motivo: string } | null {
  if (!erro) return null;
  const s = String(erro);
  const m = s.match(/\b(\d{2,6})\b/);
  const codigo = m ? parseInt(m[1], 10) : NaN;
  const porCodigo = !Number.isNaN(codigo) && META_CODIGOS_RESTRICAO.has(codigo);
  const porTexto =
    /account has been locked|account.*restrict|conta.*(bloquead|restrit)|policy violation|viola(ç|c)(ã|a)o.*(termos|pol[íi]tica)|sending spam/i.test(
      s,
    );
  if (porCodigo || porTexto) {
    return { codigo: Number.isNaN(codigo) ? 0 : codigo, motivo: s.slice(0, 500) };
  }
  return null;
}

// ─── Rate limit (janela deslizante em memória, por canal) ───────────────────

const LIMITE_POR_MINUTO = 10;
const LIMITE_POR_HORA = 200;
const UMA_HORA_MS = 60 * 60 * 1000;
const UM_MINUTO_MS = 60 * 1000;

/** canalId -> timestamps(ms) dos disparos recentes (até 1h). */
const disparosPorCanal = new Map<number, number[]>();

export interface LimitesRate {
  minuto: number;
  hora: number;
}

/**
 * Verifica (sem registrar) se o canal pode disparar mais um template agora.
 * `agoraMs` é injetável pra teste determinístico.
 */
export function verificarRateLimit(
  canalId: number,
  agoraMs: number,
  limites: LimitesRate = { minuto: LIMITE_POR_MINUTO, hora: LIMITE_POR_HORA },
): { ok: boolean; motivo?: string } {
  const recentes = (disparosPorCanal.get(canalId) || []).filter((t) => agoraMs - t < UMA_HORA_MS);
  const noMinuto = recentes.filter((t) => agoraMs - t < UM_MINUTO_MS).length;
  if (noMinuto >= limites.minuto) {
    return { ok: false, motivo: `limite de ${limites.minuto} templates/minuto atingido` };
  }
  if (recentes.length >= limites.hora) {
    return { ok: false, motivo: `limite de ${limites.hora} templates/hora atingido` };
  }
  return { ok: true };
}

/** Registra um disparo pro rate limit (chamado só quando o envio de fato saiu). */
export function registrarDisparoRate(canalId: number, agoraMs: number): void {
  const recentes = (disparosPorCanal.get(canalId) || []).filter((t) => agoraMs - t < UMA_HORA_MS);
  recentes.push(agoraMs);
  disparosPorCanal.set(canalId, recentes);
}

/** Limpa o estado do rate limit — só pra testes. */
export function _resetRateLimit(): void {
  disparosPorCanal.clear();
}

// ─── Opt-in / consentimento ─────────────────────────────────────────────────

/**
 * Contato deu sinal de consentimento pra receber template? Duas bases válidas:
 *
 *  1. USER-INITIATED: já existe ≥1 mensagem RECEBIDA dele (ele escreveu pra
 *     gente). Sinal que a política do WhatsApp reconhece pra qualquer template.
 *
 *  2. RELAÇÃO TRANSACIONAL: é cliente com vínculo de cobrança (Asaas). É a base
 *     de consentimento pra template UTILITY (status de pagamento, lembrete de
 *     vencimento) — a Meta permite mensagem utilitária a quem tem transação com
 *     a empresa. É o caso de uso legítimo do escritório.
 *
 * Cold template pra estranho (sem inbound E sem cobrança) continua barrado — é
 * o padrão que a Meta trata como spam.
 */
export async function contatoTemConsentimento(db: any, contatoId: number): Promise<boolean> {
  const inbound = await db
    .select({ id: mensagens.id })
    .from(mensagens)
    .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
    .where(and(eq(conversas.contatoId, contatoId), eq(mensagens.direcao, "entrada")))
    .limit(1);
  if (inbound.length > 0) return true;

  const cliente = await db
    .select({ id: asaasClientes.id })
    .from(asaasClientes)
    .where(eq(asaasClientes.contatoId, contatoId))
    .limit(1);
  return cliente.length > 0;
}

// ─── Disjuntor (persistido em canais_integrados) ────────────────────────────

export async function canalEstaRestrito(
  db: any,
  canalId: number,
): Promise<{ restrito: boolean; motivo?: string }> {
  const [c] = await db
    .select({ restrito: canaisIntegrados.restritoMeta, motivo: canaisIntegrados.restritoMotivo })
    .from(canaisIntegrados)
    .where(eq(canaisIntegrados.id, canalId))
    .limit(1);
  return { restrito: !!c?.restrito, motivo: c?.motivo || undefined };
}

/** Tripa o disjuntor: marca o canal como restrito pela Meta. Idempotente. */
export async function marcarCanalRestrito(db: any, canalId: number, motivo: string): Promise<void> {
  await db
    .update(canaisIntegrados)
    .set({ restritoMeta: true, restritoMotivo: motivo.slice(0, 500), restritoEm: new Date() })
    .where(eq(canaisIntegrados.id, canalId));
  log.warn({ canalId, motivo: motivo.slice(0, 120) }, "[Guard] canal marcado como RESTRITO pela Meta — templates pausados");
}

/** Rearma o disjuntor: canal voltou a poder enviar (sucesso ou reativação). */
export async function limparCanalRestrito(db: any, canalId: number): Promise<void> {
  await db
    .update(canaisIntegrados)
    .set({ restritoMeta: false, restritoMotivo: null, restritoEm: null })
    .where(and(eq(canaisIntegrados.id, canalId), eq(canaisIntegrados.restritoMeta, true)));
}

// ─── Orquestrador ────────────────────────────────────────────────────────────

/**
 * Decide se um template PODE ser disparado agora. Ordem: disjuntor → rate
 * limit → opt-in. Retorna erro legível (que vira o status/execução na UI)
 * quando bloqueia. Não registra o disparo — quem envia chama
 * `registrarDisparoRate` no sucesso.
 */
export async function podeDispararTemplate(opts: {
  db: any;
  canalId?: number;
  contatoId?: number;
  /** Exige opt-in do contato (fluxos automáticos). Envio manual do operador não exige. */
  exigirOptin?: boolean;
  agoraMs?: number;
}): Promise<{ ok: true } | { ok: false; erro: string; tipo: "restrito" | "rate" | "optin" }> {
  const agoraMs = opts.agoraMs ?? Date.now();

  if (opts.canalId) {
    const r = await canalEstaRestrito(opts.db, opts.canalId);
    if (r.restrito) {
      return {
        ok: false,
        tipo: "restrito",
        erro: `Conta WhatsApp restrita pela Meta${r.motivo ? ` (${r.motivo})` : ""} — envios de template pausados até a liberação.`,
      };
    }
    const rl = verificarRateLimit(opts.canalId, agoraMs);
    if (!rl.ok) {
      return {
        ok: false,
        tipo: "rate",
        erro: `Envio pausado: ${rl.motivo}. Evita rajada que a Meta classifica como spam.`,
      };
    }
  }

  if (opts.exigirOptin && opts.contatoId) {
    const consent = await contatoTemConsentimento(opts.db, opts.contatoId);
    if (!consent) {
      return {
        ok: false,
        tipo: "optin",
        erro: "Contato sem opt-in: nunca iniciou conversa no WhatsApp. Template não enviado (evita spam) — peça o cliente iniciar a conversa ou registre o consentimento.",
      };
    }
  }

  return { ok: true };
}

/**
 * Pós-envio: registra o disparo pro rate limit e, se o canal estava restrito,
 * rearma o disjuntor (a Meta voltou a aceitar). Chamado só em sucesso.
 */
export async function registrarSucessoTemplate(opts: {
  db: any;
  canalId?: number;
  agoraMs?: number;
}): Promise<void> {
  if (!opts.canalId) return;
  registrarDisparoRate(opts.canalId, opts.agoraMs ?? Date.now());
  await limparCanalRestrito(opts.db, opts.canalId);
}

/**
 * Pós-falha: se o erro da Meta indica restrição, tripa o disjuntor. Usado tanto
 * no envio síncrono (canal-envio/router-crm) quanto no webhook de status
 * `failed` (onde chega o 131031 assíncrono). Retorna true se tripou.
 */
export async function registrarFalhaTemplate(opts: {
  db: any;
  canalId?: number;
  erro: string | null | undefined;
}): Promise<boolean> {
  if (!opts.canalId) return false;
  const restr = detectarRestricaoMeta(opts.erro);
  if (!restr) return false;
  await marcarCanalRestrito(opts.db, opts.canalId, restr.motivo);
  return true;
}
