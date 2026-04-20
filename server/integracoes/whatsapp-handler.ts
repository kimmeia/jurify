import type { WhatsappMensagemRecebida } from "../../shared/whatsapp-types";
import { isLidJid } from "../../shared/whatsapp-types";
import type { TipoCanalMensagem } from "../../shared/smartflow-types";
import { criarOuReutilizarContato, listarContatos, buscarContatoPorTelefone as buscarContatoPorTelefoneDB, criarConversa, listarConversas, enviarMensagem as salvarMensagem, atualizarStatusMensagem, listarMensagens, atualizarConversa, distribuirLead } from "../escritorio/db-crm";
import { obterConfigChatBot, gerarRespostaChatBot, converterHistoricoParaChatBot } from "./chatbot-openai";
import { createLogger } from "../_core/logger";
const log = createLogger("integracoes-whatsapp-handler");

/** Intervalo mínimo entre envios automáticos pro WhatsApp não detectar burst. */
const DELAY_ENTRE_RESPOSTAS_MS = 1500;

/** Converte o tipo do canal armazenado em TipoCanalMensagem (shared). */
async function buscarTipoDoCanal(canalId: number): Promise<TipoCanalMensagem> {
  try {
    const { getDb } = await import("../db");
    const { canaisIntegrados } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return "whatsapp_qr";
    const [row] = await db
      .select({ tipo: canaisIntegrados.tipo })
      .from(canaisIntegrados)
      .where(eq(canaisIntegrados.id, canalId))
      .limit(1);
    const tipo = row?.tipo;
    if (tipo === "whatsapp_api" || tipo === "instagram" || tipo === "facebook") return tipo;
    return "whatsapp_qr";
  } catch {
    return "whatsapp_qr";
  }
}

