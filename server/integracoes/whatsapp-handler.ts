import type { WhatsappMensagemRecebida } from "../../shared/whatsapp-types";
import { criarContato, listarContatos, criarConversa, listarConversas, enviarMensagem as salvarMensagem, listarMensagens, atualizarConversa, distribuirLead } from "../escritorio/db-crm";
import { obterConfigChatBot, gerarRespostaChatBot, converterHistoricoParaChatBot } from "./chatbot-openai";
import { createLogger } from "../_core/logger";
const log = createLogger("integracoes-whatsapp-handler");

export async function processarMensagemRecebida(canalId: number, escritorioId: number, msg: WhatsappMensagemRecebida) {
  if (msg.isGroup) return { contatoId: 0, conversaId: 0, mensagemId: 0 };
  let contatoId = await buscarContatoPorTelefone(escritorioId, msg.telefone);
  if (!contatoId) { contatoId = await criarContato({ escritorioId, nome: msg.nome || msg.telefone, telefone: msg.telefone, origem: "whatsapp" }); }
  let conversaId = await buscarConversaExistente(escritorioId, contatoId, canalId, msg.chatId);
  if (!conversaId) { const aid = await distribuirLead(escritorioId, contatoId || undefined, canalId) ?? undefined; conversaId = await criarConversa({ escritorioId, contatoId, canalId, atendenteId: aid, assunto: `WhatsApp: ${msg.nome || msg.telefone}`, chatIdExterno: msg.chatId }); }
  const tipoMsg = mapTipo(msg.tipo);
  const conteudo = msg.mediaUrl ? `${msg.conteudo}\n[media:${msg.mediaUrl}]` : msg.conteudo;
  const mensagemId = await salvarMensagem({ conversaId, remetenteId: undefined, direcao: "entrada", tipo: tipoMsg, conteudo });
  await atualizarConversa(conversaId, escritorioId, { status: "aguardando" });

  // Notificar atendente e escritório via SSE
  try {
    const { emitirParaEscritorio } = await import("../_core/sse-notifications");
    emitirParaEscritorio(escritorioId, { tipo: "nova_mensagem", titulo: "Nova mensagem", mensagem: `${msg.nome || msg.telefone}: ${(msg.conteudo || "").slice(0, 80)}`, dados: { conversaId, contatoId, canal: "whatsapp" } });
  } catch { /* SSE indisponível */ }

  if (msg.tipo === "texto" && msg.conteudo) { try { await processarChatBot(escritorioId, canalId, conversaId, msg.chatId, msg.conteudo); } catch (e: any) { log.error(`[ChatBot] Erro:`, e.message); } }
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

async function enviarResposta(canalId: number, conversaId: number, chatIdExterno: string, resposta: string) {
  await salvarMensagem({ conversaId, remetenteId: undefined, direcao: "saida", tipo: "texto", conteudo: resposta });
  try { const { getWhatsappManager } = await import("./whatsapp-baileys"); const m = getWhatsappManager(); if (m.isConectado(canalId)) await m.enviarMensagemJid(canalId, chatIdExterno, resposta); } catch (e: any) { log.error(`[ChatBot] Envio WA erro:`, e.message); }
}

/**
 * Busca um contato pelo telefone.
 *
 * Faz matching fuzzy (endsWith) contra o telefone atual E os telefones
 * anteriores do contato (histórico). Isso garante que, quando o usuário
 * altera o número do contato no cadastro, mensagens do número antigo
 * ainda caem no mesmo contato — preservando o histórico de conversa.
 */
async function buscarContatoPorTelefone(escritorioId: number, telefone: string) {
  const clean = telefone.replace(/\D/g, "");
  if (!clean) return null;

  // Busca ampla no banco (not strict — o listarContatos faz LIKE)
  const contatosRaw = await listarContatos(escritorioId, clean);

  const match = (p: string) => {
    const pClean = (p || "").replace(/\D/g, "");
    if (!pClean) return false;
    return pClean === clean || pClean.endsWith(clean) || clean.endsWith(pClean);
  };

  // 1. Telefone atual
  for (const c of contatosRaw) {
    if (c.telefone && match(c.telefone)) return c.id;
  }

  // 2. Telefones anteriores (histórico separado por vírgula)
  for (const c of contatosRaw) {
    const historico = (c as { telefonesAnteriores?: string | null }).telefonesAnteriores;
    if (!historico) continue;
    const anteriores = historico.split(",").map((t) => t.trim()).filter(Boolean);
    for (const ant of anteriores) {
      if (match(ant)) {
        log.info({
          contatoId: c.id,
          telefoneRecebido: telefone,
          telefoneHistorico: ant,
        }, "Contato reconhecido via telefone histórico");
        return c.id;
      }
    }
  }

  // 3. Última tentativa: busca sem filtro na tabela inteira (caso o contato
  // não tenha nome similar ao telefone — listarContatos usa LIKE no nome tb)
  try {
    const { getDb } = await import("../db");
    const { contatos: contatosTable } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      const all = await db.select({
        id: contatosTable.id,
        telefone: contatosTable.telefone,
        telefonesAnteriores: contatosTable.telefonesAnteriores,
      }).from(contatosTable).where(eq(contatosTable.escritorioId, escritorioId));

      for (const c of all) {
        if (c.telefone && match(c.telefone)) return c.id;
        if (c.telefonesAnteriores) {
          const ants = c.telefonesAnteriores.split(",").map((t) => t.trim()).filter(Boolean);
          if (ants.some(match)) {
            log.info({ contatoId: c.id }, "Contato reconhecido via histórico (fallback full scan)");
            return c.id;
          }
        }
      }
    }
  } catch (err) {
    log.warn({ err: String(err) }, "Fallback full scan falhou");
  }

  return null;
}

async function buscarConversaExistente(escritorioId: number, contatoId: number, canalId: number, chatIdExterno?: string) {
  const all = await listarConversas(escritorioId, {});
  if (chatIdExterno) { for (const c of all) if ((c as any).chatIdExterno === chatIdExterno && c.canalId === canalId) return c.id; }
  for (const c of all) if (c.contatoId === contatoId && c.canalId === canalId && (c.status === "aguardando" || c.status === "em_atendimento")) return c.id;
  for (const c of all) if (c.contatoId === contatoId && c.canalId === canalId && c.status === "resolvido") return c.id;
  return null;
}

function mapTipo(tipo: WhatsappMensagemRecebida["tipo"]): any {
  const m: Record<string, any> = { texto: "texto", imagem: "imagem", audio: "audio", video: "video", documento: "documento", localizacao: "localizacao", contato: "contato", sticker: "sticker" };
  return m[tipo] || "texto";
}
