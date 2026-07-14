/**
 * Envio de mensagens via canal — roteia pelo tipo de `canaisIntegrados.tipo`.
 * Hoje o único provider de envio é a WhatsApp Cloud API (Meta oficial).
 *
 * Unifica os 3 callers (envio manual em `router-crm.ts`, auto-reply/SmartFlow
 * em `whatsapp-handler.ts` e `smartflow/executores.ts`) num único ponto de
 * roteamento + travas anti-ban.
 */

import { getDb } from "../db";
import { canaisIntegrados } from "../../drizzle/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { createLogger } from "../_core/logger";
import { jidToPhone } from "../../shared/whatsapp-types";

const log = createLogger("canal-envio");

export interface EnvioResultado {
  ok: boolean;
  /** ID externo da mensagem (Meta msgId / Baileys key.id) quando disponível. */
  idExterno?: string;
  /** Mensagem de erro pra registrar no DB. Presente apenas quando ok=false. */
  erro?: string;
  /** Tipo do provider que tentou (pra logs). */
  provider?: "whatsapp_api" | "outro";
  /** Canal que efetivou o envio — usado pra amarrar a mensagem persistida à conversa certa. */
  canalId?: number;
  /**
   * Motivo do bloqueio pelo guard anti-ban, quando `ok=false` por trava (não por
   * erro da Meta). "rate"/"diario" = adiar/reagendar (excedente sai depois);
   * "restrito"/"optin" = não reenviar. Ausente quando a falha é outra.
   */
  bloqueio?: "restrito" | "diario" | "rate" | "optin";
}