export async function processarMensagemRecebida(canalId: number, escritorioId: number, msg: WhatsappMensagemRecebida) {
  if (msg.isGroup) return { contatoId: 0, conversaId: 0, mensagemId: 0 };

  // ─── Resolução de contato/conversa ──────────────────────────────────────
  // PRIMEIRO tentamos achar uma conversa existente pelo chatId (JID, mesmo
  // que seja @lid). Isso é crucial: quando WhatsApp entrega a resposta de
  // um contato com JID em formato @lid (linked id), o telefone "extraído"
  // não bate com o telefone original do contato — então sem este lookup
  // criaríamos um contato duplicado a cada resposta.
  let contatoId = 0;
  let conversaId = await buscarConversaPorChatId(escritorioId, canalId, msg.chatId);

  if (conversaId) {
    contatoId = await pegarContatoIdDaConversa(conversaId) ?? 0;
  }

  // Se o JID é LID e nenhuma conversa correspondente foi achada, é um LID
  // novo: ainda assim tentamos um lookup por telefone (caso senderPn tenha
  // funcionado) — senão, criamos um contato novo com nome do pushName.
  if (!contatoId && msg.telefone) {
    const clean = msg.telefone.replace(/\D/g, "");
    const existente = await buscarContatoPorTelefoneDB(escritorioId, clean);
    contatoId = existente?.id ?? 0;
  }

  let contatoFoiCriado = false;
  if (!contatoId) {
    // Sem contato conhecido — cria um. Se o JID é LID e não temos telefone
    // real, salvamos o telefone vazio (não o LID) para evitar poluir o
    // cadastro com identificadores opacos.
    const telefoneParaSalvar = isLidJid(msg.chatId) && !msg.telefone ? "" : msg.telefone;
    const resultado = await criarOuReutilizarContato({
      escritorioId,
      nome: msg.nome || telefoneParaSalvar || "Contato WhatsApp",
      telefone: telefoneParaSalvar,
      origem: "whatsapp",
    });
    contatoId = resultado.id;
    // `criarOuReutilizarContato` reaproveita por CPF/telefone. Só consideramos
    // "lead novo" quando a função de fato inseriu — jaCadastrado=false.
    contatoFoiCriado = !resultado.jaCadastrado;
  }

  if (!conversaId) {
    conversaId = await buscarConversaExistente(escritorioId, contatoId, canalId, msg.chatId);
  }
  if (!conversaId) {
    // Stickiness: se o contato JÁ tem responsável definido (atribuído
    // anteriormente), atribuímos a nova conversa pro mesmo atendente
    // — assim o cliente fala sempre com a mesma pessoa quando volta
    // a entrar em contato. Só se contato.responsavelId for null
    // recorremos à distribuição automática.
    const respExistente = await pegarResponsavelDoContato(contatoId);
    const aid = respExistente
      ?? (await distribuirLead(escritorioId, contatoId || undefined, canalId)) ?? undefined;
    conversaId = await criarConversa({
      escritorioId,
      contatoId,
      canalId,
      atendenteId: aid,
      assunto: `WhatsApp: ${msg.nome || msg.telefone || "contato"}`,
      chatIdExterno: msg.chatId,
    });
    // Se o contato ainda não tinha responsavelId, grava agora pra
    // próximas conversas continuarem caindo no mesmo atendente.
    if (!respExistente && aid) {
      await definirResponsavelDoContato(contatoId, aid);
    }
  }
  const tipoMsg = mapTipo(msg.tipo);
  const conteudo = msg.mediaUrl ? `${msg.conteudo}\n[media:${msg.mediaUrl}]` : msg.conteudo;
  const mensagemId = await salvarMensagem({ conversaId, remetenteId: undefined, direcao: "entrada", tipo: tipoMsg, conteudo });
  await atualizarConversa(conversaId, escritorioId, { status: "aguardando" });

  // Notificar via SSE APENAS:
  //   - dono e gestores do escritório
  //   - o atendente responsável da conversa (se houver)
  // Atendentes/estagiários NÃO recebem pop-up de mensagens que não são deles.
  try {
    const { emitirParaResponsaveisEMaster } = await import("../_core/sse-notifications");
    const atendenteId = await pegarAtendenteDaConversa(conversaId);
    emitirParaResponsaveisEMaster(
      escritorioId,
      atendenteId,
      {
        tipo: "nova_mensagem",
        titulo: "Nova mensagem",
        mensagem: `${msg.nome || msg.telefone}: ${(msg.conteudo || "").slice(0, 80)}`,
        dados: { conversaId, contatoId, canal: "whatsapp" },
      },
    );
  } catch { /* SSE indisponível */ }

  // Lead novo via WhatsApp: dispara SmartFlow com gatilho novo_lead.
  // Fire-and-forget — não bloqueia o fluxo de mensagem.
  if (contatoFoiCriado) {
    (async () => {
      try {
        const { dispararNovoLead } = await import("../smartflow/dispatcher");
        await dispararNovoLead(escritorioId, {
          contatoId,
          nome: msg.nome,
          telefone: msg.telefone,
          origem: "whatsapp",
          conversaId,
        });
      } catch (e: any) {
        log.warn({ err: e.message }, "[SmartFlow] Falha ao disparar novo_lead");
      }
    })();
  }

  // SmartFlow tem prioridade sobre chatbot padrão
  if (msg.tipo === "texto" && msg.conteudo) {
    try {
      const { dispararMensagemCanal } = await import("../smartflow/dispatcher");
      const canalTipo = await buscarTipoDoCanal(canalId);
      const sf = await dispararMensagemCanal(escritorioId, {
        canalTipo,
        canalId,
        conversaId,
        contatoId,
        mensagem: msg.conteudo,
        telefone: msg.telefone,
        nomeCliente: msg.nome || "",
      });
      if (sf.executou) {
        // SmartFlow assumiu — envia respostas geradas.
        // Espalha os envios no tempo pra não disparar burst-protection do WhatsApp
        // (2+ mensagens no mesmo tick é causa comum de E429 / silently dropped).
        for (let i = 0; i < sf.respostas.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, DELAY_ENTRE_RESPOSTAS_MS));
          await enviarResposta(canalId, conversaId, msg.chatId, sf.respostas[i]);
        }
      } else {
        // Sem cenário ativo — usa chatbot padrão
        await processarChatBot(escritorioId, canalId, conversaId, msg.chatId, msg.conteudo);
      }
    } catch (e: any) {
      log.error(`[SmartFlow/ChatBot] Erro:`, e.message);
      // Fallback: tenta chatbot padrão se SmartFlow falhar
      try { await processarChatBot(escritorioId, canalId, conversaId, msg.chatId, msg.conteudo); } catch { /* ignore */ }
    }
  }
  return { contatoId, conversaId, mensagemId };
}

