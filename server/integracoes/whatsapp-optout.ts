/**
 * Opt-out / opt-in de mensagens proativas no WhatsApp.
 *
 * A política da Meta exige: "You must respect all requests (either on or
 * off WhatsApp) by a person to block, discontinue, or otherwise opt out of
 * communications from you via WhatsApp".
 *
 * Escopo do opt-out: SÓ envios proativos (cobrança automática, campanhas,
 * templates de scheduler). Quando o CONTATO inicia conversa, bot e
 * atendente respondem normalmente — responder quem procurou a empresa é
 * atendimento, não spam.
 *
 * Opt-in aqui é rastro DOCUMENTAL (LGPD/política): registrado passivo no
 * primeiro inbound, por confirmação na conversa ou por atestado manual.
 * Não participa do gate de envio.
 */

import { contatos } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { createLogger } from "../_core/logger";

const log = createLogger("whatsapp-optout");

// ─── Comandos na conversa ────────────────────────────────────────────────────

// A política da Meta manda honrar "all requests... to opt out" — em qualquer
// forma. O vocabulário estreito (sair/parar/stop) deixava "pare", "cancelar" e
// "descadastrar" passarem direto pro bot, e a pessoa que já pediu pra sair e
// continua recebendo é exatamente quem clica "denunciar spam" — o aviso que a
// conta recebeu em 19/08. As frases entram normalizadas (sem acento).
const PALAVRAS_SAIR = new Set([
  "sair", "parar", "stop", "pare", "cancele", "cancelar",
  "descadastrar", "descadastre", "remover", "unsubscribe",
]);
const FRASES_SAIR = [
  "nao quero mais receber", "não quero mais receber",
  "nao quero receber", "não quero receber",
  "parar de receber", "quero sair", "quero cancelar",
  "remova meu numero", "remova meu número",
];
const PALAVRAS_VOLTAR = new Set(["voltar"]);

/**
 * Interpreta um texto de inbound como comando de opt-out/opt-in.
 * Palavra: match EXATO isolado (após trim/lowercase/pontuação final) —
 * "quero cancelar a consulta" ou "vou sair de casa" NÃO casam.
 * Frase: só as formas inequívocas de descadastro, por igualdade após limpeza.
 */
export function interpretarComandoOptOut(texto: string | null | undefined): "sair" | "voltar" | null {
  if (!texto) return null;
  const t = texto.trim().toLowerCase().replace(/[!.。…\s]+$/g, "");
  if (PALAVRAS_SAIR.has(t)) return "sair";
  if (PALAVRAS_VOLTAR.has(t)) return "voltar";
  if (FRASES_SAIR.some((f) => t === f)) return "sair";
  return null;
}

/**
 * Sinal FRACO de intenção de descadastro — não age sozinho, avisa o atendente.
 *
 * O comando exato descadastra na hora; isto aqui pega o "por favor não me
 * mandem mais mensagens" no meio de uma frase. Automatizar sobre sinal fraco
 * descadastraria "quero cancelar a audiência" — por isso vira alerta humano,
 * nunca ação.
 */
export function pareceIntencaoDeOptOut(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (interpretarComandoOptOut(texto)) return false; // o comando exato já resolve
  return [
    "descadastr", "nao quero mais receber", "nao me mande", "nao me mandem",
    "parem de mandar", "pare de mandar", "parem de me mandar",
    "parar de mandar", "parar de receber", "nao mande mais", "nao mandem mais",
    "remover meu numero", "tirar meu numero", "isso e spam", "denunciar spam",
  ].some((m) => t.includes(m));
}

/** Texto de confirmação enviado UMA vez ao registrar o opt-out. */
export function mensagemConfirmacaoSaida(nomeEscritorio: string): string {
  const nome = nomeEscritorio?.trim() || "este escritório";
  return (
    `Você não receberá mais avisos automáticos de ${nome}. ` +
    `Para voltar a receber, responda VOLTAR. Se precisar falar com a gente, é só escrever. 👋`
  );
}

/** Texto de confirmação ao reativar via VOLTAR. */
export function mensagemConfirmacaoVolta(nomeEscritorio: string): string {
  const nome = nomeEscritorio?.trim() || "este escritório";
  return `Pronto! Você voltará a receber os avisos automáticos de ${nome}. ✅`;
}

// ─── Persistência ────────────────────────────────────────────────────────────

export async function aplicarOptOut(db: any, contatoId: number, origem: string): Promise<void> {
  await db
    .update(contatos)
    .set({
      optOutWhatsapp: true,
      optOutWhatsappEm: new Date(),
      optOutWhatsappOrigem: origem.slice(0, 128),
    })
    .where(eq(contatos.id, contatoId));
  log.info({ contatoId, origem }, "[OptOut] contato NÃO receberá mais proativos");
}

export async function removerOptOut(db: any, contatoId: number): Promise<void> {
  await db
    .update(contatos)
    .set({ optOutWhatsapp: false, optOutWhatsappEm: null, optOutWhatsappOrigem: null })
    .where(and(eq(contatos.id, contatoId), eq(contatos.optOutWhatsapp, true)));
  log.info({ contatoId }, "[OptOut] contato reativou avisos (VOLTAR)");
}

export async function contatoEstaOptOut(db: any, contatoId: number): Promise<boolean> {
  const [row] = await db
    .select({ optOut: contatos.optOutWhatsapp })
    .from(contatos)
    .where(eq(contatos.id, contatoId))
    .limit(1);
  return !!row?.optOut;
}

