/**
 * Travas de envio WhatsApp (mensagem iniciada pela empresa) pra evitar que o
 * escritório seja marcado como spam pela Meta e tenha a conta restrita (erro
 * 131031 "Business account has been locked" e afins) — como ocorreu em jul/2026,
 * resultando em 30 dias de restrição.
 *
 * IMPORTANTE: essas travas cobrem TODOS os disparos proativos (template, texto
 * livre e interativo). O disjuntor, especificamente, cobre TODO envio — inclusive
 * resposta manual — porque com a conta restrita pela Meta nenhum envio deve sair.
 *
 * Quatro camadas, aplicadas em `podeEnviar` antes de cada disparo:
 *
 *  1. DISJUNTOR (circuit breaker). Ao detectar restrição/spam da Meta — síncrono
 *     no envio, assíncrono no webhook `failed`, OU no webhook `account_update` de
 *     restrição de conta — marca o canal como restrito (`canais_integrados.
 *     restritoMeta`) e PAUSA os envios. Auto-cura: envio bem-sucedido ou
 *     reativação manual limpa a flag. Aplicado a TODO envio.
 *
 *  2. TETO DIÁRIO (persistido). Contador por canal alinhado ao messaging tier da
 *     Meta (250/1k/10k/100k por 24h). Sobrevive a restart/multi-instância — é a
 *     trava que casa com o limite real que a Meta impõe e que causa o ban quando
 *     estourado. Só conta disparo PROATIVO (iniciado pela empresa).
 *
 *  3. RATE LIMIT em memória (rajada curta). Teto por minuto/hora — mata o surto
 *     de teste repetido e o loop acidental antes de tocar a Meta. Só conta
 *     disparo PROATIVO.
 *
 *  4. OPT-IN. Disparo automático só sai pra contato que já iniciou conversa OU
 *     tem relação transacional (cliente Asaas). Mensagem "fria" iniciada pela
 *     empresa pra estranho é justamente o que a Meta trata como spam.
 */

import { canaisIntegrados, mensagens, conversas, asaasClientes } from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
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

// ─── Teto diário por messaging tier (persistido) ────────────────────────────

/**
 * Traduz o messaging_limit_tier da Meta no teto de conversas iniciadas pela
 * empresa por 24h. Sem tier conhecido, assume TIER_1K (conservador — o suficiente
 * pra não perder cobrança legítima; o excedente é reagendado, não descartado).
 */
export function limiteDiarioPorTier(tier: string | null | undefined): number {
  switch ((tier || "").toUpperCase()) {
    case "TIER_50": return 50;
    case "TIER_250": return 250;
    case "TIER_1K": return 1_000;
    case "TIER_10K": return 10_000;
    case "TIER_100K": return 100_000;
    case "TIER_UNLIMITED": return Number.POSITIVE_INFINITY;
    default: return 1_000;
  }
}

/** Bucket YYYY-MM-DD (UTC) do instante — chave de reset do contador diário. */
export function bucketDia(agoraMs: number): string {
  return new Date(agoraMs).toISOString().slice(0, 10);
}

export interface EstadoCanal {
  restrito: boolean;
  motivo?: string;
  disparosDia: number;
  disparosDiaEm: string | null;
  tier: string | null;
}

/**
 * Verifica (sem registrar) se o canal ainda cabe no teto diário. Se o bucket do
 * dia virou, o contador é tratado como 0 (será resetado no registro do disparo).
 * Pura — `agoraMs` injetável pra teste.
 */