async function processarChatBot(escritorioId: number, canalId: number, conversaId: number, chatIdExterno: string, msgCliente: string) {
  const config = await obterConfigChatBot(escritorioId, canalId);
  if (!config) return;
  const conversas = await listarConversas(escritorioId, {});
  const conv = conversas.find(c => c.id === conversaId);
  if (conv && conv.status === "em_atendimento") return;
  const histRaw = await listarMensagens(conversaId, 20);
  const hist = converterHistoricoParaChatBot(histRaw.map(m => ({ direcao: m.direcao as string, conteudo: m.conteudo, tipo: m.tipo as string })));
  const result = await gerarRespostaChatBot(config, hist, msgCliente);
  if (result.erro) return;
  if (result.transferir) { if (result.resposta) await enviarResposta(canalId, conversaId, chatIdExterno, result.resposta); await atualizarConversa(conversaId, escritorioId, { status: "em_atendimento" }); return; }
  if (result.resposta) { await enviarResposta(canalId, conversaId, chatIdExterno, result.resposta); }
}

/**
 * Envia uma resposta automática (chatbot/SmartFlow) pro WhatsApp.
 *
 * Fluxo:
 *   1. Persiste a mensagem com status "pendente" (já aparece na UI com spinner).
 *   2. Se o chatId é @lid, tenta converter pra telefone real do contato
 *      (LID nem sempre aceita sendMessage — Baileys retorna "Chat not found").
 *   3. Valida que a sessão Baileys está viva.
 *   4. Envia e atualiza status pra "enviada" (ou "falha" com log estruturado).
 *
 * A UI lê o campo `status` pra renderizar ícone de sucesso/falha.
 */
async function enviarResposta(canalId: number, conversaId: number, chatIdExterno: string, resposta: string) {
  const msgId = await salvarMensagem({
    conversaId,
    remetenteId: undefined,
    direcao: "saida",
    tipo: "texto",
    conteudo: resposta,
    status: "pendente",
  });

  try {
    const { getWhatsappManager } = await import("./whatsapp-baileys");
    const m = getWhatsappManager();
    if (!m.isConectado(canalId)) {
      throw new Error("Sessão WhatsApp desconectada");
    }

    // Fallback LID → PN: se o chatIdExterno for @lid, buscar telefone
    // real do contato associado à conversa. Evita "Chat not found".
    let destinatario = chatIdExterno;
    if (isLidJid(chatIdExterno)) {
      const telefonePN = await buscarTelefonePNdaConversa(conversaId);
      if (telefonePN) {
        destinatario = `${telefonePN.replace(/\D/g, "")}@s.whatsapp.net`;
        log.warn({ conversaId, lid: chatIdExterno, pn: destinatario }, "[WhatsApp] Convertendo LID para PN no envio");
      } else {
        log.warn({ conversaId, lid: chatIdExterno }, "[WhatsApp] LID sem telefone PN cadastrado — tentando enviar direto no LID");
      }
    }

    await m.enviarMensagemJid(canalId, destinatario, resposta);
    await atualizarStatusMensagem(msgId, "enviada");
  } catch (e: any) {
    log.error({ err: e?.message, conversaId, canalId, msgId }, "[ChatBot] Envio WA erro");
    await atualizarStatusMensagem(msgId, "falha");
  }
}

/** Busca o telefone (PN) do contato associado à conversa. Usado pra converter JID @lid. */
async function buscarTelefonePNdaConversa(conversaId: number): Promise<string | null> {
  try {
    const { getDb } = await import("../db");
    const { conversas, contatos } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select({ telefone: contatos.telefone })
      .from(conversas)
      .innerJoin(contatos, eq(contatos.id, conversas.contatoId))
      .where(eq(conversas.id, conversaId))
      .limit(1);
    const tel = row?.telefone?.replace(/\D/g, "") || "";
    return tel.length >= 10 ? tel : null;
  } catch (err: any) {
    log.warn({ err: err?.message, conversaId }, "Falha ao buscar telefone PN da conversa");
    return null;
  }
}

// buscarContatoPorTelefone agora é centralizada em db-crm.ts
// (buscarContatoPorTelefoneDB importada no topo do arquivo)
// Faz query SQL exata em vez de loop JS com .endsWith().

