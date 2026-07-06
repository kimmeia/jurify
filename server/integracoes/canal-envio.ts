/**
 * Envio de mensagens via canal — abstrai diferença entre WhatsApp QR
 * (Baileys) e WhatsApp Cloud API (Meta oficial).
 *
 * Existia divergência: o envio MANUAL (operador digita e manda) em
 * `router-crm.ts` tinha branch pros dois tipos, mas envios AUTOMÁTICOS
 * (auto-reply, SmartFlow, resposta da IA) em `whatsapp-handler.ts` e
 * `smartflow/executores.ts` chamavam direto o Baileys e falhavam em
 * canais Cloud API ("Sessão WhatsApp desconectada" porque o Baileys
 * nem gerencia esses canais).
 *
 * Este helper unifica os 3 callers.
 */

import { getDb } from "../db";
import { canaisIntegrados } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { createLogger } from "../_core/logger";
import { isLidJid, jidToPhone } from "../../shared/whatsapp-types";

const log = createLogger("canal-envio");

export interface EnvioResultado {
  ok: boolean;
  /** ID externo da mensagem (Meta msgId / Baileys key.id) quando disponível. */
  idExterno?: string;
  /** Mensagem de erro pra registrar no DB. Presente apenas quando ok=false. */
  erro?: string;
  /** Tipo do provider que tentou (pra logs). */
  provider?: "whatsapp_qr" | "whatsapp_api" | "outro";
  /** Canal que efetivou o envio — usado pra amarrar a mensagem persistida à conversa certa. */
  canalId?: number;
}

export interface EnvioMensagemOpts {
  canalId: number;
  /** Telefone normalizado do destinatário (pode incluir caracteres não-numéricos — limpamos). */
  telefone?: string | null;
  /** JID/chatId externo da conversa (preferido em WhatsApp QR pra reusar sessão). */
  chatIdExterno?: string | null;
  conteudo: string;
}

/**
 * Resolve o número de destino pra Cloud API.
 *
 * O `chatIdExterno` da conversa tem prioridade: é o wa_id de quem
 * realmente está conversando com o canal (janela de 24h aberta na Meta).
 * `contatos.telefone` é só fallback — é dado cadastral, pode ter sido
 * alterado por edição manual ou vínculo Asaas (outro número, ou formato
 * sem DDI 55) e aí a Meta rejeita o envio mesmo com conversa em
 * andamento. JID @lid não é telefone — cai direto no fallback.
 */
export function resolverDestinatarioCloudApi(opts: {
  telefone?: string | null;
  chatIdExterno?: string | null;
}): string | null {
  // jidToPhone devolve "" pra @lid; split(":") descarta device part de
  // JIDs Baileys ("5511999999999:2") que viraria dígito extra no número.
  const doJid = opts.chatIdExterno
    ? jidToPhone(opts.chatIdExterno).split(":")[0].replace(/\D/g, "")
    : "";
  if (doJid.length >= 10) return doJid;
  const tel = (opts.telefone || "").replace(/\D/g, "");
  return tel.length >= 10 ? tel : null;
}

/**
 * Envia uma mensagem de texto pelo canal apropriado, baseado em
 * `canaisIntegrados.tipo`. Retorna `EnvioResultado` em vez de jogar —
 * o caller decide como tratar (marcar `status="falha"`, retry, etc).
 */