export interface EnvioMensagemOpts {
  canalId: number;
  /** Telefone normalizado do destinatário (pode incluir caracteres não-numéricos — limpamos). */
  telefone?: string | null;
  /** JID/chatId externo da conversa (preferido em WhatsApp QR pra reusar sessão). */
  chatIdExterno?: string | null;
  conteudo: string;
  /**
   * Disparo iniciado pela empresa (SmartFlow/scheduler). Ativa as travas de
   * volume (teto diário + rate limit) do guard anti-ban. Resposta manual do
   * operador e auto-reply a mensagem recebida deixam `false` — ainda respeitam
   * o disjuntor (conta restrita = ninguém envia), mas não contam contra o teto.
   */
  proativo?: boolean;
  /** Contato destinatário — habilita a checagem de opt-in quando exigida. */
  contatoId?: number;
  /** Exige opt-in do contato (fluxo automático proativo). */
  exigirOptin?: boolean;
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
    // Respeita o número de envio escolhido (padraoEnvio) — só entre os
    // CONECTADOS (filtro acima). Se o escolhido cair, o fallback é o
    // conectado de menor id (determinístico, não mais "o primeiro" arbitrário).
    .orderBy(desc(canaisIntegrados.padraoEnvio), asc(canaisIntegrados.id))
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
  /** Contato destinatário — habilita a checagem de opt-in quando exigida. */
  contatoId?: number;
  /** Fluxo automático (SmartFlow/scheduler): exige opt-in do contato. Envio
   *  manual do operador não passa isso (ele já está atendendo o cliente). */
  exigirOptin?: boolean;
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
  // Travas anti-spam (disjuntor / rate limit / opt-in) ANTES de tocar a Meta.
  const db = await getDb();
  const guard = db ? await import("./whatsapp-envio-guard") : null;
  if (db && guard) {
    const permitido = await guard.podeDispararTemplate({
      db,
      canalId: cred.canalId,
      contatoId: opts.contatoId,
      exigirOptin: opts.exigirOptin,
    });
    if (!permitido.ok) {
      log.warn({ canalId: cred.canalId, tipo: permitido.tipo }, "[Guard] template bloqueado antes do envio");
      return { ok: false, erro: permitido.erro, provider: "whatsapp_api", canalId: cred.canalId };
    }
  }
  try {
    const { WhatsAppCloudClient } = await import("./whatsapp-cloud");
    const client = new WhatsAppCloudClient({ accessToken: cred.accessToken, phoneNumberId: cred.phoneNumberId });
    const msgId = await client.enviarTemplate(telefone, opts.nome, opts.idioma || "pt_BR", opts.componentes);
    if (db && guard) await guard.registrarSucessoTemplate({ db, canalId: cred.canalId });
    return { ok: true, idExterno: msgId, provider: "whatsapp_api", canalId: cred.canalId };
  } catch (e: any) {
    const apiMsg = e?.response?.data?.error?.message;
    const erro = apiMsg || e?.message || "Falha ao enviar template";
    // Meta recusou por restrição/spam? tripa o disjuntor (pausa os próximos).
    if (db && guard) await guard.registrarFalhaTemplate({ db, canalId: cred.canalId, erro }).catch(() => {});
    return { ok: false, erro, provider: "whatsapp_api", canalId: cred.canalId };
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
  /** Contato destinatário — habilita a checagem de opt-in quando exigida. */
  contatoId?: number;
  /** Fluxo automático: exige opt-in do contato. */
  exigirOptin?: boolean;
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
  // Interativo iniciado pela empresa é proativo — passa pelas travas anti-ban.
  const db = await getDb();
  const guard = db ? await import("./whatsapp-envio-guard") : null;
  if (db && guard) {
    const permitido = await guard.podeEnviar({
      db,
      canalId: cred.canalId,
      contatoId: opts.contatoId,
      proativo: true,
      exigirOptin: opts.exigirOptin,
    });
    if (!permitido.ok) {
      log.warn({ canalId: cred.canalId, tipo: permitido.tipo }, "[Guard] interativo bloqueado antes do envio");
      return { ok: false, erro: permitido.erro, provider: "whatsapp_api", canalId: cred.canalId, bloqueio: permitido.tipo };
    }
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
    if (db && guard) await guard.registrarSucessoEnvio({ db, canalId: cred.canalId, proativo: true });
    return { ok: true, idExterno: msgId, provider: "whatsapp_api", canalId: cred.canalId };
  } catch (e: any) {
    const apiMsg = e?.response?.data?.error?.message;
    const erro = apiMsg || e?.message || "Falha ao enviar mensagem interativa";
    if (db && guard) await guard.registrarFalhaEnvio({ db, canalId: cred.canalId, erro }).catch(() => {});
    return { ok: false, erro, provider: "whatsapp_api", canalId: cred.canalId };
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

    // Travas anti-ban ANTES de tocar a Meta. O disjuntor vale pra TODO envio de
    // texto (conta restrita = nada sai); teto diário/rate só pra proativo.
    const db = await getDb();
    const guard = db ? await import("./whatsapp-envio-guard") : null;
    if (db && guard) {
      const permitido = await guard.podeEnviar({
        db,
        canalId: canal.id,
        contatoId: opts.contatoId,
        proativo: opts.proativo,
        exigirOptin: opts.exigirOptin,
      });
      if (!permitido.ok) {
        log.warn({ canalId: canal.id, tipo: permitido.tipo }, "[Guard] texto bloqueado antes do envio");
        return { ok: false, erro: permitido.erro, provider: "whatsapp_api", canalId: canal.id, bloqueio: permitido.tipo };
      }
    }

    const { WhatsAppCloudClient } = await import("./whatsapp-cloud");
    const client = new WhatsAppCloudClient({
      accessToken: config.accessToken,
      phoneNumberId: config.phoneNumberId,
    });
    const msgId = await client.enviarTexto(telefone, opts.conteudo);
    if (db && guard) await guard.registrarSucessoEnvio({ db, canalId: canal.id, proativo: opts.proativo });
    return { ok: true, idExterno: msgId, provider: "whatsapp_api", canalId: canal.id };
  } catch (e: any) {
    const apiMsg = e?.response?.data?.error?.message;
    const erro = apiMsg || e?.message || "Falha desconhecida no envio Cloud API";
    // Meta recusou por restrição/spam? tripa o disjuntor (pausa os próximos).
    const db = await getDb();
    if (db) {
      const guard = await import("./whatsapp-envio-guard");
      await guard.registrarFalhaEnvio({ db, canalId: canal.id, erro }).catch(() => {});
    }
    return { ok: false, erro, provider: "whatsapp_api", canalId: canal.id };
  }
}
