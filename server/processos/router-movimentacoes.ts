/**
 * Central de movimentações — a tela onde o advogado resolve o dia sem abrir
 * processo nenhum.
 *
 * O agrupamento é a feature, não a lista: o que separa "25 movimentações"
 * (informação inútil) de "3 exigem ação sua" (o dia inteiro resolvido) é
 * saber de quais delas nasce um prazo NOSSO. Por isso a triagem sai do
 * cruzamento entre a análise IA e a sugestão de prazo pendente, e não de um
 * campo só.
 *
 *   exigem_acao — tem prazo/audiência pendente esperando decisão do advogado
 *   relevante    — vale ler, mas nada a fazer agora
 *   rotina       — expediente; existe pra não sumir, não pra ser lido
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, or, sql, like } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { checkPermission } from "../escritorio/check-permission";
import { eventosProcesso, motorMonitoramentos, prazosSugeridos } from "../../drizzle/schema";
import { diasUteisAte } from "./prazo-processual";
import { localizarTrecho } from "./teor-documento";
import type { AnaliseMovimentacao } from "./resumir-movimentacao";

export type Grupo = "exigem_acao" | "relevante" | "rotina";

function parseAnaliseJson(raw: string | null): AnaliseMovimentacao | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AnaliseMovimentacao;
  } catch {
    return null;
  }
}

/**
 * Decide o grupo de uma movimentação.
 *
 * Prazo pendente manda em tudo — mesmo que a IA tenha achado a movimentação
 * chata, se existe prazo esperando decisão o advogado precisa ver. Na falta
 * de análise (movimentação antiga, IA fora), cai em `relevante` em vez de
 * `rotina`: esconder algo que não foi lido é pior que mostrar demais.
 */
export function classificarGrupo(params: {
  relevancia: "relevante" | "rotina" | null;
  temPrazoPendente: boolean;
  analise: AnaliseMovimentacao | null;
}): Grupo {
  if (params.temPrazoPendente) return "exigem_acao";
  if (params.analise?.providencia.exigida) return "exigem_acao";
  if (params.relevancia === "rotina") return "rotina";
  return "relevante";
}

