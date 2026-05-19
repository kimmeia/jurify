/**
 * Router de prazos sugeridos — inbox de sugestões automáticas detectadas
 * pelo cron de monitoramento em movimentações processuais.
 *
 * Fluxo do usuário:
 *   1. Cron detecta padrão "Audiência designada para DD/MM" ou
 *      "Prazo de 15 dias" → cria entrada em `prazos_sugeridos`
 *   2. User abre /processos → vê badge "N sugestões pendentes"
 *   3. Lista sugestões via `listar`
 *   4. Aprova (vira `agendamentos` real) ou descarta
 *
 * Procedures:
 *   - listar: pendentes ordenadas por dataSugerida
 *   - aprovar: cria agendamento + marca como aprovado
 *   - descartar: marca como descartado (NÃO deleta — audit + previne
 *     re-detecção pelo cron)
 *   - contador: count rápido pra badge
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, asc, isNull, or } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { checkPermission } from "../escritorio/check-permission";
import {
  prazosSugeridos,
  agendamentos,
  motorMonitoramentos,
  eventosProcesso,
} from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("router-prazos-sugeridos");

export const prazosSugeridosRouter = router({
  /** Lista sugestões pendentes do escritório, ordenadas por data sugerida ASC. */
  listar: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(["pendente", "aprovado", "descartado", "todos"]).default("pendente"),
          limite: z.number().int().min(1).max(100).default(50),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "processos", "ver");
      if (!perm.allowed) return [];

      const db = await getDb();
      if (!db) return [];

      const status = input?.status ?? "pendente";
      const limite = input?.limite ?? 50;

      const conds = [eq(prazosSugeridos.escritorioId, perm.escritorioId)];
      if (status !== "todos") conds.push(eq(prazosSugeridos.status, status));

      // JOIN com motorMonitoramentos pra trazer apelido do processo
      const rows = await db
        .select({
          sug: prazosSugeridos,
          monApelido: motorMonitoramentos.apelido,
          monTribunal: motorMonitoramentos.tribunal,
        })
        .from(prazosSugeridos)
        .leftJoin(
          motorMonitoramentos,
          eq(prazosSugeridos.monitoramentoId, motorMonitoramentos.id),
        )
        .where(and(...conds))
        .orderBy(asc(prazosSugeridos.dataSugerida))
        .limit(limite);

      return rows.map((r) => ({
        id: r.sug.id,
        eventoId: r.sug.eventoId,
        monitoramentoId: r.sug.monitoramentoId,
        apelidoProcesso: r.monApelido ?? "Processo",
        cnj: r.sug.cnjAfetado ?? "",
        tribunal: (r.monTribunal ?? "").toUpperCase(),
        tipo: r.sug.tipo,
        titulo: r.sug.titulo,
        dataSugerida: r.sug.dataSugerida ? r.sug.dataSugerida.toISOString() : null,
        prazoDias: r.sug.prazoDias,
        prazoUteis: r.sug.prazoUteis,
        motivo: r.sug.motivo,
        trechoOrigem: r.sug.trechoOrigem,
        status: r.sug.status,
        agendamentoId: r.sug.agendamentoId,
        criadoEm: r.sug.criadoEm?.toISOString() ?? "",
      }));
    }),

  /** Contador rápido pra badge "N sugestões pendentes". */
  contador: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "processos", "ver");
    if (!perm.allowed) return { pendentes: 0 };

    const db = await getDb();
    if (!db) return { pendentes: 0 };

    const rows = await db
      .select({ id: prazosSugeridos.id })
      .from(prazosSugeridos)
      .where(
        and(
          eq(prazosSugeridos.escritorioId, perm.escritorioId),
          eq(prazosSugeridos.status, "pendente"),
        ),
      );

    return { pendentes: rows.length };
  }),

  /**
   * Aprova sugestão: cria `agendamentos` com os dados (eventualmente
   * ajustados pelo usuário) e marca a sugestão como aprovada.
   *
   * `ajustes` permite o user editar título/data/responsável antes de
   * confirmar — UI mostra um modal pré-preenchido.
   */
  aprovar: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        ajustes: z
          .object({
            titulo: z.string().min(1).max(255).optional(),
            dataInicio: z.string().optional(),
            descricao: z.string().max(2000).optional(),
            responsavelId: z.number().int().positive().optional(),
            prioridade: z.enum(["baixa", "normal", "alta", "critica"]).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const [sug] = await db
        .select()
        .from(prazosSugeridos)
        .where(
          and(
            eq(prazosSugeridos.id, input.id),
            eq(prazosSugeridos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!sug) throw new TRPCError({ code: "NOT_FOUND", message: "Sugestão não encontrada" });
      if (sug.status !== "pendente") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Sugestão já foi ${sug.status === "aprovado" ? "aprovada" : "descartada"}`,
        });
      }

      const dataInicio = input.ajustes?.dataInicio
        ? new Date(input.ajustes.dataInicio)
        : sug.dataSugerida ?? new Date();
      if (Number.isNaN(dataInicio.getTime())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Data inválida" });
      }

      const tipoAgendamento = sug.tipo === "audiencia" ? "audiencia" : "prazo_processual";

      // Cria agendamento. Sem `contatoId`/`processoId` por enquanto —
      // mapear CNJ → contato/processo seria nice-to-have futuro.
      const [insertRes] = await db.insert(agendamentos).values({
        escritorioId: esc.escritorio.id,
        criadoPorId: esc.colaborador.id,
        responsavelId: input.ajustes?.responsavelId ?? esc.colaborador.id,
        tipo: tipoAgendamento,
        titulo: input.ajustes?.titulo ?? sug.titulo,
        descricao:
          input.ajustes?.descricao ??
          [
            sug.motivo,
            sug.cnjAfetado ? `CNJ: ${sug.cnjAfetado}` : null,
            sug.trechoOrigem ? `Trecho: ${sug.trechoOrigem}` : null,
          ]
            .filter(Boolean)
            .join("\n\n"),
        dataInicio,
        prioridade: input.ajustes?.prioridade ?? (sug.tipo === "audiencia" ? "alta" : "normal"),
        status: "pendente",
        diaInteiro: sug.tipo === "prazo_processual",
      });

      const agendamentoId = (insertRes as { insertId: number }).insertId;

      await db
        .update(prazosSugeridos)
        .set({
          status: "aprovado",
          aprovadoEm: new Date(),
          agendamentoId,
        })
        .where(eq(prazosSugeridos.id, input.id));

      log.info(
        { sugestaoId: input.id, agendamentoId, tipo: sug.tipo },
        "[prazos-sugeridos] sugestão aprovada — agendamento criado",
      );

      return { agendamentoId };
    }),

  /**
   * Descarta sugestão (NÃO deleta — mantém pra audit + UNIQUE evento_id
   * evita re-detecção pelo cron).
   */
  descartar: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const [sug] = await db
        .select()
        .from(prazosSugeridos)
        .where(
          and(
            eq(prazosSugeridos.id, input.id),
            eq(prazosSugeridos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!sug) throw new TRPCError({ code: "NOT_FOUND", message: "Sugestão não encontrada" });
      if (sug.status !== "pendente") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Sugestão já foi ${sug.status === "aprovado" ? "aprovada" : "descartada"}`,
        });
      }

      await db
        .update(prazosSugeridos)
        .set({ status: "descartado", descartadoEm: new Date() })
        .where(eq(prazosSugeridos.id, input.id));

      return { ok: true };
    }),
});