async function buscarConversaExistente(escritorioId: number, contatoId: number, canalId: number, chatIdExterno?: string) {
  const all = await listarConversas(escritorioId, {});
  if (chatIdExterno) { for (const c of all) if ((c as any).chatIdExterno === chatIdExterno && c.canalId === canalId) return c.id; }
  for (const c of all) if (c.contatoId === contatoId && c.canalId === canalId && (c.status === "aguardando" || c.status === "em_atendimento")) return c.id;
  for (const c of all) if (c.contatoId === contatoId && c.canalId === canalId && c.status === "resolvido") return c.id;
  return null;
}

/**
 * Busca uma conversa existente pelo chatIdExterno (JID).
 *
 * Inclui matching tolerante: se o JID recebido é LID (@lid) ou PN
 * (@s.whatsapp.net), tentamos casar com o exato OU com a "variante" — caso
 * o WhatsApp tenha alternado o formato entre o envio inicial e a resposta.
 * Para isso comparamos a parte numérica do JID, se o lado armazenado for
 * do tipo PN.
 */
async function buscarConversaPorChatId(escritorioId: number, canalId: number, chatId: string): Promise<number | null> {
  if (!chatId) return null;
  const all = await listarConversas(escritorioId, {});

  // 1. Match exato pelo chatId
  for (const c of all) {
    if ((c as any).chatIdExterno === chatId && c.canalId === canalId) return c.id;
  }

  // 2. Se chatId é LID, não tem match direto — não há fallback confiável
  // (LIDs são opacos). Quem chamou vai criar um contato novo se necessário.
  // Mas se chatId é PN, pode existir uma conversa antiga que armazenou LID
  // — nesse caso só conseguimos casar via número, o que já é o caminho
  // padrão (buscarContatoPorTelefone).

  return null;
}

/** Lê responsavelId do contato — usado pra "stickiness" de atendimento.
 *  Se um cliente já foi atendido por alguém antes, próximas conversas
 *  caem no mesmo atendente.
 */
async function pegarResponsavelDoContato(contatoId: number): Promise<number | null> {
  if (!contatoId) return null;
  try {
    const { getDb } = await import("../db");
    const { contatos } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return null;
    const [row] = await db.select({ responsavelId: contatos.responsavelId })
      .from(contatos).where(eq(contatos.id, contatoId)).limit(1);
    return row?.responsavelId ?? null;
  } catch {
    return null;
  }
}

/** Grava o responsavelId no contato (chamado quando primeira conversa
 *  é distribuída) — só seta se ainda for null pra não sobrescrever
 *  reatribuições manuais feitas pelo admin.
 */
async function definirResponsavelDoContato(contatoId: number, colaboradorId: number) {
  if (!contatoId || !colaboradorId) return;
  try {
    const { getDb } = await import("../db");
    const { contatos } = await import("../../drizzle/schema");
    const { eq, and, isNull } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;
    await db.update(contatos)
      .set({ responsavelId: colaboradorId })
      .where(and(eq(contatos.id, contatoId), isNull(contatos.responsavelId)));
  } catch (err) {
    log.warn({ err: String(err), contatoId }, "Falha ao definir responsavel do contato");
  }
}

/** Lê atendenteId da conversa — usado pra notificar via SSE só o
 *  atendente responsável + dono/gestores (não todos do escritório). */
async function pegarAtendenteDaConversa(conversaId: number): Promise<number | null> {
  try {
    const { getDb } = await import("../db");
    const { conversas } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select({ atendenteId: conversas.atendenteId })
      .from(conversas)
      .where(eq(conversas.id, conversaId))
      .limit(1);
    return row?.atendenteId ?? null;
  } catch {
    return null;
  }
}

async function pegarContatoIdDaConversa(conversaId: number): Promise<number | null> {
  try {
    const { getDb } = await import("../db");
    const { conversas } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return null;
    const [row] = await db.select({ contatoId: conversas.contatoId }).from(conversas).where(eq(conversas.id, conversaId)).limit(1);
    return row?.contatoId ?? null;
  } catch (err) {
    log.warn({ err: String(err) }, "Falha ao buscar contatoId da conversa");
    return null;
  }
}

function mapTipo(tipo: WhatsappMensagemRecebida["tipo"]): any {
  const m: Record<string, any> = { texto: "texto", imagem: "imagem", audio: "audio", video: "video", documento: "documento", localizacao: "localizacao", contato: "contato", sticker: "sticker" };
  return m[tipo] || "texto";
}
