/**
 * JurisIA (beta) — duas entradas, uma cota.
 *
 * 1. CONVERSA DE PROCESSO (`conversa`/`perguntar`): o painel dentro do
 *    processo monitorado. Responde sobre aquele caso a partir das
 *    movimentações dele, e a conversa não é criada por ninguém — nasce da
 *    primeira pergunta, porque o processo já está no banco.
 *
 * 2. CONVERSA ÚNICA (`pesquisas`/`pesquisa`/`conversar`): a tela do JurisIA.
 *    Uma conversa que decide sozinha o que consultar — acervo público do
 *    DataJud, autos e documentos do cliente, base de fontes da casa — em vez
 *    de exigir que o advogado escolha o modo certo antes de perguntar.
 *
 * O que continua separado é o SIGILO, não o assunto: o acervo público é global
 * e igual pra todos os escritórios; o que o motor captura dos autos de um
 * escritório é do cliente dele. Toda leitura de caso passa por `escritorioId`,
 * e nada do escritório entra no acervo. Na tabela, `monitoramentoId` NULL
 * separa a conversa da tela do painel de um processo, e cada consulta prova de
 * que lado está antes de gravar.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
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
import type { AcessoJurisIA } from "../../shared/addon-jurisia";
import type { EventoContexto } from "../../shared/jurisia-contexto";
import type { ConversaUnaGravada } from "../../shared/jurisia-una";
import { perguntarSobreProcesso } from "./perguntar";
import { MODELO_PADRAO, responderUna, TURNOS_NO_CONTEXTO } from "./conversa-una";
import { composicaoDoAcervo } from "./buscar-acervo";
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

/**
 * Cota do mês, já resolvida contra plano E add-on.
 *
 * O `acesso` volta junto porque a tela precisa dizer coisas diferentes pra
 * quem nunca contratou, pra quem deixou vencer e pra quem gastou tudo —
 * oferecer "renove" a quem nunca comprou soa como cobrança de dívida
 * inexistente.
 */
async function estadoCota(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  escritorioId: number,
  planSlug: string | null,
  fuso: string,
): Promise<{ cota: EstadoCota; competencia: string; acesso: AcessoJurisIA }> {
  const competencia = competenciaDe(new Date(), fuso);

  const { acessoJurisIA } = await import("../billing/addons-repo");
  const acesso = await acessoJurisIA({ escritorioId, planSlug });

  const [row] = await db
    .select({ mensagens: jurisiaUso.mensagens })
    .from(jurisiaUso)
    .where(and(eq(jurisiaUso.escritorioId, escritorioId), eq(jurisiaUso.competencia, competencia)))
    .limit(1);

  return {
    cota: avaliarCota({ limite: acesso.limite, usadas: Number(row?.mensagens ?? 0) }),
    competencia,
    acesso,
  };
}

/**
 * O erro que a tela mostra quando não dá pra perguntar.
 *
 * Três situações que parecem uma só e não são: nunca contratou, contratou e
 * venceu, contratou e gastou. Cada uma tem um caminho de saída diferente, e
 * juntar as três em "seu plano não inclui" já mandou cliente pagante pro
 * suporte achando que tinha perdido o acesso.
 */
