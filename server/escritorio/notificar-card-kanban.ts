/**
 * Notifica um colaborador que ficou responsável por um card do Kanban.
 *
 * Insere linha na tabela `notificacoes` (entra na lista persistente do sino
 * e é refeita pelas queries de listar/contarNaoLidas) e dispara um evento
 * SSE pra exibir toast em tempo real (`useNotificacoes`).
 *
 * Skip silencioso quando o atribuidor é o próprio colaborador alvo — evita
 * que o usuário receba notificação de algo que ele mesmo fez.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { notificacoes, colaboradores } from "../../drizzle/schema";
import { emitirNotificacao } from "../_core/sse-notifications";
import { createLogger } from "../_core/logger";

const log = createLogger("notificar-card-kanban");

export type AcaoNotificacaoCard = "criado" | "atribuido";

export async function notificarCardAtribuido(args: {
  cardId: number;
  responsavelColaboradorId: number;
  /** userId de quem disparou a ação. `null` quando vem de uma automação Smartflow. */
  atribuidorUserId: number | null;
  acao: AcaoNotificacaoCard;
  tituloCard: string;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const [colab] = await db
      .select({ userId: colaboradores.userId, ativo: colaboradores.ativo })
      .from(colaboradores)
      .where(eq(colaboradores.id, args.responsavelColaboradorId))
      .limit(1);
    if (!colab || !colab.ativo) return;

    if (args.atribuidorUserId !== null && colab.userId === args.atribuidorUserId) {
      return;
    }

    const titulo =
      args.acao === "criado" ? "Novo card no Kanban" : "Card atribuído a você";
    const mensagem = args.tituloCard;

    await db.insert(notificacoes).values({
      userId: colab.userId,
      titulo,
      mensagem,
      tipo: "sistema",
    });

    emitirNotificacao(colab.userId, {
      tipo: "info",
      titulo,
      mensagem,
      dados: { cardId: args.cardId, fonte: "kanban" },
    });
  } catch (err: any) {
    log.error("Erro ao notificar responsável do card:", err.message);
  }
}