/**
 * O opt-out está VIGENTE pra um envio proativo? Pura, testável.
 *
 * SAIR segue bloqueando disparo frio até o VOLTAR — isso não muda. Mas
 * quando o contato volta a ESCREVER depois do SAIR, a própria Meta lê a
 * mensagem como "quero conversar" (é ela que abre a janela de atendimento
 * de 24h): dentro dessa janela, continuar a conversa que ELE iniciou não é
 * aviso indesejado. Fora da janela — ou sem mensagem posterior ao SAIR —
 * o bloqueio vale integral. (Decisão do dono, 27/08.)
 *
 * A comparação é ESTRITA (>): a própria mensagem "SAIR" é uma entrada
 * gravada junto do registro do opt-out — empate de timestamp não reabre.
 * Registro antigo sem data de opt-out também não reabre (sem como provar
 * que a mensagem veio depois → bloqueia, que é o lado seguro).
 */
export function optOutVigente(opts: {
  optOut: boolean;
  optOutEm: Date | string | null | undefined;
  ultimaEntradaAt: Date | string | null | undefined;
  agoraMs: number;
}): boolean {
  if (!opts.optOut) return false;
  const entrada = opts.ultimaEntradaAt ? new Date(opts.ultimaEntradaAt as any).getTime() : NaN;
  if (Number.isNaN(entrada)) return true;
  const em = opts.optOutEm ? new Date(opts.optOutEm as any).getTime() : NaN;
  const reabriuDepoisDoSair = !Number.isNaN(em) && entrada > em;
  return !(reabriuDepoisDoSair && janela24hAberta(new Date(entrada), opts.agoraMs));
}

/**
 * Versão com I/O do `optOutVigente`: carrega o registro do contato e a
 * última entrada dele no canal. Sem `canalId` não dá pra medir a janela —
 * bloqueio integral (lado seguro).
 */
export async function contatoOptOutVigenteParaEnvio(
  db: any,
  contatoId: number,
  canalId?: number,
  agoraMs: number = Date.now(),
): Promise<boolean> {
  const [row] = await db
    .select({ optOut: contatos.optOutWhatsapp, em: contatos.optOutWhatsappEm })
    .from(contatos)
    .where(eq(contatos.id, contatoId))
    .limit(1);
  if (!row?.optOut) return false;
  if (!canalId) return true;
  const ultima = await ultimaEntradaDoContatoNoCanal(db, contatoId, canalId);
  return optOutVigente({ optOut: true, optOutEm: row.em ?? null, ultimaEntradaAt: ultima, agoraMs });
}

/**
 * Registra o opt-in documental se ainda não existir — idempotente e
 * best-effort (nunca lança; não pode derrubar o fluxo de mensagem).
 */
export async function registrarOptInSeAusente(
  db: any,
  contatoId: number,
  origem: string,
): Promise<void> {
  try {
    const [row] = await db
      .select({ em: contatos.optInWhatsappEm })
      .from(contatos)
      .where(eq(contatos.id, contatoId))
      .limit(1);
    if (!row || row.em) return;
    await db
      .update(contatos)
      .set({ optInWhatsappEm: new Date(), optInWhatsappOrigem: origem.slice(0, 128) })
      .where(and(eq(contatos.id, contatoId)));
  } catch {
    /* best-effort */
  }
}

// ─── Janela de 24h (atendimento) ─────────────────────────────────────────────

export const JANELA_24H_MS = 24 * 60 * 60 * 1000;

/**
 * A janela de atendimento do WhatsApp está aberta? Aberta = última mensagem
 * RECEBIDA do contato há menos de 24h. Fora dela, a Meta rejeita texto
 * livre (131047) — só template sai. Pura, testável.
 */
export function janela24hAberta(ultimaEntradaAt: Date | null | undefined, agoraMs: number): boolean {
  if (!ultimaEntradaAt) return false;
  const t = ultimaEntradaAt instanceof Date ? ultimaEntradaAt.getTime() : new Date(ultimaEntradaAt as any).getTime();
  if (Number.isNaN(t)) return false;
  return agoraMs - t < JANELA_24H_MS;
}

/** Busca o timestamp da última mensagem RECEBIDA da conversa. */
export async function ultimaEntradaDaConversa(db: any, conversaId: number): Promise<Date | null> {
  const { mensagens } = await import("../../drizzle/schema");
  const { desc } = await import("drizzle-orm");
  const [row] = await db
    .select({ createdAt: mensagens.createdAt })
    .from(mensagens)
    .where(and(eq(mensagens.conversaId, conversaId), eq(mensagens.direcao, "entrada")))
    .orderBy(desc(mensagens.id))
    .limit(1);
  return row?.createdAt ?? null;
}

/**
 * Última mensagem RECEBIDA do contato em QUALQUER conversa daquele canal.
 * A janela de 24h da Meta é por par (número da empresa, número do cliente) —
 * medir só a conversa atual dava falso "fechada" quando a conversa anterior
 * tinha sido encerrada e uma nova era aberta pro mesmo telefone.
 * Exclui mensagens `tipo="sistema"` (eventos internos não abrem janela).
 */
export async function ultimaEntradaDoContatoNoCanal(
  db: any,
  contatoId: number,
  canalId: number,
): Promise<Date | null> {
  const { mensagens, conversas } = await import("../../drizzle/schema");
  const { desc, ne } = await import("drizzle-orm");
  const [row] = await db
    .select({ createdAt: mensagens.createdAt })
    .from(mensagens)
    .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
    .where(
      and(
        eq(conversas.contatoId, contatoId),
        eq(conversas.canalId, canalId),
        eq(mensagens.direcao, "entrada"),
        ne(mensagens.tipo, "sistema"),
      ),
    )
    .orderBy(desc(mensagens.id))
    .limit(1);
  return row?.createdAt ?? null;
}
