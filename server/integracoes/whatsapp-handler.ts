import type { WhatsappMensagemRecebida } from "../../shared/whatsapp-types";
import { isLidJid } from "../../shared/whatsapp-types";
import type { TipoCanalMensagem, ImagemAnexa } from "../../shared/smartflow-types";
import { criarOuReutilizarContato, listarContatos, buscarContatoPorTelefone as buscarContatoPorTelefoneDB, criarConversa, enviarMensagem as salvarMensagem, atualizarStatusMensagem, atualizarConversa } from "../escritorio/db-crm";
import { obterAutoReplyCanal } from "../escritorio/db-canais";
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
    // Stickiness CROSS-CONVERSA: se o contato JÁ tem responsável (atribuído
    // antes), a nova conversa nasce com ele — cliente que volta cai com a
    // mesma pessoa. Sem responsável prévio, a conversa nasce SEM atendente —
    // quem decide é o SmartFlow (bloco Distribuir p/ setor, com o filtro de
    // setor que o usuário definiu). A distribuição legacy (distribuirLead)
    // não filtrava por setor, então jogava em qualquer atendente ativo —
    // mesmo de outro setor que não era pra receber esse tipo de lead.
    const respExistente = await pegarResponsavelDoContato(contatoId);
    conversaId = await criarConversa({
      escritorioId,
      contatoId,
      canalId,
      atendenteId: respExistente ?? undefined,
      assunto: `WhatsApp: ${msg.nome || msg.telefone || "contato"}`,
      chatIdExterno: msg.chatId,
    });
  }
  // Whisper: se o escritório ligou transcrição de áudio no card do ChatGPT,
  // converte a nota de voz em texto AQUI — a transcrição vira o conteúdo salvo
  // (aparece na conversa e entra no histórico do agente) e alimenta o fluxo.
  let transcricaoAudio: string | null = null;
  if (msg.tipo === "audio" && msg.mediaUrl) {
    const { transcreverAudioWhatsapp } = await import("./config-ia-media");
    transcricaoAudio = await transcreverAudioWhatsapp(escritorioId, msg.mediaUrl);
  }
  const tipoMsg = mapTipo(msg.tipo);
  const conteudo = transcricaoAudio
    ? `🎤 ${transcricaoAudio}`
    : msg.mediaUrl ? `${msg.conteudo}\n[media:${msg.mediaUrl}]` : msg.conteudo;
  const mensagemId = await salvarMensagem({
    conversaId, remetenteId: undefined, direcao: "entrada", tipo: tipoMsg, conteudo,
    mediaUrl: msg.mediaUrl || undefined,
    payload: msg.interactiveReply ? { interactiveReply: msg.interactiveReply } : null,
  });
  // Marca aguardando — MAS preserva em_atendimento (atendente assumiu, mantém
  // o controle; sobrescrever fazia o bot voltar a responder na próxima msg do
  // cliente, mesmo depois do atendente ter intervindo).
  const statusAtual = await pegarStatusConversa(conversaId);
  if (statusAtual !== "em_atendimento") {
    await atualizarConversa(conversaId, escritorioId, { status: "aguardando" });
  }

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

  // NOTA: a extração automática de campos do agente foi REMOVIDA daqui.
  // Antes, qualquer agente ATIVO rodava extração em background a cada
  // mensagem — ou seja, o agente "atuava" no atendimento sem o usuário ter
  // montado nenhum cenário. Isso viola o princípio: agente marcado fica
  // DISPONÍVEL pra usar num cenário, mas não age sozinho.
  // A captura de dados agora acontece SÓ quando o usuário coloca o passo
  // `ia_extrair_campos` no cenário (controle explícito pelo canvas), ou
  // pelo botão manual no painel de atendimento.

  // Agentes IA só são acionados DENTRO do SmartFlow (via passo ia_responder).
  // Se nenhum cenário do SmartFlow bate com a mensagem, caímos num auto-reply
  // fixo configurado no canal. Sem IA automática fora do fluxo desenhado.
  // Vision: se o escritório ligou "Ler imagens", a foto vai NATIVA pro modelo
  // (multimodal) junto da mensagem. Resolve aqui pra threading pelo dispatcher.
  let imagemVision: ImagemAnexa | undefined;
  if (msg.tipo === "imagem" && msg.mediaUrl) {
    const { obterImagemParaVision } = await import("./config-ia-media");
    imagemVision = (await obterImagemParaVision(escritorioId, msg.mediaUrl)) ?? undefined;
  }

  // Alimenta o SmartFlow com texto: texto direto, transcrição do áudio (Whisper),
  // ou a legenda da imagem (Vision; sem legenda usa um texto padrão pra disparar).
  // Áudio sem transcrição (Whisper desligado ou falhou) NÃO dispara — antes desse
  // gate o handler ignorava áudio mesmo com Whisper ligado, e o bot ficava mudo.
  const textoFluxo = msg.tipo === "texto" ? (msg.conteudo || "")
    : transcricaoAudio ? transcricaoAudio
    : imagemVision ? (msg.conteudo || "Analise a imagem que enviei.")
    : "";
  // Áudio que chegou sem transcrição = Whisper desligado, sem chave OpenAI ou
  // chamada falhou. Sem log explícito aqui, dava "bot mudo em áudio" sem pista.
  if (msg.tipo === "audio" && !transcricaoAudio) {
    log.warn(
      { conversaId, contatoId, mediaUrl: msg.mediaUrl },
      "[SmartFlow] Áudio recebido sem transcrição — bot não vai responder. Confira: card ChatGPT em Configurações → Apps externos tem 'Whisper' ON + chave OpenAI válida.",
    );
  }
  if (textoFluxo) {
    const { dispararMensagemCanal, janelaAcumulacaoAtiva } = await import("../smartflow/dispatcher");

    // Processa a mensagem (já COMBINADA, se o acumulador agrupou várias) pelo
    // SmartFlow e envia as respostas geradas.
    const processarMensagem = async (texto: string) => {
      try {
        const canalTipo = await buscarTipoDoCanal(canalId);
        const sf = await dispararMensagemCanal(escritorioId, {
          canalTipo,
          canalId,
          conversaId,
          contatoId,
          mensagem: texto,
          telefone: msg.telefone,
          nomeCliente: msg.nome || "",
          imagem: imagemVision,
          tipoMensagem: msg.tipo,
          interactiveReply: msg.interactiveReply,
        });
        if (sf.executou) {
          // SmartFlow assumiu — envia respostas geradas.
          // Espalha os envios no tempo pra não disparar burst-protection do WhatsApp
          // (2+ mensagens no mesmo tick é causa comum de E429 / silently dropped).
          //
          // ANTI-RACE: a cada envio, re-checa o status da conversa. Se o atendente
          // enviar uma mensagem no inbox DURANTE o processamento do SmartFlow
          // (que pode levar segundos em fluxos com múltiplas LLMs), a conversa
          // vira "em_atendimento" — e as respostas pendentes do bot NÃO devem
          // sair. Sem isso, atendente e robô falavam ao mesmo tempo.
          for (let i = 0; i < sf.respostas.length; i++) {
            if (i > 0) await new Promise((r) => setTimeout(r, DELAY_ENTRE_RESPOSTAS_MS));
            const statusAtual = await pegarStatusConversa(conversaId);
            if (statusAtual === "em_atendimento") {
              log.info({ conversaId, restantes: sf.respostas.length - i }, "[SmartFlow] Atendente assumiu — cancelando respostas pendentes do bot");
              break;
            }
            await enviarResposta(canalId, conversaId, msg.chatId, sf.respostas[i]);
          }
        } else {
          // Sem cenário ativo — dispara auto-reply fixo do canal (se configurado)
          await enviarAutoReply(canalId, conversaId, msg.chatId);
        }
      } catch (e: any) {
        log.error(`[SmartFlow] Erro:`, e.message);
        // Fallback: tenta auto-reply fixo se SmartFlow falhar
        try { await enviarAutoReply(canalId, conversaId, msg.chatId); } catch { /* ignore */ }
      }
    };

    // Agrupamento de mensagens "picadas": se o bloco Atendente IA onde a conversa
    // está pausada configurou uma janela (`acumularSegundos`), bufferiza e só
    // processa quando o cliente ficar quieto pela janela — juntando tudo numa
    // mensagem só. Sem janela (ou 1ª mensagem de conversa nova, sem bloco ativo)
    // processa na hora.
    try {
      const janela = await janelaAcumulacaoAtiva(escritorioId, contatoId);
      if (janela > 0) {
        const { acumularMensagem } = await import("../smartflow/acumulador");
        acumularMensagem(`${canalId}:${conversaId}`, janela, textoFluxo, processarMensagem);
      } else {
        await processarMensagem(textoFluxo);
      }
    } catch (e: any) {
      log.error(`[SmartFlow] Erro ao agendar agrupamento:`, e?.message || String(e));
      try { await processarMensagem(textoFluxo); } catch { /* já loga dentro */ }
    }
  }
  return { contatoId, conversaId, mensagemId };
}

