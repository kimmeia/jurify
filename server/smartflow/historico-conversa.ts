import type { ChatBotMessage } from "../integracoes/chatbot-openai";

/** Linha crua da tabela `mensagens` relevante pro histórico do LLM. */
export interface MensagemHistoricoRaw {
  direcao: "entrada" | "saida";
  conteudo: string | null;
  tipo: string;
}

/**
 * Converte linhas da tabela `mensagens` (ordenadas do mais NOVO pro mais
 * antigo) em histórico pro LLM, em ordem cronológica (antigo → novo).
 *
 * Regras:
 *   - `entrada` (cliente) → role "user"; `saida` (nós) → role "assistant".
 *   - Ignora mensagens de sistema e as que ficam vazias após limpeza.
 *   - Tira o marcador `[media:URL]` que o handler anexa — vira ruído pro LLM.
 *   - Remove a mensagem ATUAL (a que acabou de chegar e já foi salva antes do
 *     fluxo rodar), senão ela apareceria duas vezes: no histórico e como o
 *     turno de usuário que o motor manda separado.
 *   - Limita às últimas `limite` mensagens.
 */
export function montarHistoricoMensagens(
  rowsNovoParaAntigo: MensagemHistoricoRaw[],
  mensagemAtual: string,
  limite = 20,
): ChatBotMessage[] {
  const hist: ChatBotMessage[] = [];
  for (const r of rowsNovoParaAntigo) {
    if (r.tipo === "sistema") continue;
    const limpo = (r.conteudo ?? "").replace(/\n*\[media:[^\]]*\]/g, "").trim();
    if (!limpo) continue;
    hist.push({ role: r.direcao === "entrada" ? "user" : "assistant", content: limpo });
  }
  // `hist` está em ordem novo→antigo. Remove a 1ª (= mais recente) ocorrência
  // de user igual à mensagem atual — é a que o handler acabou de salvar.
  const alvo = mensagemAtual.trim();
  if (alvo) {
    const idx = hist.findIndex((m) => m.role === "user" && m.content === alvo);
    if (idx !== -1) hist.splice(idx, 1);
  }
  return hist.reverse().slice(-limite);
}
