/**
 * Restaurar cards que sumiram do quadro.
 *
 * Excluir uma coluna leva os cards junto e não deixa nada no banco além de
 * histórico órfão, que não guarda o nome. Quando isso acontece, o relatório
 * em PDF emitido antes do estrago vira o único lugar onde aqueles nomes ainda
 * existem — e este router é o caminho de volta.
 *
 * Duas travas que definem o que isto é:
 *
 *   · só CRIA. Nenhum card existente é alterado, movido ou apagado. Card que
 *     ainda está no quadro é reconhecido e deixado em paz; card que alguém já
 *     refez na mão é pulado, senão a restauração viraria duplicata.
 *   · nada é criado no cadastro. Colaborador e cliente são procurados pelo
 *     nome impresso; se não achar, o campo fica vazio e o card entra assim
 *     mesmo. Inventar cliente a partir de um nome truncado num PDF seria
 *     bem pior do que um card sem vínculo.
 *
 * O `createdAt` original é preservado de propósito. Recriar com a data de hoje
 * apagaria a idade do card, que é o que diz há quanto tempo aquilo está
 * parado — e o quadro perderia justamente a informação que motivou o resgate.
 */

import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  colaboradores,
  contatos,
  kanbanCards,
  kanbanColunas,
  kanbanFunis,
  users,
} from "../../drizzle/schema";
import { checkPermission } from "./check-permission";
import { createLogger } from "../_core/logger";
import { lerRelatorioDeCards } from "./kanban-relatorio-parser";
import { lerDataBR, lerPrazoBR, montarPlano } from "./kanban-restaurar";

const log = createLogger("kanban-restaurar");

/** PDF de relatório é pequeno (17 páginas ≈ 80 KB). O teto é folgado. */
const MAX_PDF_BYTES = 12 * 1024 * 1024;

/** Restaurar é reconstruir o quadro dos outros: dono e gestor, só. */
async function exigirDonoOuGestor(userId: number) {
  const perm = await checkPermission(userId, "kanban", "criar");
  if (!perm.allowed || !perm.verTodos) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Só dono ou gestor pode restaurar cards.",
    });
  }
  return perm;
}

async function contextoDoFunil(db: any, escritorioId: number, funilId: number) {
  const [funil] = await db
    .select({ id: kanbanFunis.id, nome: kanbanFunis.nome })
    .from(kanbanFunis)
    .where(and(eq(kanbanFunis.id, funilId), eq(kanbanFunis.escritorioId, escritorioId)))
    .limit(1);
  if (!funil) throw new TRPCError({ code: "NOT_FOUND", message: "Funil não encontrado." });

  const cols = await db
    .select({ id: kanbanColunas.id, nome: kanbanColunas.nome })
    .from(kanbanColunas)
    .where(eq(kanbanColunas.funilId, funilId));

  // Todos os cards do escritório, não só os do funil: card que sumiu de uma
  // coluna pode ter sido recriado em outro lugar do quadro, e recriá-lo de
  // novo geraria duplicata.
  const cards = await db
    .select({
      id: kanbanCards.id,
      titulo: kanbanCards.titulo,
      colunaId: kanbanCards.colunaId,
      criadoEm: kanbanCards.createdAt,
    })
    .from(kanbanCards)
    .where(eq(kanbanCards.escritorioId, escritorioId));

  return { funil, cols, cards };
}