export async function enviarMensagemPeloCanal(
  opts: EnvioMensagemOpts,
): Promise<EnvioResultado> {
  if (!opts.conteudo || !opts.conteudo.trim()) {
    return { ok: false, erro: "Conteúdo vazio" };
  }

  const db = await getDb();
  if (!db) return { ok: false, erro: "Database indisponível" };

  const [canal] = await db
    .select()
    .from(canaisIntegrados)
    .where(eq(canaisIntegrados.id, opts.canalId))
    .limit(1);

  if (!canal) {
    return { ok: false, erro: `Canal ${opts.canalId} não encontrado` };
  }

  switch (canal.tipo) {
    case "whatsapp_qr":
      return await enviarViaBaileys(opts);
    case "whatsapp_api":
      return await enviarViaCloudApi(canal, opts);
    default:
      log.warn({ canalId: opts.canalId, tipo: canal.tipo }, "tipo de canal sem rota de envio");
      return {
        ok: false,
        erro: `Tipo de canal "${canal.tipo}" não suporta envio automático`,
        provider: "outro",
      };
  }
}

/**
 * Resolve o canal WhatsApp OFICIAL (Cloud API / Meta) conectado do
 * escritório e devolve as credenciais decriptadas. Templates (HSM) só
 * funcionam por aqui — o canal QR (Baileys) não suporta. Retorna null se
 * não houver canal oficial conectado ou faltarem credenciais.
 */
export async function getCanalCloudApi(
  escritorioId: number,
): Promise<{ canalId: number; accessToken: string; phoneNumberId: string; wabaId?: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const [canal] = await db
    .select()
    .from(canaisIntegrados)
    .where(
      and(
        eq(canaisIntegrados.escritorioId, escritorioId),
        eq(canaisIntegrados.tipo, "whatsapp_api"),
        eq(canaisIntegrados.status, "conectado"),
      ),
    )
    .limit(1);
  if (!canal || !canal.configEncrypted || !canal.configIv || !canal.configTag) return null;
  const { decryptConfig } = await import("../escritorio/crypto-utils");
  const config = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
  if (!config?.accessToken || !config?.phoneNumberId) return null;
  return {
    canalId: canal.id,
    accessToken: config.accessToken,
    phoneNumberId: config.phoneNumberId,
    wabaId: config.wabaId,
  };
}

/**
 * Envia um template (HSM) aprovado pelo canal WhatsApp oficial do
 * escritório. Diferente do texto livre, template é necessário pra mensagens
 * fora da janela de 24h (cobrança, lembrete, follow-up). Os `componentes`
 * já vêm montados pelo motor (com as variáveis interpoladas).
 */
export async function enviarTemplatePeloCanalApi(opts: {
  escritorioId: number;
  telefone: string;
  nome: string;
  idioma?: string;
  componentes?: any[];
}): Promise<EnvioResultado> {
  const cred = await getCanalCloudApi(opts.escritorioId);
  if (!cred) {
    return {
      ok: false,
      erro: "Nenhum canal WhatsApp oficial (API Meta) conectado — templates exigem a API oficial.",
      provider: "whatsapp_api",
    };
  }
  const telefone = (opts.telefone || "").replace(/\D/g, "");
  if (!telefone || telefone.length < 10) {
    return { ok: false, erro: "Telefone inválido pra Cloud API", provider: "whatsapp_api" };
  }
  try {
    const { WhatsAppCloudClient } = await import("./whatsapp-cloud");
    const client = new WhatsAppCloudClient({ accessToken: cred.accessToken, phoneNumberId: cred.phoneNumberId });
    const msgId = await client.enviarTemplate(telefone, opts.nome, opts.idioma || "pt_BR", opts.componentes);
    return { ok: true, idExterno: msgId, provider: "whatsapp_api", canalId: cred.canalId };
  } catch (e: any) {
    const apiMsg = e?.response?.data?.error?.message;
    return { ok: false, erro: apiMsg || e?.message || "Falha ao enviar template", provider: "whatsapp_api" };
  }
}

/**
 * Envia mensagem interativa (botões reply ou lista) pelo canal WhatsApp
 * oficial. Mesmo padrão de retorno de `enviarTemplatePeloCanalApi`. Baileys
 * NÃO suporta — chamadas de canal QR retornam erro claro pra UX.
 */