/** Envia o auto-reply fixo configurado no canal. Se vazio/null, não envia nada
 *  (silêncio deliberado — operador atende manualmente pela UI de Atendimento). */
export async function enviarAutoReply(canalId: number, conversaId: number, chatIdExterno: string) {
  const texto = await obterAutoReplyCanal(canalId);
  if (!texto) return;
  await enviarResposta(canalId, conversaId, chatIdExterno, texto);
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
  const ctxConv = await buscarContextoEnvioConversa(conversaId);

  // Divide a resposta em bolhas menores ("atendente humano", aprovado
  // via mockup). Config por escritório; resposta curta sai inteira
  // (regra dentro de dividirMensagemNatural). Envio manual do operador
  // não passa por aqui — nunca é dividido.
  const { dividirMensagemNatural, calcularDelayDigitacaoMs } = await import("./dividir-mensagem");
  const partes = ctxConv?.dividir.ativo
    ? dividirMensagemNatural(resposta, { maxMensagens: ctxConv.dividir.max })
    : [resposta];

  // O helper enviarMensagemPeloCanal já roteia entre Baileys (whatsapp_qr) e
  // Cloud API (whatsapp_api) baseado no tipo do canal. Antes este caminho
  // chamava Baileys direto, fazendo respostas automáticas falharem em canais
  // Cloud API com "Sessão WhatsApp desconectada".
  const { enviarMensagemPeloCanal, sinalizarDigitando } = await import("./canal-envio");

  for (let i = 0; i < partes.length; i++) {
    if (i > 0) {
      // "Digitando…" durante a pausa, proporcional ao tamanho da
      // PRÓXIMA bolha. Best-effort — nunca bloqueia o envio.
      void sinalizarDigitando({
        canalId,
        chatIdExterno,
        telefone: ctxConv?.telefonePN ?? null,
        conversaId,
      });
      await new Promise((r) =>
        setTimeout(r, calcularDelayDigitacaoMs(partes[i], ctxConv?.dividir.ritmo)),
      );
    }

    const msgId = await salvarMensagem({
      conversaId,
      remetenteId: undefined,
      direcao: "saida",
      tipo: "texto",
      conteudo: partes[i],
      status: "pendente",
    });

    const r = await enviarMensagemPeloCanal({
      canalId,
      chatIdExterno,
      telefone: ctxConv?.telefonePN ?? null,
      conteudo: partes[i],
    });

    if (r.ok) {
      await atualizarStatusMensagem(msgId, "enviada");
    } else {
      log.error(
        { err: r.erro, conversaId, canalId, msgId, parte: i + 1, totalPartes: partes.length, provider: r.provider },
        "[ChatBot] Envio WA erro",
      );
      await atualizarStatusMensagem(msgId, "falha");
      // Bolha falhou → não envia as seguintes (resposta com buraco no
      // meio é pior que truncada; as restantes nem são persistidas).
      break;
    }
  }
}

