/**
 * "Tem cliente esperando resposta há mais de 15 minutos."
 *
 * O único aviso da tela de Notificações que não tinha nada pronto por trás:
 * mensagem que chega avisa na hora, mas silêncio não avisa nunca — e é o
 * silêncio que perde cliente.
 *
 * Três decisões carregam o desenho:
 *
 * 1. **Um toque por espera, não por ciclo.** O cron roda de 5 em 5 minutos e
 *    a conversa continua esperando no ciclo seguinte; sem dedup o celular
 *    tocaria a cada 5 minutos até alguém responder. A marca é uma linha em
 *    `notificacoes` com o id da conversa no título, e a janela de dedup é a
 *    mesma da espera — se o cliente for respondido e voltar a esperar amanhã,
 *    avisa de novo.
 * 2. **Espera é a ÚLTIMA mensagem ser do cliente.** Conversa com resposta do
 *    escritório depois da última entrada não está esperando, mesmo aberta.
 * 3. **Teto de idade.** Conversa parada há três dias não é urgência nova; o
 *    aviso é sobre o que dá pra salvar agora.
 */

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { conversas, mensagens, notificacoes, contatos } from "../../drizzle/schema";
import { emitirNotificacao, responsaveisEMaster } from "../_core/sse-notifications";
import { createLogger } from "../_core/logger";

const log = createLogger("cron-cliente-esperando");

export const ESPERA_MINIMA_MIN = 15;
/** Acima disto já não é "responda agora" — é backlog. */
export const ESPERA_MAXIMA_HORAS = 72;
/** Janela de dedup: não repete o aviso da mesma conversa dentro dela. */
export const DEDUP_HORAS = 12;

/** O título carrega o id: é ele que dedup e leitor usam pra saber de qual conversa é. */
export function tituloEspera(conversaId: number): string {
  return `Cliente esperando resposta (conversa ${conversaId})`;
}

export async function avisarClientesEsperando(agora = new Date()): Promise<{ avisadas: number }> {
  const db = await getDb();
  if (!db) return { avisadas: 0 };

  const limiteRecente = new Date(agora.getTime() - ESPERA_MINIMA_MIN * 60_000);
  const limiteAntigo = new Date(agora.getTime() - ESPERA_MAXIMA_HORAS * 3_600_000);

  let avisadas = 0;
  try {
    // A última mensagem da conversa é de ENTRADA e está na janela: é isso que
    // define "esperando". Fazer a conta em SQL evita trazer conversa por
    // conversa — o Inbox de um escritório movimentado tem milhares.
    const ultima = db
      .select({
        conversaId: mensagens.conversaId,
        quando: sql<Date>`MAX(${mensagens.createdAt})`.as("quando"),
      })
      .from(mensagens)
      .groupBy(mensagens.conversaId)
      .as("ultima");

    const linhas = await db
      .select({
        id: conversas.id,
        escritorioId: conversas.escritorioId,
        atendenteId: conversas.atendenteId,
        nome: contatos.nome,
        quando: ultima.quando,
      })
      .from(conversas)
      .innerJoin(ultima, eq(ultima.conversaId, conversas.id))
      .innerJoin(
        mensagens,
        and(eq(mensagens.conversaId, conversas.id), eq(mensagens.createdAt, ultima.quando)),
      )
      .leftJoin(contatos, eq(contatos.id, conversas.contatoId))
      .where(
        and(
          eq(conversas.status, "aguardando"),
          eq(mensagens.direcao, "entrada"),
          lte(ultima.quando, limiteRecente),
          gte(ultima.quando, limiteAntigo),
        ),
      )
      .limit(200);

    const desde = new Date(agora.getTime() - DEDUP_HORAS * 3_600_000);

    for (const c of linhas) {
      const titulo = tituloEspera(c.id);
      const [jaAvisou] = await db
        .select({ id: notificacoes.id })
        .from(notificacoes)
        .where(and(eq(notificacoes.titulo, titulo), gte(notificacoes.createdAt, desde)))
        .limit(1);
      if (jaAvisou) continue;

      const minutos = Math.round((agora.getTime() - new Date(c.quando).getTime()) / 60_000);
      const mensagem = `${c.nome ?? "Um cliente"} está sem resposta há ${
        minutos >= 60 ? `${Math.floor(minutos / 60)}h` : `${minutos} min`
      }.`;

      // Os mesmos alvos do aviso recebem a linha no sino: a marca de dedup é
      // uma notificação de verdade, de alguém de verdade. Inventar um `userId`
      // só pra marcar deixaria lixo no sino de ninguém.
      const alvos = await responsaveisEMaster(c.escritorioId, c.atendenteId);
      if (alvos.length === 0) continue;

      for (const userId of alvos) {
        emitirNotificacao(userId, {
          tipo: "cliente_esperando",
          titulo: "Cliente esperando resposta",
          mensagem,
          dados: { conversaId: c.id },
        });
        await db.insert(notificacoes).values({ userId, titulo, mensagem, tipo: "sistema" });
      }
      avisadas++;
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, "[espera] ciclo falhou");
  }

  if (avisadas > 0) log.info({ avisadas }, "[espera] clientes sem resposta avisados");
  return { avisadas };
}