export const movimentacoesRouter = router({
  /**
   * Feed da central. Devolve as movimentações já agrupadas e com tudo que o
   * card precisa — o client não faz nenhuma conta de prazo nem de grupo.
   */
  central: protectedProcedure
    .input(
      z
        .object({
          busca: z.string().max(200).optional(),
          /** Janela em dias a partir de hoje. */
          dias: z.number().int().min(1).max(365).default(7),
          grupos: z.array(z.enum(["exigem_acao", "relevante", "rotina"])).optional(),
          somenteNaoLidas: z.boolean().optional(),
          limite: z.number().int().min(1).max(200).default(80),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "processos", "ver");
      if (!perm.allowed) {
        return { itens: [], contagem: { exigem_acao: 0, relevante: 0, rotina: 0 }, total: 0 };
      }

      const db = await getDb();
      if (!db) {
        return { itens: [], contagem: { exigem_acao: 0, relevante: 0, rotina: 0 }, total: 0 };
      }

      const dias = input?.dias ?? 7;
      const limite = input?.limite ?? 80;
      const desde = new Date(Date.now() - dias * 86_400_000);

      const conds = [
        eq(eventosProcesso.escritorioId, perm.escritorioId),
        eq(eventosProcesso.tipo, "movimentacao"),
        gte(eventosProcesso.dataEvento, desde),
      ];
      if (input?.somenteNaoLidas) conds.push(eq(eventosProcesso.lido, false));

      const termo = input?.busca?.trim();
      if (termo) {
        const padrao = `%${termo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        conds.push(
          or(
            like(eventosProcesso.conteudo, padrao),
            like(eventosProcesso.resumoIa, padrao),
            like(eventosProcesso.cnjAfetado, padrao),
            like(eventosProcesso.teor, padrao),
            like(motorMonitoramentos.apelido, padrao),
          )!,
        );
      }

      const rows = await db
        .select({
          id: eventosProcesso.id,
          dataEvento: eventosProcesso.dataEvento,
          conteudo: eventosProcesso.conteudo,
          resumoIa: eventosProcesso.resumoIa,
          desfecho: eventosProcesso.desfecho,
          relevancia: eventosProcesso.relevancia,
          analiseJson: eventosProcesso.analiseJson,
          teor: eventosProcesso.teor,
          teorStatus: eventosProcesso.teorStatus,
          teorErro: eventosProcesso.teorErro,
          cnjAfetado: eventosProcesso.cnjAfetado,
          lido: eventosProcesso.lido,
          monitoramentoId: eventosProcesso.monitoramentoId,
          apelido: motorMonitoramentos.apelido,
          tribunal: motorMonitoramentos.tribunal,
          prazoId: prazosSugeridos.id,
          prazoTipo: prazosSugeridos.tipo,
          prazoTitulo: prazosSugeridos.titulo,
          prazoData: prazosSugeridos.dataSugerida,
          prazoDias: prazosSugeridos.prazoDias,
          prazoUteis: prazosSugeridos.prazoUteis,
          prazoMotivo: prazosSugeridos.motivo,
          prazoStatus: prazosSugeridos.status,
        })
        .from(eventosProcesso)
        .leftJoin(
          motorMonitoramentos,
          eq(motorMonitoramentos.id, eventosProcesso.monitoramentoId),
        )
        .leftJoin(prazosSugeridos, eq(prazosSugeridos.eventoId, eventosProcesso.id))
        .where(and(...conds))
        .orderBy(desc(eventosProcesso.dataEvento))
        .limit(limite);

      const hoje = new Date();
      const contagem: Record<Grupo, number> = { exigem_acao: 0, relevante: 0, rotina: 0 };

      const itens = rows.map((r) => {
        const analise = parseAnaliseJson(r.analiseJson);
        const temPrazoPendente = !!r.prazoId && r.prazoStatus === "pendente";
        const grupo = classificarGrupo({
          relevancia: r.relevancia,
          temPrazoPendente,
          analise,
        });
        contagem[grupo]++;

        return {
          id: r.id,
          grupo,
          dataEvento: r.dataEvento,
          cliente: r.apelido ?? r.cnjAfetado ?? "(sem apelido)",
          cnj: r.cnjAfetado,
          tribunal: r.tribunal,
          monitoramentoId: r.monitoramentoId,
          lido: r.lido,
          /** Manchete da IA; sem análise, o rótulo cru do tribunal. */
          titulo: analise?.titulo ?? r.resumoIa ?? r.conteudo.slice(0, 160),
          pontos: analise?.pontos ?? [],
          ato: analise?.ato ?? null,
          desfecho: r.desfecho,
          relevancia: r.relevancia,
          citacao: analise?.providencia.citacao ?? null,
          consequencia: analise?.providencia.consequencia ?? null,
          teorStatus: r.teorStatus,
          teorErro: r.teorErro,
          temTeor: !!r.teor,
          prazo:
            r.prazoId && r.prazoData
              ? {
                  id: r.prazoId,
                  tipo: r.prazoTipo,
                  titulo: r.prazoTitulo,
                  data: r.prazoData,
                  dias: r.prazoDias,
                  uteis: r.prazoUteis,
                  motivo: r.prazoMotivo,
                  status: r.prazoStatus,
                  diasUteisRestantes: diasUteisAte(r.prazoData, hoje),
                }
              : null,
        };
      });

      // O filtro de grupo é aplicado depois de classificar, mas a contagem
      // reflete tudo — senão o chip "Com prazo" zeraria os outros contadores e
      // o advogado perderia a noção do que sobrou.
      const filtrados = input?.grupos?.length
        ? itens.filter((i) => input.grupos!.includes(i.grupo))
        : itens;

      return { itens: filtrados, contagem, total: itens.length };
    }),

  /**
   * Detalhe completo de uma movimentação — inclui o teor inteiro e as
   * movimentações vizinhas do mesmo processo (o "o que veio antes", que é o
   * que evita ter que abrir os autos pra entender o contexto).
   */
  detalhe: protectedProcedure
    .input(z.object({ eventoId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Movimentação não encontrada" });

      const [row] = await db
        .select({
          ev: eventosProcesso,
          apelido: motorMonitoramentos.apelido,
          searchKey: motorMonitoramentos.searchKey,
          searchType: motorMonitoramentos.searchType,
          tribunal: motorMonitoramentos.tribunal,
        })
        .from(eventosProcesso)
        .leftJoin(motorMonitoramentos, eq(motorMonitoramentos.id, eventosProcesso.monitoramentoId))
        .where(eq(eventosProcesso.id, input.eventoId))
        .limit(1);

      // Mesma mensagem pra "não existe" e "não é do seu escritório": vazar a
      // diferença permite varrer IDs e descobrir o que os outros monitoram.
      if (!row || row.ev.escritorioId !== esc.escritorio.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Movimentação não encontrada" });
      }

      const [prazo] = await db
        .select()
        .from(prazosSugeridos)
        .where(eq(prazosSugeridos.eventoId, input.eventoId))
        .limit(1);

      // Contexto: as 3 movimentações anteriores do MESMO processo.
      const anteriores = row.ev.cnjAfetado
        ? await db
            .select({
              id: eventosProcesso.id,
              dataEvento: eventosProcesso.dataEvento,
              conteudo: eventosProcesso.conteudo,
              resumoIa: eventosProcesso.resumoIa,
              relevancia: eventosProcesso.relevancia,
            })
            .from(eventosProcesso)
            .where(
              and(
                eq(eventosProcesso.escritorioId, esc.escritorio.id),
                eq(eventosProcesso.cnjAfetado, row.ev.cnjAfetado),
                sql`${eventosProcesso.dataEvento} < ${row.ev.dataEvento}`,
              ),
            )
            .orderBy(desc(eventosProcesso.dataEvento))
            .limit(3)
        : [];

      const analise = parseAnaliseJson(row.ev.analiseJson);
      const citacao = analise?.providencia.citacao ?? null;

      return {
        id: row.ev.id,
        dataEvento: row.ev.dataEvento,
        /** Rótulo cru do tribunal — fica visível porque é o que aparece no PJe. */
        rotulo: row.ev.conteudo,
        titulo: analise?.titulo ?? row.ev.resumoIa ?? row.ev.conteudo.slice(0, 160),
        pontos: analise?.pontos ?? [],
        ato: analise?.ato ?? null,
        desfecho: row.ev.desfecho,
        relevancia: row.ev.relevancia,
        providencia: analise?.providencia ?? null,
        teor: row.ev.teor,
        teorStatus: row.ev.teorStatus,
        teorErro: row.ev.teorErro,
        teorUrl: row.ev.teorUrl,
        teorNome: row.ev.teorNome,
        /** Trecho literal a grifar dentro do teor, quando bate de fato. */
        trechoGrifado: citacao && row.ev.teor ? localizarTrecho(row.ev.teor, citacao) : null,
        cnj: row.ev.cnjAfetado,
        tribunal: row.tribunal,
        cliente: row.apelido,
        searchKey: row.searchKey,
        searchType: row.searchType,
        monitoramentoId: row.ev.monitoramentoId,
        lido: row.ev.lido,
        fonte: row.ev.fonte,
        coletadoEm: row.ev.createdAt,
        prazo: prazo
          ? {
              id: prazo.id,
              tipo: prazo.tipo,
              titulo: prazo.titulo,
              data: prazo.dataSugerida,
              dias: prazo.prazoDias,
              uteis: prazo.prazoUteis,
              motivo: prazo.motivo,
              trechoOrigem: prazo.trechoOrigem,
              status: prazo.status,
              diasUteisRestantes: prazo.dataSugerida
                ? diasUteisAte(prazo.dataSugerida, new Date())
                : null,
            }
          : null,
        anteriores: anteriores.map((a) => ({
          id: a.id,
          dataEvento: a.dataEvento,
          titulo: a.resumoIa ?? a.conteudo.slice(0, 140),
          relevancia: a.relevancia,
        })),
      };
    }),

  /**
   * Analisa (ou reanalisa) uma movimentação sob demanda.
   *
   * Existe porque nem tudo passa pelo cron: movimentação antiga (anterior ao
   * teor), as que ficaram além do teto de 3 por consulta, e as em que a IA
   * estava fora na hora. Sem isso o advogado fica olhando um card vazio sem
   * ter o que fazer.
   */
  analisar: protectedProcedure
    .input(z.object({ eventoId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "processos", "ver");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem acesso a processos" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const [row] = await db
        .select({
          ev: eventosProcesso,
          apelido: motorMonitoramentos.apelido,
          searchKey: motorMonitoramentos.searchKey,
        })
        .from(eventosProcesso)
        .leftJoin(motorMonitoramentos, eq(motorMonitoramentos.id, eventosProcesso.monitoramentoId))
        .where(eq(eventosProcesso.id, input.eventoId))
        .limit(1);

      if (!row || row.ev.escritorioId !== perm.escritorioId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Movimentação não encontrada" });
      }

      const { analisarMovimentacao, modeloParaEscritorio } = await import("./resumir-movimentacao");
      const { persistirAnalise } = await import("./aplicar-analise");

      const modelo = await modeloParaEscritorio(perm.escritorioId);
      const analise = await analisarMovimentacao(
        {
          rotulo: row.ev.conteudo,
          teor: row.ev.teor,
          dataEvento: row.ev.dataEvento,
        },
        modelo,
        { escritorioId: perm.escritorioId, nomeCliente: row.apelido ?? undefined },
      );

      if (!analise) {
        return {
          ok: false as const,
          motivo: row.ev.teor
            ? "A IA não respondeu. Verifique a chave em Configurações → Integrações."
            : "Sem o documento, não há o que analisar além do rótulo do tribunal.",
        };
      }

      const { prazoCriado } = await persistirAnalise({
        eventoId: row.ev.id,
        escritorioId: perm.escritorioId,
        monitoramentoId: row.ev.monitoramentoId,
        cnj: row.ev.cnjAfetado,
        dataEvento: row.ev.dataEvento,
        teor: row.ev.teor,
        analise,
      });

      return { ok: true as const, prazoCriado, titulo: analise.titulo };
    }),

  /** Marca uma ou várias como lidas — é o "ok, li" da central. */
  marcarLidas: protectedProcedure
    .input(z.object({ eventoIds: z.array(z.number().int().positive()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "processos", "ver");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem acesso a processos" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      // O filtro por escritorioId no WHERE é o que impede marcar como lido
      // evento de outro escritório passando IDs no array.
      await db
        .update(eventosProcesso)
        .set({ lido: true })
        .where(
          and(
            eq(eventosProcesso.escritorioId, perm.escritorioId),
            inArray(eventosProcesso.id, input.eventoIds),
          ),
        );

      return { ok: true, total: input.eventoIds.length };
    }),

  /** Marca toda a rotina do período como lida de uma vez. */
  marcarRotinaLida: protectedProcedure
    .input(z.object({ dias: z.number().int().min(1).max(365).default(7) }).optional())
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "processos", "ver");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem acesso a processos" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const desde = new Date(Date.now() - (input?.dias ?? 7) * 86_400_000);
      await db
        .update(eventosProcesso)
        .set({ lido: true })
        .where(
          and(
            eq(eventosProcesso.escritorioId, perm.escritorioId),
            eq(eventosProcesso.tipo, "movimentacao"),
            eq(eventosProcesso.relevancia, "rotina"),
            eq(eventosProcesso.lido, false),
            gte(eventosProcesso.dataEvento, desde),
          ),
        );

      return { ok: true };
    }),
});