/**
 * Contexto de envio da conversa: telefone PN do contato (pra converter
 * JID @lid) + config de divisão de mensagens do escritório.
 */
async function buscarContextoEnvioConversa(conversaId: number): Promise<{
  telefonePN: string | null;
  dividir: { ativo: boolean; max: number; ritmo: "rapido" | "natural" | "calmo" };
} | null> {
  try {
    const { getDb } = await import("../db");
    const { conversas, contatos, escritorios } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select({
        telefone: contatos.telefone,
        dividirAtivo: escritorios.msgDividirRespostas,
        dividirMax: escritorios.msgDividirMax,
        dividirRitmo: escritorios.msgDividirRitmo,
      })
      .from(conversas)
      .innerJoin(contatos, eq(contatos.id, conversas.contatoId))
      .innerJoin(escritorios, eq(escritorios.id, conversas.escritorioId))
      .where(eq(conversas.id, conversaId))
      .limit(1);
    if (!row) return null;
    const tel = row.telefone?.replace(/\D/g, "") || "";
    return {
      telefonePN: tel.length >= 10 ? tel : null,
      dividir: {
        ativo: row.dividirAtivo,
        max: row.dividirMax,
        ritmo: row.dividirRitmo,
      },
    };
  } catch (err: any) {
    log.warn({ err: err?.message, conversaId }, "Falha ao buscar contexto de envio da conversa");
    return null;
  }
}

