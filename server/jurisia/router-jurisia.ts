/**
 * JurisIA (beta) — perguntas sobre um processo do acervo do escritório.
 *
 * O "caso com memória" não é criado por ninguém: ele nasce da primeira
 * pergunta, porque o processo já está no banco. É a diferença estrutural em
 * relação a um assistente que exige o advogado criar o caso e subir os autos.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { checkPermission } from "../escritorio/check-permission";
import {
  eventosProcesso,
  jurisiaConversas,
  jurisiaMensagens,
  jurisiaUso,
  motorMonitoramentos,
} from "../../drizzle/schema";
import { FUSO_HORARIO_PADRAO } from "../../shared/escritorio-types";
import { avaliarCota, competenciaDe, type EstadoCota } from "../../shared/jurisia-cota";
import type { EventoContexto } from "../../shared/jurisia-contexto";
import { perguntarSobreProcesso } from "./perguntar";
import { createLogger } from "../_core/logger";

const log = createLogger("jurisia");

/** Quantos turnos anteriores vão junto — o resto é ruído e token. */
const HISTORICO_TURNOS = 6;

async function contexto(userId: number) {
  const perm = await checkPermission(userId, "processos", "ver");
  if (!perm.allowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sem acesso a processos." });
  }
  const esc = await getEscritorioPorUsuario(userId);
  if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado." });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível." });
  return { db, esc, perm };
}

async function estadoCota(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  escritorioId: number,
  planSlug: string | null,
  fuso: string,
): Promise<{ cota: EstadoCota; competencia: string }> {
  const competencia = competenciaDe(new Date(), fuso);

  let limite = 0;
  if (planSlug) {
    const { getPlanoBySlug } = await import("../billing/planos-repo");
    limite = (await getPlanoBySlug(planSlug))?.limites.jurisiaMensagensMes ?? 0;
  }

  const [row] = await db
    .select({ mensagens: jurisiaUso.mensagens })
    .from(jurisiaUso)
    .where(and(eq(jurisiaUso.escritorioId, escritorioId), eq(jurisiaUso.competencia, competencia)))
    .limit(1);

  return { cota: avaliarCota({ limite, usadas: Number(row?.mensagens ?? 0) }), competencia };
}

async function planoDoUsuario(userId: number): Promise<string | null> {
  const { getActiveSubscriptionComHeranca } = await import("../db");
  const sub = await getActiveSubscriptionComHeranca(userId);
  if (!sub) return null;
  // Cortesia entra pelo plano que estiver marcado; sem plano, sem módulo.
  return sub.planId ?? null;
}

/** Monitoramento do processo, já provado como sendo do escritório. */
async function processoDoEscritorio(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  escritorioId: number,
  monitoramentoId: number,
) {
  const [proc] = await db
    .select({
      id: motorMonitoramentos.id,
      apelido: motorMonitoramentos.apelido,
      searchKey: motorMonitoramentos.searchKey,
      tribunal: motorMonitoramentos.tribunal,
    })
    .from(motorMonitoramentos)
    .where(and(
      eq(motorMonitoramentos.id, monitoramentoId),
      eq(motorMonitoramentos.escritorioId, escritorioId),
    ))
    .limit(1);
  return proc ?? null;
}

