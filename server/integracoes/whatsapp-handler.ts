import type { WhatsappMensagemRecebida } from "../../shared/whatsapp-types";
import { criarContato, listarContatos, criarConversa, listarConversas, enviarMensagem as salvarMensagem, listarMensagens, atualizarConversa, distribuirLead } from "../escritorio/db-crm";
import { obterConfigChatBot, gerarRespostaChatBot, converterHistoricoParaChatBot } from "./chatbot-openai";

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

  if (msg.tipo === "texto" && msg.conteudo) { try { await processarChatBot(escritorioId, canalId, conversaId, msg.chatId, msg.conteudo); } catch (e: any) { console.error(`[ChatBot] Erro:`, e.message); } }
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
  try { const { getWhatsappManager } = await import("./whatsapp-baileys"); const m = getWhatsappManager(); if (m.isConectado(canalId)) await m.enviarMensagemJid(canalId, chatIdExterno, resposta); } catch (e: any) { console.error(`[ChatBot] Envio WA erro:`, e.message); }
}

async function buscarContatoPorTelefone(escritorioId: number, telefone: string) {
  const clean = telefone.replace(/\D/g, "");
  const contatos = await listarContatos(escritorioId, clean);
  for (const c of contatos) { const p = (c.telefone || "").replace(/\D/g, ""); if (p === clean || p.endsWith(clean) || clean.endsWith(p)) return c.id; }
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