export async function enviarInterativoPeloCanalApi(opts: {
  escritorioId: number;
  telefone: string;
  modo: "botoes" | "lista";
  body: string;
  header?: string;
  footer?: string;
  botoes?: Array<{ id: string; titulo: string }>;
  drawerLabel?: string;
  secoes?: Array<{ titulo: string; itens: Array<{ id: string; titulo: string; descricao?: string }> }>;
}): Promise<EnvioResultado> {
  const cred = await getCanalCloudApi(opts.escritorioId);
  if (!cred) {
    return {
      ok: false,
      erro: "Nenhum canal WhatsApp oficial (API Meta) conectado — mensagens interativas exigem a API oficial.",
      provider: "whatsapp_api",
    };
  }
  const telefone = (opts.telefone || "").replace(/\D/g, "");
  if (!telefone || telefone.length < 10) {
    return { ok: false, erro: "Telefone inválido pra Cloud API", provider: "whatsapp_api" };
  }
  try {
    const { WhatsAppCloudClient } = await import("./whatsapp-cloud");
    const client = new WhatsAppCloudClient({ accessToken: cred.accessToken, phoneNumberId: cred.phoneNumberId });
    let msgId = "";
    if (opts.modo === "botoes") {
      if (!opts.botoes || opts.botoes.length === 0) {
        return { ok: false, erro: "Sem botões configurados", provider: "whatsapp_api" };
      }
      msgId = await client.enviarBotoes(telefone, opts.body, opts.botoes, {
        cabecalho: opts.header,
        rodape: opts.footer,
      });
    } else {
      if (!opts.secoes || opts.secoes.length === 0) {
        return { ok: false, erro: "Sem seções configuradas", provider: "whatsapp_api" };
      }
      msgId = await client.enviarLista(telefone, opts.body, opts.drawerLabel || "Ver opções", opts.secoes, {
        cabecalho: opts.header,
        rodape: opts.footer,
      });
    }
    return { ok: true, idExterno: msgId, provider: "whatsapp_api" };
  } catch (e: any) {
    const apiMsg = e?.response?.data?.error?.message;
    return { ok: false, erro: apiMsg || e?.message || "Falha ao enviar mensagem interativa", provider: "whatsapp_api" };
  }
}

/**
 * Mostra "digitando…" pro destinatário antes da próxima bolha de uma
 * resposta dividida. Best-effort TOTAL: qualquer falha (canal sem
 * sessão, API recusou, DB fora) vira no-op — o envio nunca depende do
 * indicador.
 *
 * - Baileys: presence "composing" no JID.
 * - Cloud API: typing indicator atrelado à última mensagem RECEBIDA da
 *   conversa (a Meta exige o message_id de uma mensagem do cliente).
 */
export async function sinalizarDigitando(opts: {
  canalId: number;
  chatIdExterno?: string | null;
  telefone?: string | null;
  conversaId?: number;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const [canal] = await db
      .select()
      .from(canaisIntegrados)
      .where(eq(canaisIntegrados.id, opts.canalId))
      .limit(1);
    if (!canal) return;

    if (canal.tipo === "whatsapp_qr") {
      const destinatario = opts.chatIdExterno || opts.telefone;
      if (!destinatario) return;
      const { getWhatsappManager } = await import("./whatsapp-baileys");
      await getWhatsappManager().enviarPresenca(opts.canalId, destinatario, "composing");
      return;
    }

    if (canal.tipo === "whatsapp_api") {
      if (!opts.conversaId) return;
      if (!canal.configEncrypted || !canal.configIv || !canal.configTag) return;
      const { decryptConfig } = await import("../escritorio/crypto-utils");
      const config = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
      if (!config?.accessToken || !config?.phoneNumberId) return;

      const { mensagens } = await import("../../drizzle/schema");
      const { and, desc, isNotNull } = await import("drizzle-orm");
      const [ultimaRecebida] = await db
        .select({ idExterno: mensagens.idExterno })
        .from(mensagens)
        .where(and(
          eq(mensagens.conversaId, opts.conversaId),
          eq(mensagens.direcao, "entrada"),
          isNotNull(mensagens.idExterno),
        ))
        .orderBy(desc(mensagens.id))
        .limit(1);
      if (!ultimaRecebida?.idExterno) return;

      const { WhatsAppCloudClient } = await import("./whatsapp-cloud");
      const client = new WhatsAppCloudClient({
        accessToken: config.accessToken,
        phoneNumberId: config.phoneNumberId,
      });
      await client.enviarTypingIndicator(ultimaRecebida.idExterno);
    }
  } catch (e: any) {
    log.debug({ canalId: opts.canalId, err: e?.message }, "sinalizarDigitando falhou (não-fatal)");
  }
}

