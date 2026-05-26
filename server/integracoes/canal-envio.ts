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
import { isLidJid } from "../../shared/whatsapp-types";

const log = createLogger("canal-envio");

export interface EnvioResultado {
  ok: boolean;
  /** ID externo da mensagem (Meta msgId / Baileys key.id) quando disponível. */
  idExterno?: string;
  /** Mensagem de erro pra registrar no DB. Presente apenas quando ok=false. */
  erro?: string;
  /** Tipo do provider que tentou (pra logs). */
  provider?: "whatsapp_qr" | "whatsapp_api" | "outro";
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
    return { ok: true, idExterno: msgId, provider: "whatsapp_api" };
  } catch (e: any) {
    const apiMsg = e?.response?.data?.error?.message;
    return { ok: false, erro: apiMsg || e?.message || "Falha ao enviar template", provider: "whatsapp_api" };
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
    // Se só temos chatIdExterno, tentamos extrair o número da parte antes do @.
    let telefone = (opts.telefone || "").replace(/\D/g, "");
    if (!telefone && opts.chatIdExterno) {
      const antesDoArroba = opts.chatIdExterno.split("@")[0];
      telefone = antesDoArroba.replace(/\D/g, "");
    }
    if (!telefone || telefone.length < 10) {
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