export function verificarLimiteDiario(
  estado: Pick<EstadoCanal, "disparosDia" | "disparosDiaEm" | "tier">,
  agoraMs: number,
): { ok: boolean; motivo?: string } {
  const limite = limiteDiarioPorTier(estado.tier);
  if (!Number.isFinite(limite)) return { ok: true };
  const hoje = bucketDia(agoraMs);
  const usadosHoje = estado.disparosDiaEm === hoje ? Number(estado.disparosDia || 0) : 0;
  if (usadosHoje >= limite) {
    return { ok: false, motivo: `teto diário de ${limite} disparos/24h atingido (tier Meta)` };
  }
  return { ok: true };
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
 * Verifica (sem registrar) se o canal pode disparar mais um proativo agora.
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
    return { ok: false, motivo: `limite de ${limites.minuto} disparos/minuto atingido` };
  }
  if (recentes.length >= limites.hora) {
    return { ok: false, motivo: `limite de ${limites.hora} disparos/hora atingido` };
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
 * Contato deu sinal de consentimento pra receber disparo proativo? Duas bases:
 *
 *  1. USER-INITIATED: já existe ≥1 mensagem RECEBIDA dele (ele escreveu pra
 *     gente). Sinal que a política do WhatsApp reconhece pra qualquer template.
 *
 *  2. RELAÇÃO TRANSACIONAL: é cliente com vínculo de cobrança (Asaas). Base de
 *     consentimento pra template UTILITY (status de pagamento, lembrete de
 *     vencimento) — a Meta permite mensagem utilitária a quem tem transação com
 *     a empresa. É o caso de uso legítimo do escritório.
 *
 * Cold pra estranho (sem inbound E sem cobrança) continua barrado.
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

// ─── Disjuntor + estado do canal (persistido em canais_integrados) ──────────

/**
 * Carrega o estado anti-ban do canal numa única query: disjuntor + contador
 * diário + tier. Base do `podeEnviar` (evita N selects).
 */
export async function carregarEstadoCanal(db: any, canalId: number): Promise<EstadoCanal> {
  const [c] = await db
    .select({
      restrito: canaisIntegrados.restritoMeta,
      motivo: canaisIntegrados.restritoMotivo,
      disparosDia: canaisIntegrados.disparosDia,
      disparosDiaEm: canaisIntegrados.disparosDiaEm,
      tier: canaisIntegrados.tierMensagens,
    })
    .from(canaisIntegrados)
    .where(eq(canaisIntegrados.id, canalId))
    .limit(1);
  return {
    restrito: !!c?.restrito,
    motivo: c?.motivo || undefined,
    disparosDia: Number(c?.disparosDia || 0),
    disparosDiaEm: c?.disparosDiaEm ?? null,
    tier: c?.tier ?? null,
  };
}

export async function canalEstaRestrito(
  db: any,
  canalId: number,
): Promise<{ restrito: boolean; motivo?: string }> {
  const e = await carregarEstadoCanal(db, canalId);
  return { restrito: e.restrito, motivo: e.motivo };
}

/** Tripa o disjuntor: marca o canal como restrito pela Meta. Idempotente. */
export async function marcarCanalRestrito(db: any, canalId: number, motivo: string): Promise<void> {
  await db
    .update(canaisIntegrados)
    .set({ restritoMeta: true, restritoMotivo: motivo.slice(0, 500), restritoEm: new Date() })
    .where(eq(canaisIntegrados.id, canalId));
  log.warn({ canalId, motivo: motivo.slice(0, 120) }, "[Guard] canal marcado como RESTRITO pela Meta — envios pausados");
}

/** Rearma o disjuntor: canal voltou a poder enviar (sucesso ou reativação). */
export async function limparCanalRestrito(db: any, canalId: number): Promise<void> {
  await db
    .update(canaisIntegrados)
    .set({ restritoMeta: false, restritoMotivo: null, restritoEm: null })
    .where(and(eq(canaisIntegrados.id, canalId), eq(canaisIntegrados.restritoMeta, true)));
}

/**
 * Incrementa (atômico) o contador diário persistido de disparos proativos.
 * O CASE reseta o contador quando o bucket do dia virou — sem race de
 * read-modify-write. Chamado só quando o disparo proativo de fato saiu.
 */
export async function incrementarDisparoDia(db: any, canalId: number, agoraMs: number): Promise<void> {
  const hoje = bucketDia(agoraMs);
  await db
    .update(canaisIntegrados)
    .set({
      disparosDia: sql`CASE WHEN ${canaisIntegrados.disparosDiaEm} = ${hoje} THEN ${canaisIntegrados.disparosDia} + 1 ELSE 1 END`,
      disparosDiaEm: hoje,
    })
    .where(eq(canaisIntegrados.id, canalId));
}

// ─── Orquestrador ────────────────────────────────────────────────────────────

export type MotivoBloqueio = "restrito" | "diario" | "rate" | "optin";

/**
 * Decide se um envio PODE sair agora. Ordem: disjuntor → teto diário → rate
 * limit → opt-in. Retorna erro legível (que vira o status/execução na UI)
 * quando bloqueia. Não registra o disparo — quem envia chama
 * `registrarSucessoEnvio` no sucesso.
 *
 * - `proativo`: disparo iniciado pela empresa (SmartFlow/scheduler/template).
 *   Ativa teto diário + rate limit. Resposta manual/auto-reply passa `false` —
 *   ainda respeita o disjuntor (conta restrita = ninguém envia), mas não conta
 *   contra os tetos de volume.
 * - `exigirOptin`: exige consentimento do contato (fluxos automáticos).
 */
export async function podeEnviar(opts: {
  db: any;
  canalId?: number;
  contatoId?: number;
  proativo?: boolean;
  exigirOptin?: boolean;
  agoraMs?: number;
}): Promise<{ ok: true } | { ok: false; erro: string; tipo: MotivoBloqueio }> {
  const agoraMs = opts.agoraMs ?? Date.now();

  if (opts.canalId) {
    const estado = await carregarEstadoCanal(opts.db, opts.canalId);

    // Disjuntor — sempre. Conta restrita = nenhum envio (proativo ou não).
    if (estado.restrito) {
      return {
        ok: false,
        tipo: "restrito",
        erro: `Conta WhatsApp restrita pela Meta${estado.motivo ? ` (${estado.motivo})` : ""} — envios pausados até a liberação.`,
      };
    }

    if (opts.proativo) {
      const diario = verificarLimiteDiario(estado, agoraMs);
      if (!diario.ok) {
        return {
          ok: false,
          tipo: "diario",
          erro: `Envio adiado: ${diario.motivo}. Excedente reagendado pra não estourar o limite da Meta.`,
        };
      }
      const rl = verificarRateLimit(opts.canalId, agoraMs);
      if (!rl.ok) {
        return {
          ok: false,
          tipo: "rate",
          erro: `Envio adiado: ${rl.motivo}. Evita rajada que a Meta classifica como spam.`,
        };
      }
    }
  }

  if (opts.exigirOptin && opts.contatoId) {
    const consent = await contatoTemConsentimento(opts.db, opts.contatoId);
    if (!consent) {
      return {
        ok: false,
        tipo: "optin",
        erro: "Contato sem opt-in: nunca iniciou conversa no WhatsApp. Envio bloqueado (evita spam) — peça o cliente iniciar a conversa ou registre o consentimento.",
      };
    }
  }

  return { ok: true };
}

/**
 * Compat: gate específico de template. Template é SEMPRE proativo (mensagem
 * iniciada pela empresa). Delega pra `podeEnviar`.
 */
export async function podeDispararTemplate(opts: {
  db: any;
  canalId?: number;
  contatoId?: number;
  exigirOptin?: boolean;
  agoraMs?: number;
}): Promise<{ ok: true } | { ok: false; erro: string; tipo: MotivoBloqueio }> {
  return podeEnviar({ ...opts, proativo: true });
}

/**
 * Pós-envio bem-sucedido: registra o disparo nos tetos (só se proativo) e, se o
 * canal estava restrito, rearma o disjuntor (a Meta voltou a aceitar). Chamado
 * só em sucesso.
 */
export async function registrarSucessoEnvio(opts: {
  db: any;
  canalId?: number;
  proativo?: boolean;
  agoraMs?: number;
}): Promise<void> {
  if (!opts.canalId) return;
  const agoraMs = opts.agoraMs ?? Date.now();
  if (opts.proativo) {
    registrarDisparoRate(opts.canalId, agoraMs);
    await incrementarDisparoDia(opts.db, opts.canalId, agoraMs);
  }
  await limparCanalRestrito(opts.db, opts.canalId);
}

/** Compat: sucesso de template (sempre proativo). */
export async function registrarSucessoTemplate(opts: {
  db: any;
  canalId?: number;
  agoraMs?: number;
}): Promise<void> {
  return registrarSucessoEnvio({ ...opts, proativo: true });
}

/**
 * Pós-falha: se o erro da Meta indica restrição, tripa o disjuntor. Usado no
 * envio síncrono (canal-envio/router-crm), no webhook `failed` (131031
 * assíncrono) e no webhook `account_update`. Retorna true se tripou.
 */
export async function registrarFalhaEnvio(opts: {
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

/** Compat: falha de template. */
export async function registrarFalhaTemplate(opts: {
  db: any;
  canalId?: number;
  erro: string | null | undefined;
}): Promise<boolean> {
  return registrarFalhaEnvio(opts);
}