async function enviarViaBaileys(opts: EnvioMensagemOpts): Promise<EnvioResultado> {
  try {
    const { getWhatsappManager } = await import("./whatsapp-baileys");
    const m = getWhatsappManager();
    if (!m.isConectado(opts.canalId)) {
      return { ok: false, erro: "Sessão WhatsApp (Baileys) desconectada", provider: "whatsapp_qr" };
    }

    // Preferência: chatIdExterno → telefone. Fallback LID → PN quando
    // o JID externo é @lid (Baileys retorna "Chat not found" em LIDs novos).
    let destinatario = opts.chatIdExterno || opts.telefone || "";
    if (!destinatario) {
      return { ok: false, erro: "Sem destinatário (telefone/chatId vazios)", provider: "whatsapp_qr" };
    }

    if (isLidJid(destinatario) && opts.telefone) {
      const tel = opts.telefone.replace(/\D/g, "");
      if (tel.length >= 10) {
        destinatario = `${tel}@s.whatsapp.net`;
        log.warn({ canalId: opts.canalId, lid: opts.chatIdExterno, pn: destinatario }, "Convertendo LID para PN");
      }
    }

    await m.enviarMensagemJid(opts.canalId, destinatario, opts.conteudo);
    return { ok: true, provider: "whatsapp_qr" };
  } catch (e: any) {
    return {
      ok: false,
      erro: e?.message || "Falha desconhecida no envio Baileys",
      provider: "whatsapp_qr",
    };
  }
}

async function enviarViaCloudApi(canal: any, opts: EnvioMensagemOpts): Promise<EnvioResultado> {
  try {
    if (!canal.configEncrypted || !canal.configIv || !canal.configTag) {
      return { ok: false, erro: "Canal Cloud API sem credenciais configuradas", provider: "whatsapp_api" };
    }
    const { decryptConfig } = await import("../escritorio/crypto-utils");
    const config = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
    if (!config?.accessToken || !config?.phoneNumberId) {
      return {
        ok: false,
        erro: "Canal Cloud API sem accessToken ou phoneNumberId",
        provider: "whatsapp_api",
      };
    }

    // Cloud API exige telefone limpo (não aceita JID @lid nem @s.whatsapp.net).
    // chatIdExterno da conversa primeiro; telefone cadastral é fallback.
    const telefone = resolverDestinatarioCloudApi(opts);
    if (!telefone) {
      return { ok: false, erro: "Telefone inválido pra Cloud API", provider: "whatsapp_api" };
    }

    const { WhatsAppCloudClient } = await import("./whatsapp-cloud");
    const client = new WhatsAppCloudClient({
      accessToken: config.accessToken,
      phoneNumberId: config.phoneNumberId,
    });
    const msgId = await client.enviarTexto(telefone, opts.conteudo);
    return { ok: true, idExterno: msgId, provider: "whatsapp_api" };
  } catch (e: any) {
    const apiMsg = e?.response?.data?.error?.message;
    return {
      ok: false,
      erro: apiMsg || e?.message || "Falha desconhecida no envio Cloud API",
      provider: "whatsapp_api",
    };
  }
}