function parseAnalise(raw: string | null): { pontos?: string[]; titulo?: string; ato?: string | null } | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const jurisiaRouter = router({
  /** Estado do módulo pra tela decidir o que mostrar antes de qualquer pergunta. */
  estado: protectedProcedure.query(async ({ ctx }) => {
    const { db, esc } = await contexto(ctx.user.id);
    const planSlug = await planoDoUsuario(ctx.user.id);
    const { cota } = await estadoCota(
      db,
      esc.escritorio.id,
      planSlug,
      esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO,
    );
    return { cota };
  }),

  /** A conversa de um processo — cria vazia na primeira visita, sem gravar nada. */
  conversa: protectedProcedure
    .input(z.object({ monitoramentoId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { db, esc } = await contexto(ctx.user.id);
      const proc = await processoDoEscritorio(db, esc.escritorio.id, input.monitoramentoId);
      if (!proc) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado." });

      const [conv] = await db
        .select({ id: jurisiaConversas.id })
        .from(jurisiaConversas)
        .where(and(
          eq(jurisiaConversas.escritorioId, esc.escritorio.id),
          eq(jurisiaConversas.monitoramentoId, input.monitoramentoId),
        ))
        .limit(1);

      const mensagens = conv
        ? await db
          .select({
            id: jurisiaMensagens.id,
            papel: jurisiaMensagens.papel,
            conteudo: jurisiaMensagens.conteudo,
            respostaJson: jurisiaMensagens.respostaJson,
            recusa: jurisiaMensagens.recusa,
            createdAt: jurisiaMensagens.createdAt,
          })
          .from(jurisiaMensagens)
          .where(eq(jurisiaMensagens.conversaId, conv.id))
          .orderBy(asc(jurisiaMensagens.id))
        : [];

      return {
        processo: { id: proc.id, apelido: proc.apelido, cnj: proc.searchKey, tribunal: proc.tribunal },
        mensagens: mensagens.map((m) => ({
          id: m.id,
          papel: m.papel,
          conteudo: m.conteudo,
          resposta: m.respostaJson ? JSON.parse(m.respostaJson) : null,
          recusa: m.recusa,
          createdAt: m.createdAt,
        })),
      };
    }),

  /** Processos que já têm conversa — a coluna "seus casos" ordenada por uso. */
  casosRecentes: protectedProcedure
    .input(z.object({ limite: z.number().int().min(1).max(50).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const { db, esc } = await contexto(ctx.user.id);
      const rows = await db
        .select({
          monitoramentoId: jurisiaConversas.monitoramentoId,
          apelido: motorMonitoramentos.apelido,
          cnj: motorMonitoramentos.searchKey,
          ultimaMensagemAt: jurisiaConversas.ultimaMensagemAt,
        })
        .from(jurisiaConversas)
        .innerJoin(motorMonitoramentos, eq(motorMonitoramentos.id, jurisiaConversas.monitoramentoId))
        .where(eq(jurisiaConversas.escritorioId, esc.escritorio.id))
        .orderBy(desc(jurisiaConversas.ultimaMensagemAt))
        .limit(input?.limite ?? 20);
      return rows;
    }),

  perguntar: protectedProcedure
    .input(z.object({
      monitoramentoId: z.number().int().positive(),
      pergunta: z.string().min(3).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, esc } = await contexto(ctx.user.id);
      const fuso = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;

      const proc = await processoDoEscritorio(db, esc.escritorio.id, input.monitoramentoId);
      if (!proc) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado." });

      const planSlug = await planoDoUsuario(ctx.user.id);
      const { cota, competencia } = await estadoCota(db, esc.escritorio.id, planSlug, fuso);
      if (!cota.pode) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: cota.semPlano
            ? "Seu plano não inclui o JurisIA."
            : `Você usou as ${cota.limite} mensagens do mês.`,
          cause: { motivo: cota.semPlano ? "sem_plano" : "cota_esgotada" },
        });
      }

      // Conversa nasce aqui, na primeira pergunta.
      let [conv] = await db
        .select({ id: jurisiaConversas.id })
        .from(jurisiaConversas)
        .where(and(
          eq(jurisiaConversas.escritorioId, esc.escritorio.id),
          eq(jurisiaConversas.monitoramentoId, input.monitoramentoId),
        ))
        .limit(1);

      if (!conv) {
        await db.insert(jurisiaConversas).values({
          escritorioId: esc.escritorio.id,
          monitoramentoId: input.monitoramentoId,
          titulo: proc.apelido ?? proc.searchKey ?? null,
          criadoPor: esc.colaborador?.id ?? null,
        });
        [conv] = await db
          .select({ id: jurisiaConversas.id })
          .from(jurisiaConversas)
          .where(and(
            eq(jurisiaConversas.escritorioId, esc.escritorio.id),
            eq(jurisiaConversas.monitoramentoId, input.monitoramentoId),
          ))
          .limit(1);
      }
      if (!conv) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Falha ao abrir a conversa." });

      const anteriores = await db
        .select({ papel: jurisiaMensagens.papel, conteudo: jurisiaMensagens.conteudo })
        .from(jurisiaMensagens)
        .where(eq(jurisiaMensagens.conversaId, conv.id))
        .orderBy(desc(jurisiaMensagens.id))
        .limit(HISTORICO_TURNOS);

      const eventosRows = await db
        .select({
          id: eventosProcesso.id,
          dataEvento: eventosProcesso.dataEvento,
          conteudo: eventosProcesso.conteudo,
          resumoIa: eventosProcesso.resumoIa,
          analiseJson: eventosProcesso.analiseJson,
          desfecho: eventosProcesso.desfecho,
          relevancia: eventosProcesso.relevancia,
          teor: eventosProcesso.teor,
        })
        .from(eventosProcesso)
        .where(and(
          eq(eventosProcesso.escritorioId, esc.escritorio.id),
          eq(eventosProcesso.monitoramentoId, input.monitoramentoId),
        ))
        .orderBy(desc(eventosProcesso.dataEvento));

      const eventos: EventoContexto[] = eventosRows.map((r) => {
        const a = parseAnalise(r.analiseJson);
        return {
          id: r.id,
          dataEvento: r.dataEvento.toISOString(),
          titulo: a?.titulo ?? r.resumoIa ?? r.conteudo.slice(0, 160),
          pontos: a?.pontos ?? [],
          ato: a?.ato ?? null,
          desfecho: r.desfecho,
          relevancia: r.relevancia,
          teor: r.teor,
        };
      });

      const resultado = await perguntarSobreProcesso({
        escritorioId: esc.escritorio.id,
        eventos,
        pergunta: input.pergunta,
        historico: anteriores.reverse().map((m) => ({ papel: m.papel, texto: m.conteudo })),
      });

      if (!resultado.ok) {
        log.warn(
          { escritorioId: esc.escritorio.id, monitoramentoId: input.monitoramentoId, motivo: resultado.recusa },
          "JurisIA recusou a resposta do modelo",
        );
      }

      // Grava os dois lados — inclusive a recusa. Recusa que some é recusa
      // que ninguém audita, e é ela que diz se a trava está calibrada.
      await db.insert(jurisiaMensagens).values({
        conversaId: conv.id,
        escritorioId: esc.escritorio.id,
        papel: "usuario",
        conteudo: input.pergunta,
        autorId: esc.colaborador?.id ?? null,
      });
      await db.insert(jurisiaMensagens).values({
        conversaId: conv.id,
        escritorioId: esc.escritorio.id,
        papel: "assistente",
        conteudo: resultado.resposta?.conclusao ?? "",
        respostaJson: resultado.resposta
          ? JSON.stringify({ ...resultado.resposta, fontesDetalhe: resultado.fontes })
          : null,
        recusa: resultado.recusa,
      });

      await db
        .update(jurisiaConversas)
        .set({ ultimaMensagemAt: new Date() })
        .where(eq(jurisiaConversas.id, conv.id));

      // Consome a cota mesmo quando a trava recusou: a chamada ao provedor
      // foi paga do mesmo jeito, e não cobrar abriria caminho pra loop de
      // retentativa em cima de um processo que sempre recusa.
      await db
        .insert(jurisiaUso)
        .values({ escritorioId: esc.escritorio.id, competencia, mensagens: 1 })
        .onDuplicateKeyUpdate({ set: { mensagens: sql`${jurisiaUso.mensagens} + 1` } });

      const { cota: cotaDepois } = await estadoCota(db, esc.escritorio.id, planSlug, fuso);

      return {
        ok: resultado.ok,
        resposta: resultado.resposta,
        recusa: resultado.recusa,
        fontes: resultado.fontes,
        cota: cotaDepois,
      };
    }),
});