// buscarContatoPorTelefone agora é centralizada em db-crm.ts
// (buscarContatoPorTelefoneDB importada no topo do arquivo)
// Faz query SQL exata em vez de loop JS com .endsWith().

async function buscarConversaExistente(escritorioId: number, contatoId: number, canalId: number, chatIdExterno?: string) {
  // Query direta por SQL — NÃO via listarConversas (que é capada): conversa
  // antiga além do limite não era achada e a mensagem criava conversa DUPLICADA.
  const { getDb } = await import("../db");
  const { conversas } = await import("../../drizzle/schema");
  const { eq, and, or, desc } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return null;
  if (chatIdExterno) {
    const [row] = await db.select({ id: conversas.id }).from(conversas)
      .where(and(eq(conversas.escritorioId, escritorioId), eq(conversas.canalId, canalId), eq(conversas.chatIdExterno, chatIdExterno)))
      .limit(1);
    if (row) return row.id;
  }
  // Conversa aberta (mais recente) do contato nesse canal.
  const [aberta] = await db.select({ id: conversas.id }).from(conversas)
    .where(and(
      eq(conversas.escritorioId, escritorioId), eq(conversas.canalId, canalId), eq(conversas.contatoId, contatoId),
      or(eq(conversas.status, "aguardando"), eq(conversas.status, "em_atendimento")),
    ))
    .orderBy(desc(conversas.ultimaMensagemAt)).limit(1);
  if (aberta) return aberta.id;
  // Senão, reabre a resolvida mais recente.
  const [resolvida] = await db.select({ id: conversas.id }).from(conversas)
    .where(and(
      eq(conversas.escritorioId, escritorioId), eq(conversas.canalId, canalId),
      eq(conversas.contatoId, contatoId), eq(conversas.status, "resolvido"),
    ))
    .orderBy(desc(conversas.ultimaMensagemAt)).limit(1);
  return resolvida?.id ?? null;
}

/**
 * Busca uma conversa existente pelo chatIdExterno (JID) — match exato por SQL.
 * (LIDs são opacos; sem fallback confiável por variante. PN antigo cai no
 * caminho padrão de buscarContatoPorTelefone.)
 */
async function buscarConversaPorChatId(escritorioId: number, canalId: number, chatId: string): Promise<number | null> {
  if (!chatId) return null;
  // Query direta — NÃO via listarConversas (capada): senão conversa além do
  // limite não casava o chatId e a mensagem duplicava a conversa.
  const { getDb } = await import("../db");
  const { conversas } = await import("../../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select({ id: conversas.id }).from(conversas)
    .where(and(
      eq(conversas.escritorioId, escritorioId),
      eq(conversas.canalId, canalId),
      eq(conversas.chatIdExterno, chatId),
    ))
    .limit(1);
  return row?.id ?? null;
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

/** Lê atendenteId da conversa — usado pra notificar via SSE só o
 *  atendente responsável + dono/gestores (não todos do escritório). */
/**
 * Lê o status atual da conversa. Usado pelo loop de envio de respostas do
 * SmartFlow pra detectar se o atendente assumiu (em_atendimento) durante o
 * processamento — se assumiu, o resto das respostas do bot é cancelado.
 */
async function pegarStatusConversa(conversaId: number): Promise<string | null> {
  try {
    const { getDb } = await import("../db");
    const { conversas } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select({ status: conversas.status })
      .from(conversas)
      .where(eq(conversas.id, conversaId))
      .limit(1);
    return row?.status ?? null;
  } catch {
    return null;
  }
}

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