export const kanbanRestaurarRouter = router({
  /** Lê o PDF e devolve o que vai acontecer com cada linha. Não grava nada. */
  analisar: protectedProcedure
    .input(
      z.object({
        funilId: z.number().int().positive(),
        pdfBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await exigirDonoOuGestor(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const buffer = Buffer.from(input.pdfBase64, "base64");
      if (buffer.length === 0 || buffer.length > MAX_PDF_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo vazio ou grande demais." });
      }

      let relatorio;
      try {
        relatorio = await lerRelatorioDeCards(buffer);
      } catch (err) {
        log.error({ err: String(err) }, "não deu pra ler o PDF do relatório");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Não consegui ler esse PDF. Ele precisa ser um relatório de cards do Kanban.",
        });
      }
      if (relatorio.linhas.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Não achei nenhum card nesse PDF. Confira se é o relatório certo.",
        });
      }

      const { cols, cards } = await contextoDoFunil(db, perm.escritorioId, input.funilId);

      // `users.name` é opcional no cadastro. Colaborador sem nome não casa
      // com nada impresso no relatório, então entra como string vazia e o
      // resultado é "não encontrei" — que é a resposta certa.
      const timeCru = await db
        .select({ id: colaboradores.id, nome: users.name })
        .from(colaboradores)
        .innerJoin(users, eq(colaboradores.userId, users.id))
        .where(eq(colaboradores.escritorioId, perm.escritorioId));
      const time = timeCru.map((c: { id: number; nome: string | null }) => ({
        id: c.id,
        nome: c.nome ?? "",
      }));
      const carteira = await db
        .select({ id: contatos.id, nome: contatos.nome })
        .from(contatos)
        .where(eq(contatos.escritorioId, perm.escritorioId));

      const plano = montarPlano({
        linhas: relatorio.linhas,
        cards,
        colunas: cols,
        colaboradores: time,
        clientes: carteira,
      });

      return {
        ...plano,
        emitidoEm: relatorio.emitidoEm,
        totalDeclarado: relatorio.totalDeclarado,
        colunas: cols,
        time,
      };
    }),

  /**
   * Cria os cards escolhidos. O cliente devolve o que revisou; o servidor
   * reconfere coluna, responsável e cliente contra o próprio escritório —
   * id que chega de fora nunca é aceito de graça.
   */
  restaurar: protectedProcedure
    .input(
      z.object({
        funilId: z.number().int().positive(),
        cards: z
          .array(
            z.object({
              titulo: z.string().min(1).max(255),
              colunaId: z.number().int().positive(),
              responsavelId: z.number().int().positive().nullable(),
              clienteId: z.number().int().positive().nullable(),
              cadastrado: z.string(),
              prazo: z.string().optional(),
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await exigirDonoOuGestor(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { cols } = await contextoDoFunil(db, perm.escritorioId, input.funilId);
      const colunasValidas = new Set(cols.map((c: { id: number }) => c.id));

      const idsResp = [...new Set(input.cards.map((c) => c.responsavelId).filter(Boolean))] as number[];
      const idsCli = [...new Set(input.cards.map((c) => c.clienteId).filter(Boolean))] as number[];

      const respValidos = new Set(
        idsResp.length
          ? (
              await db
                .select({ id: colaboradores.id })
                .from(colaboradores)
                .where(
                  and(
                    inArray(colaboradores.id, idsResp),
                    eq(colaboradores.escritorioId, perm.escritorioId),
                  ),
                )
            ).map((r: { id: number }) => r.id)
          : [],
      );
      const cliValidos = new Set(
        idsCli.length
          ? (
              await db
                .select({ id: contatos.id })
                .from(contatos)
                .where(
                  and(inArray(contatos.id, idsCli), eq(contatos.escritorioId, perm.escritorioId)),
                )
            ).map((r: { id: number }) => r.id)
          : [],
      );

      let criados = 0;
      for (const c of input.cards) {
        if (!colunasValidas.has(c.colunaId)) continue;
        const cadastro = lerDataBR(c.cadastrado);
        await db.insert(kanbanCards).values({
          escritorioId: perm.escritorioId,
          colunaId: c.colunaId,
          titulo: c.titulo,
          clienteId: c.clienteId && cliValidos.has(c.clienteId) ? c.clienteId : null,
          responsavelId: c.responsavelId && respValidos.has(c.responsavelId) ? c.responsavelId : null,
          prazo: lerPrazoBR(c.prazo ?? "", cadastro),
          // A idade do card é o dado que motivou o resgate — nascer "hoje"
          // apagaria justamente ela.
          ...(cadastro ? { createdAt: cadastro } : {}),
        });
        criados++;
      }

      log.info(
        { criados, pedidos: input.cards.length, escritorioId: perm.escritorioId },
        "cards restaurados a partir de relatório",
      );
      return { criados, ignorados: input.cards.length - criados };
    }),
});
