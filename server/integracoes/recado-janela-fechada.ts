/**
 * O recado interno de "a janela de 24h fechou, o robô foi segurado".
 *
 * Na tela do Atendimento, robô calado por regra e robô quebrado são a MESMA
 * coisa: nada acontece. Quem atende precisa da diferença — e precisa saber que
 * a saída existe e é dele (mandar um template aprovado). Mesma ideia do recado
 * de limite por contato, com o mesmo formato de nota cinza.
 *
 * **Um recado por episódio de janela fechada**, não por tentativa: um lembrete
 * de cobrança que tenta todo dia contra a mesma conversa fria deixaria um
 * recado por dia, e uma coluna de avisos iguais é ruído que ninguém lê. O
 * episódio termina quando o cliente escreve — é a mensagem dele que reabre a
 * janela —, então a dedup pergunta se já existe recado DEPOIS da última entrada
 * do cliente.
 *
 * Silencioso por desenho: é aviso de tela. Falhar aqui não pode virar exceção
 * em cima de um envio que já foi decidido.
 */

import { and, desc, eq, gte, like } from "drizzle-orm";
import { conversas, mensagens } from "../../drizzle/schema";
import { MARCADOR_JANELA_FECHADA, recadoJanelaFechada } from "../../shared/janela-24h";
import { ultimaEntradaDoContatoNoCanal } from "./whatsapp-optout";
import { createLogger } from "../_core/logger";

const log = createLogger("recado-janela-fechada");

export async function registrarJanelaFechadaNaConversa(opts: {
  db: any;
  escritorioId: number;
  contatoId: number;
  canalId: number;
  nomeCenario?: string | null;
}): Promise<void> {
  const { db, escritorioId, contatoId, canalId } = opts;
  try {
    const [conversa] = await db
      .select({ id: conversas.id })
      .from(conversas)
      .where(
        and(
          eq(conversas.escritorioId, escritorioId),
          eq(conversas.contatoId, contatoId),
          eq(conversas.canalId, canalId),
        ),
      )
      .orderBy(desc(conversas.id))
      .limit(1);
    if (!conversa) return;

    const ultimaEntrada = await ultimaEntradaDoContatoNoCanal(db, contatoId, canalId);
    const filtros = [
      eq(mensagens.conversaId, conversa.id),
      eq(mensagens.tipo, "sistema"),
      like(mensagens.payload, `%${MARCADOR_JANELA_FECHADA}%`),
    ];
    // Sem entrada nenhuma do cliente não há episódio pra fechar: o recado sai
    // uma vez e pronto, senão cada tentativa deixaria uma nota.
    if (ultimaEntrada) filtros.push(gte(mensagens.createdAt, ultimaEntrada));

    const [jaAvisado] = await db
      .select({ id: mensagens.id })
      .from(mensagens)
      .where(and(...filtros))
      .limit(1);
    if (jaAvisado) return;

    await db.insert(mensagens).values({
      conversaId: conversa.id,
      direcao: "saida",
      tipo: "sistema",
      conteudo: recadoJanelaFechada(opts.nomeCenario),
      status: "enviada",
      payload: JSON.stringify({ sistema: { tipo: MARCADOR_JANELA_FECHADA, canalId } }),
    });
  } catch (err: any) {
    log.warn({ err: err?.message, contatoId, canalId }, "falha ao registrar recado de janela fechada");
  }
}