function erroDeAcesso(cota: EstadoCota, acesso: AcessoJurisIA): TRPCError {
  if (!acesso.liberado) {
    const mensagem = acesso.motivo === "expirado"
      ? "O contrato do JurisIA venceu. Renove pra voltar a pesquisar."
      : acesso.motivo === "suspenso"
        ? "O JurisIA do seu escritório está suspenso. Fale com o suporte."
        : "O JurisIA é contratado à parte e ainda não está ativo no seu escritório.";
    return new TRPCError({
      code: "FORBIDDEN",
      message: mensagem,
      cause: { motivo: acesso.motivo ?? "nao_contratado" },
    });
  }
  return new TRPCError({
    code: "FORBIDDEN",
    message: `Você usou as ${cota.limite} mensagens deste mês. A cota volta na virada.`,
    cause: { motivo: "cota_esgotada" },
  });
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

/**
 * Pesquisa livre do escritório.
 *
 * O `IS NULL` não é detalhe: sem ele, mandar o id de uma conversa de processo
 * pra cá gravaria resposta do acervo público dentro do histórico de um caso do
 * escritório, misturando as duas coisas que o desenho separa.
 */
async function pesquisaDoEscritorio(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  escritorioId: number,
  conversaId: number,
) {
  const [conv] = await db
    .select({
      id: jurisiaConversas.id,
      titulo: jurisiaConversas.titulo,
      contatoId: jurisiaConversas.contatoId,
      processoId: jurisiaConversas.processoId,
    })
    .from(jurisiaConversas)
    .where(and(
      eq(jurisiaConversas.id, conversaId),
      eq(jurisiaConversas.escritorioId, escritorioId),
      isNull(jurisiaConversas.monitoramentoId),
    ))
    .limit(1);
  return conv ?? null;
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
    const { cota, acesso } = await estadoCota(
      db,
      esc.escritorio.id,
      planSlug,
      esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO,
    );
    return { cota, acesso };
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

  /**
   * O que existe no acervo público, em vocabulário do advogado.
   *
   * Devolve as classes e assuntos que existem de fato — sem isso o módulo é
   * adivinhação: digita, erra, e nunca descobre que o acervo só tem execução
   * fiscal.
   */
  acervo: protectedProcedure.query(async ({ ctx }) => {
    await contexto(ctx.user.id);
    return composicaoDoAcervo();
  }),

  renomearPesquisa: protectedProcedure
    .input(z.object({
      conversaId: z.number().int().positive(),
      titulo: z.string().trim().min(1).max(120),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, esc } = await contexto(ctx.user.id);
      const conv = await pesquisaDoEscritorio(db, esc.escritorio.id, input.conversaId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Pesquisa não encontrada." });
      await db
        .update(jurisiaConversas)
        .set({ titulo: input.titulo })
        .where(eq(jurisiaConversas.id, conv.id));
      return { ok: true };
    }),

  excluirPesquisa: protectedProcedure
    .input(z.object({ conversaId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { db, esc } = await contexto(ctx.user.id);
      const conv = await pesquisaDoEscritorio(db, esc.escritorio.id, input.conversaId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Pesquisa não encontrada." });
      // Mensagens primeiro: apagar a conversa antes deixaria as mensagens
      // órfãs, e elas guardam a estatística gravada.
      await db.delete(jurisiaMensagens).where(eq(jurisiaMensagens.conversaId, conv.id));
      await db.delete(jurisiaConversas).where(eq(jurisiaConversas.id, conv.id));
      return { ok: true };
    }),

  /** Pesquisas jurisprudenciais do escritório — as conversas sem processo. */
  pesquisas: protectedProcedure
    .input(z.object({ limite: z.number().int().min(1).max(50).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const { db, esc } = await contexto(ctx.user.id);
      return db
        .select({
          id: jurisiaConversas.id,
          titulo: jurisiaConversas.titulo,
          ultimaMensagemAt: jurisiaConversas.ultimaMensagemAt,
          createdAt: jurisiaConversas.createdAt,
        })
        .from(jurisiaConversas)
        .where(and(
          eq(jurisiaConversas.escritorioId, esc.escritorio.id),
          isNull(jurisiaConversas.monitoramentoId),
        ))
        .orderBy(desc(jurisiaConversas.ultimaMensagemAt), desc(jurisiaConversas.id))
        .limit(input?.limite ?? 30);
    }),

  /** Uma pesquisa. `conversaId` null = aba nova, ainda sem nada gravado. */
  pesquisa: protectedProcedure
    .input(z.object({ conversaId: z.number().int().positive().nullable() }))
    .query(async ({ ctx, input }) => {
      const { db, esc } = await contexto(ctx.user.id);
      if (input.conversaId == null) {
        return { titulo: null, contatoId: null, processoId: null, mensagens: [] };
      }

      const conv = await pesquisaDoEscritorio(db, esc.escritorio.id, input.conversaId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Pesquisa não encontrada." });

      const mensagens = await db
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
        .orderBy(asc(jurisiaMensagens.id));

      return {
        titulo: conv.titulo,
        // O caso volta junto: reabrir a conversa e continuar perguntando sem os
        // autos que ela usava era responder outra coisa com a mesma cara.
        contatoId: conv.contatoId,
        processoId: conv.processoId,
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

  /**
   * Um turno da conversa única.
   *
   * Uma procedure só, e é ela que decide o que consultar: o acervo público, os
   * autos do cliente, os documentos anexados, a base de fontes do escritório —
   * o que couber, sem o advogado ter que escolher o modo certo antes de
   * perguntar. Sem `conversaId`, a conversa nasce aqui, como sempre foi: não
   * existe "criar conversa" antes de ter o que perguntar.
   *
   * O caso vem da tela e é gravado na conversa. `contatoId: null` é escolha
   * ("tirei o caso"), não omissão — por isso o que chega manda sobre o que
   * estava gravado.
   */
  conversar: protectedProcedure
    .input(z.object({
      conversaId: z.number().int().positive().nullish(),
      pergunta: z.string().min(3).max(4000),
      contatoId: z.number().int().positive().nullish(),
      processoId: z.number().int().positive().nullish(),
      modelo: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, esc } = await contexto(ctx.user.id);
      const fuso = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;

      const planSlug = await planoDoUsuario(ctx.user.id);
      const { cota, competencia, acesso } = await estadoCota(db, esc.escritorio.id, planSlug, fuso);
      if (!cota.pode) throw erroDeAcesso(cota, acesso);

      const contatoId = input.contatoId ?? null;
      const processoId = input.processoId ?? null;

      let conversaId = input.conversaId ?? null;
      if (conversaId != null) {
        const existente = await pesquisaDoEscritorio(db, esc.escritorio.id, conversaId);
        if (!existente) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada." });
        }
        if (existente.contatoId !== contatoId || existente.processoId !== processoId) {
          await db
            .update(jurisiaConversas)
            .set({ contatoId, processoId })
            .where(eq(jurisiaConversas.id, conversaId));
        }
      } else {
        const [inserida] = await db.insert(jurisiaConversas).values({
          escritorioId: esc.escritorio.id,
          monitoramentoId: null,
          contatoId,
          processoId,
          titulo: input.pergunta.slice(0, 200),
          criadoPor: esc.colaborador?.id ?? null,
          ultimaMensagemAt: new Date(),
        });
        conversaId = Number((inserida as { insertId: number }).insertId);
      }

      const anteriores = await db
        .select({ papel: jurisiaMensagens.papel, conteudo: jurisiaMensagens.conteudo })
        .from(jurisiaMensagens)
        .where(eq(jurisiaMensagens.conversaId, conversaId))
        .orderBy(desc(jurisiaMensagens.id))
        .limit(TURNOS_NO_CONTEXTO);

      const r = await responderUna(db, {
        escritorioId: esc.escritorio.id,
        escritorioNome: esc.escritorio.nome,
        advogado: (ctx.user as { name?: string | null }).name ?? null,
        pergunta: input.pergunta,
        historico: anteriores.reverse().map((m) => ({ papel: m.papel, texto: m.conteudo })),
        contatoId,
        processoId,
        modelo: input.modelo || MODELO_PADRAO,
      });

      if (r.erro) {
        log.warn({ escritorioId: esc.escritorio.id, conversaId, motivo: r.erro }, "JurisIA não respondeu");
      }

      const gravada: ConversaUnaGravada | null = r.erro
        ? null
        : {
          tipo: "una",
          texto: r.texto,
          prova: r.prova,
          consulta: r.consulta,
          naoLidos: r.naoLidos,
          avisos: r.avisos,
          caso: r.caso,
        };

      await db.insert(jurisiaMensagens).values({
        conversaId,
        escritorioId: esc.escritorio.id,
        papel: "usuario",
        conteudo: input.pergunta,
        autorId: esc.colaborador?.id ?? null,
      });
      await db.insert(jurisiaMensagens).values({
        conversaId,
        escritorioId: esc.escritorio.id,
        papel: "assistente",
        conteudo: r.texto,
        respostaJson: gravada ? JSON.stringify(gravada) : null,
        recusa: r.erro,
      });

      // Título da conversa nova ganha o nome do cliente assim que ele é
      // conhecido — a lista lateral com quatro "Como prosseguir nesse caso?"
      // não distingue nada.
      const patch: { ultimaMensagemAt: Date; titulo?: string } = { ultimaMensagemAt: new Date() };
      if (input.conversaId == null && r.caso?.nome) {
        patch.titulo = `${r.caso.nome} — ${input.pergunta.slice(0, 80)}`.slice(0, 200);
      }
      await db.update(jurisiaConversas).set(patch).where(eq(jurisiaConversas.id, conversaId));

      // Turno que não produziu resposta não é cobrado: a falha foi nossa (ou do
      // provedor), e cobrar por ela é a conta que o cliente confere e não
      // perdoa.
      const cobrou = !r.erro;
      if (cobrou) {
        await db
          .insert(jurisiaUso)
          .values({ escritorioId: esc.escritorio.id, competencia, mensagens: 1 })
          .onDuplicateKeyUpdate({ set: { mensagens: sql`${jurisiaUso.mensagens} + 1` } });
      }

      const { cota: cotaDepois } = await estadoCota(db, esc.escritorio.id, planSlug, fuso);

      return { conversaId, resposta: gravada, erro: r.erro, cobrou, cota: cotaDepois };
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
      const { cota, competencia, acesso } = await estadoCota(db, esc.escritorio.id, planSlug, fuso);
      if (!cota.pode) throw erroDeAcesso(cota, acesso);

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
