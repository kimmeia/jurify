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
 * política — tripam o disjuntor. NÃO inclui limites "saudáveis": 131049 =
 * frequency cap de marketing por usuário; 131056 = rate por par de números;
 * 131026 = destinatário indisponível (ou marketing dropado pelo cap); 130497 =
 * restrição de PAÍS de destino (cross-country) — nenhum é restrição da conta.
 * Também fora: 132015/132016 (template pausado/desativado — problema de UM
 * template, tratado via alerta; tripar aqui pausaria o canal inteiro).
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
 * empresa por 24h. Sem tier conhecido, assume TIER_250 — é o teto real da
 * Meta pra número novo/não verificado. Assumir 1K aqui deixava um número
 * recém-conectado disparar 4× o limite real na 1ª hora (até o health-check
 * sincronizar o tier), queimando a reputação logo no início. O excedente é
 * reagendado, não descartado; quando o tier real chegar, o teto sobe sozinho.
 */
export function limiteDiarioPorTier(tier: string | null | undefined): number {
  switch ((tier || "").toUpperCase()) {
    case "TIER_50": return 50;
    case "TIER_250": return 250;
    case "TIER_1K": return 1_000;
    case "TIER_10K": return 10_000;
    case "TIER_100K": return 100_000;
    case "TIER_UNLIMITED": return Number.POSITIVE_INFINITY;
    default: return 250;
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
  /** quality_rating da Meta (GREEN/YELLOW/RED) — alimenta o freio automático. */
  qualidade: string | null;
  /** Dono do canal — permite resolver contato por telefone dentro do guard. */
  escritorioId: number | null;
}

/**
 * Verifica (sem registrar) se o canal ainda cabe no teto diário. Se o bucket do
 * dia virou, o contador é tratado como 0 (será resetado no registro do disparo).
 * Pura — `agoraMs` injetável pra teste.
 */
export function verificarLimiteDiario(
  estado: Pick<EstadoCanal, "disparosDia" | "disparosDiaEm" | "tier"> & { qualidade?: string | null },
  agoraMs: number,
): { ok: boolean; motivo?: string } {
  const bruto = limiteDiarioPorTier(estado.tier);
  if (!Number.isFinite(bruto)) return { ok: true };
  // Freio por qualidade: YELLOW corta o teto pela metade. A Meta só rebaixa
  // o tier DEPOIS do estrago — reduzir volume no primeiro sinal é o que dá
  // tempo de recuperar o número antes da restrição.
  const amarelo = (estado.qualidade || "").toUpperCase() === "YELLOW";
  const limite = amarelo ? Math.max(1, Math.floor(bruto / 2)) : bruto;
  const hoje = bucketDia(agoraMs);
  const usadosHoje = estado.disparosDiaEm === hoje ? Number(estado.disparosDia || 0) : 0;
  if (usadosHoje >= limite) {
    return {
      ok: false,
      motivo: amarelo
        ? `teto diário reduzido a ${limite} disparos/24h (qualidade AMARELA na Meta)`
        : `teto diário de ${limite} disparos/24h atingido (tier Meta)`,
    };
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
      qualidade: canaisIntegrados.qualidadeMeta,
      escritorioId: canaisIntegrados.escritorioId,
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
    qualidade: c?.qualidade ?? null,
    escritorioId: c?.escritorioId ?? null,
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
  let jaEstavaRestrito = false;
  try {
    jaEstavaRestrito = (await carregarEstadoCanal(db, canalId)).restrito;
  } catch { /* segue — tripar o disjuntor é mais importante que a notificação */ }
  await db
    .update(canaisIntegrados)
    .set({ restritoMeta: true, restritoMotivo: motivo.slice(0, 500), restritoEm: new Date() })
    .where(eq(canaisIntegrados.id, canalId));
  log.warn({ canalId, motivo: motivo.slice(0, 120) }, "[Guard] canal marcado como RESTRITO pela Meta — envios pausados");
  // Só na TRANSIÇÃO (não a cada envio bloqueado) — senão vira spam interno.
  if (!jaEstavaRestrito) {
    try {
      const { notificarSaudeCanal } = await import("./whatsapp-alertas");
      await notificarSaudeCanal({
        canalId,
        titulo: "⛔ WhatsApp pausado — restrição da Meta",
        mensagem: `${motivo.slice(0, 240)} — o disjuntor pausou todos os envios deste canal. Veja Configurações → Canais e trate a restrição antes de reativar.`,
      });
    } catch { /* best-effort */ }
  }
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

export type MotivoBloqueio = "restrito" | "qualidade" | "diario" | "rate" | "optin" | "optout";

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
  /** Telefone do destinatário — fallback pra resolver o contato quando o
   *  caller não trouxe `contatoId` (opt-out não pode depender disso). */
  telefone?: string | null;
  proativo?: boolean;
  exigirOptin?: boolean;
  agoraMs?: number;
}): Promise<{ ok: true } | { ok: false; erro: string; tipo: MotivoBloqueio }> {
  const agoraMs = opts.agoraMs ?? Date.now();
  let estado: EstadoCanal | null = null;

  if (opts.canalId) {
    estado = await carregarEstadoCanal(opts.db, opts.canalId);

    // Disjuntor — sempre. Conta restrita = nenhum envio (proativo ou não).
    if (estado.restrito) {
      return {
        ok: false,
        tipo: "restrito",
        erro: `Conta WhatsApp restrita pela Meta${estado.motivo ? ` (${estado.motivo})` : ""} — envios pausados até a liberação.`,
      };
    }

    if (opts.proativo) {
      // Freio por qualidade: RED pausa TODO proativo (só resposta a quem
      // escreve sai). Esperar a Meta restringir é esperar o ban — RED é o
      // último estágio antes dele.
      if ((estado.qualidade || "").toUpperCase() === "RED") {
        return {
          ok: false,
          tipo: "qualidade",
          erro:
            "Qualidade do número está VERMELHA na Meta — disparos proativos pausados automaticamente até a qualidade se recuperar. Respostas a clientes continuam saindo.",
        };
      }
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

  // Resolve o contato pelo telefone quando o caller não trouxe `contatoId`.
  // Sem isso, opt-out/opt-in dependiam de cada caller lembrar de passar o id —
  // e quem esquecia (template manual, cobrança sem vínculo) furava a política.
  let contatoId = opts.contatoId;
  if (!contatoId && opts.telefone && opts.proativo && estado?.escritorioId) {
    try {
      const { buscarContatoPorTelefone } = await import("../escritorio/db-crm");
      const c = await buscarContatoPorTelefone(estado.escritorioId, String(opts.telefone).replace(/\D/g, ""));
      if (c) contatoId = c.id;
    } catch { /* best-effort: sem contato resolvido, as demais travas seguem valendo */ }
  }

  // Opt-out: pedido de descadastro vale pra TODO envio proativo — a política
  // da Meta exige honrar ("respect all requests... to opt out"). Não afeta
  // resposta quando o contato inicia conversa (proativo=false).
  if (opts.proativo && contatoId) {
    const { contatoEstaOptOut } = await import("./whatsapp-optout");
    if (await contatoEstaOptOut(opts.db, contatoId)) {
      return {
        ok: false,
        tipo: "optout",
        erro: "Contato optou por não receber avisos automáticos (SAIR). Envio bloqueado — ele pode reativar respondendo VOLTAR.",
      };
    }
  }

  if (opts.exigirOptin && contatoId) {
    const consent = await contatoTemConsentimento(opts.db, contatoId);
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
  telefone?: string | null;
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
