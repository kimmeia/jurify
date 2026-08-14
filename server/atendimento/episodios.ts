/**
 * Registro dos episódios de atendimento.
 *
 * Toda decisão de "abre outro ou entra neste" mora em
 * `shared/atendimento-episodio`; aqui é só a persistência. A separação não é
 * cerimônia: a mesma régua vai ser usada pelo backfill do histórico, e regra
 * duplicada entre o que roda ao vivo e o que reconstrói o passado produziria
 * dois relatórios diferentes do mesmo mês.
 *
 * Nada aqui lança exceção pro caller. Estas funções rodam penduradas no
 * caminho da mensagem que chega, e derrubar o recebimento de um WhatsApp
 * porque a contabilidade do episódio falhou seria trocar um número errado no
 * relatório por uma mensagem de cliente perdida.
 */

import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { atendimentos } from "../../drizzle/schema";
import {
  abreNovoEpisodio,
  fechamentoPorSilencio,
  SILENCIO_MS,
  type EpisodioParaRegra,
  type MotivoFechamento,
} from "../../shared/atendimento-episodio";

/** O episódio mais recente da conversa, aberto ou não. */
async function ultimoDaConversa(conversaId: number): Promise<EpisodioParaRegra | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      id: atendimentos.id,
      abertoEm: atendimentos.abertoEm,
      fechadoEm: atendimentos.fechadoEm,
      ultimaMensagemEm: atendimentos.ultimaMensagemEm,
    })
    .from(atendimentos)
    .where(eq(atendimentos.conversaId, conversaId))
    .orderBy(desc(atendimentos.abertoEm), desc(atendimentos.id))
    .limit(1);
  return row ?? null;
}

/**
 * Registra que uma mensagem entrou na conversa, abrindo episódio se for o caso.
 *
 * Devolve o id do episódio que recebeu a mensagem, ou null quando não deu pra
 * registrar. O caller ignora o retorno de propósito — ele existe pro backfill
 * e pros testes.
 */
export async function registrarMensagemNoEpisodio(args: {
  escritorioId: number;
  conversaId: number;
  contatoId: number;
  atendenteId: number | null;
  em: Date;
  /** Mensagem do escritório (saída) ou do cliente (entrada). */
  daEquipe: boolean;
}): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;

    const ultimo = await ultimoDaConversa(args.conversaId);

    if (abreNovoEpisodio(ultimo, args.em)) {
      // Episódio que morreu de silêncio fica com a data da última mensagem
      // dele, não a de agora — senão a duração do atendimento passaria a
      // depender de quando o próximo cliente resolveu voltar.
      if (ultimo && !ultimo.fechadoEm) {
        await db
          .update(atendimentos)
          .set({
            fechadoEm: fechamentoPorSilencio(ultimo) ?? args.em,
            motivoFechamento: "silencio" as MotivoFechamento,
          })
          .where(eq(atendimentos.id, ultimo.id));
      }

      const [r] = await db.insert(atendimentos).values({
        escritorioId: args.escritorioId,
        conversaId: args.conversaId,
        contatoId: args.contatoId,
        abertoEm: args.em,
        // Quem abriu é quem estava com a conversa no instante em que a
        // demanda entrou. Congela aqui e nunca mais muda.
        atendenteAbriu: args.atendenteId,
        atendenteAtual: args.atendenteId,
        ultimaMensagemEm: args.em,
        primeiraRespostaEm: args.daEquipe ? args.em : null,
      });
      return (r as { insertId: number }).insertId ?? null;
    }

    if (!ultimo) return null;
    await db
      .update(atendimentos)
      .set({
        ultimaMensagemEm: args.em,
        // A primeira resposta é a PRIMEIRA: só grava se ainda não houver.
        ...(args.daEquipe ? { primeiraRespostaEm: sql`COALESCE(${atendimentos.primeiraRespostaEm}, ${args.em})` } : {}),
      })
      .where(eq(atendimentos.id, ultimo.id));
    return ultimo.id;
  } catch {
    return null;
  }
}

/** Fecha o episódio aberto da conversa. Usado pelo "resolver". */
export async function fecharEpisodioDaConversa(
  conversaId: number,
  motivo: MotivoFechamento,
  em: Date = new Date(),
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .update(atendimentos)
      .set({ fechadoEm: em, motivoFechamento: motivo })
      .where(and(eq(atendimentos.conversaId, conversaId), isNull(atendimentos.fechadoEm)));
  } catch {
    /* contabilidade de episódio não derruba a ação do usuário */
  }
}

/**
 * Troca o dono do episódio aberto, sem tocar em quem abriu.
 *
 * É o que faz a transferência não reescrever o passado: o SDR que trabalhou o
 * lead continua sendo quem iniciou, mesmo depois de a conversa mudar de mão.
 */
export async function transferirEpisodioDaConversa(
  conversaId: number,
  novoAtendenteId: number,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .update(atendimentos)
      .set({ atendenteAtual: novoAtendenteId })
      .where(and(eq(atendimentos.conversaId, conversaId), isNull(atendimentos.fechadoEm)));
  } catch {
    /* idem */
  }
}

/**
 * Fecha os episódios que passaram do silêncio.
 *
 * Precisa existir separado do caminho da mensagem porque o caso mais comum é
 * justamente não chegar mensagem nenhuma: sem a varredura, o atendimento de
 * quem nunca mais voltou ficaria "em aberto" pra sempre e sumiria de qualquer
 * contagem de encerrados.
 */
export async function fecharVencidosPorSilencio(agora: Date = new Date()): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const corte = new Date(agora.getTime() - SILENCIO_MS);

  const vencidos = await db
    .select({
      id: atendimentos.id,
      abertoEm: atendimentos.abertoEm,
      fechadoEm: atendimentos.fechadoEm,
      ultimaMensagemEm: atendimentos.ultimaMensagemEm,
    })
    .from(atendimentos)
    .where(and(
      isNull(atendimentos.fechadoEm),
      lt(sql`COALESCE(${atendimentos.ultimaMensagemEm}, ${atendimentos.abertoEm})`, corte),
    ))
    .limit(500);

  let fechados = 0;
  for (const ep of vencidos) {
    const em = fechamentoPorSilencio(ep);
    if (!em) continue;
    await db
      .update(atendimentos)
      .set({ fechadoEm: em, motivoFechamento: "silencio" as MotivoFechamento })
      .where(eq(atendimentos.id, ep.id));
    fechados++;
  }
  return fechados;
}
