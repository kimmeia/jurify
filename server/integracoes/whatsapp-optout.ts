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

const PALAVRAS_SAIR = new Set(["sair", "parar", "stop"]);
const PALAVRAS_VOLTAR = new Set(["voltar"]);

/**
 * Interpreta um texto de inbound como comando de opt-out/opt-in.
 * Match EXATO da palavra isolada (após trim/lowercase/pontuação final) —
 * "quero cancelar a consulta" ou "vou sair de casa" NÃO casam.
 */
export function interpretarComandoOptOut(texto: string | null | undefined): "sair" | "voltar" | null {
  if (!texto) return null;
  const t = texto.trim().toLowerCase().replace(/[!.。…\s]+$/g, "");
  if (PALAVRAS_SAIR.has(t)) return "sair";
  if (PALAVRAS_VOLTAR.has(t)) return "voltar";
  return null;
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
