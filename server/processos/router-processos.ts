/**
 * Router tRPC — Monitoramento de Processos v3
 *
 * v3: Integração com tribunal-providers para análise de frescor.
 * Cada resposta inclui `fonteInfo` com nível de frescor, badge, URL do tribunal.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { processosMonitorados, movimentacoesProcesso } from "../../drizzle/schema";
import { eq, and, desc, like, gte, lte, or } from "drizzle-orm";
import { consultarProcessoDataJud, consultarMovimentacoesRecentes, buscarProcessosPorOAB } from "./datajud-service";
import { extrairTribunalAlias, formatarNumeroCnj, validarNumeroCnj } from "../../shared/processos-types";
import { criarNotificacao } from "./router-notificacoes";
import { getFonteInfo, getProviderByAlias } from "./tribunal-providers";

export const processosRouter = router({
  checkAccess: protectedProcedure.query(() => ({ available: true })),

  listar: protectedProcedure
    .input(z.object({
      status: z.enum(["ativo", "pausado", "arquivado", "todos"]).default("todos"),
      busca: z.string().optional(),
      tribunal: z.string().optional(),
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const statusFilter = input?.status ?? "todos";
      const conditions = [eq(processosMonitorados.userId, ctx.user.id)];
      if (statusFilter !== "todos") conditions.push(eq(processosMonitorados.status, statusFilter));

      // Filtro por busca textual (CNJ, classe, assuntos, órgão)
      if (input?.busca) {
        const b = `%${input.busca.replace(/[.\-\s]/g, "")}%`;
        const bOriginal = `%${input.busca}%`;
        conditions.push(
          or(
            like(processosMonitorados.numeroCnjLimpo, b),
            like(processosMonitorados.numeroCnj, bOriginal),
            like(processosMonitorados.classe, bOriginal),
            like(processosMonitorados.assuntos, bOriginal),
            like(processosMonitorados.orgaoJulgador, bOriginal),
            like(processosMonitorados.ultimaMovimentacao, bOriginal),
          )!
        );
      }

      // Filtro por tribunal
      if (input?.tribunal) {
        conditions.push(eq(processosMonitorados.tribunal, input.tribunal));
      }

      // Filtro por data de ajuizamento
      if (input?.dataInicio) {
        conditions.push(gte(processosMonitorados.dataAjuizamento, input.dataInicio));
      }
      if (input?.dataFim) {
        conditions.push(lte(processosMonitorados.dataAjuizamento, input.dataFim));
      }

      const processos = await db.select().from(processosMonitorados).where(and(...conditions)).orderBy(desc(processosMonitorados.updatedAt));

      // Enriquecer cada processo com info de fonte/frescor
      return processos.map(p => ({
        ...p,
        fonteInfo: getFonteInfo(p.aliasApi, p.ultimaMovimentacaoData, p.ultimaAtualizacao),
      }));
    }),

  detalhe: protectedProcedure
    .input(z.object({ processoId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const [processo] = await db.select().from(processosMonitorados)
        .where(and(eq(processosMonitorados.id, input.processoId), eq(processosMonitorados.userId, ctx.user.id)))
        .limit(1);
      if (!processo) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado." });

      const movimentacoes = await db.select().from(movimentacoesProcesso)
        .where(eq(movimentacoesProcesso.processoId, processo.id))
        .orderBy(desc(movimentacoesProcesso.dataHora));

      return {
        processo,
        movimentacoes,
        fonteInfo: getFonteInfo(processo.aliasApi, processo.ultimaMovimentacaoData, processo.ultimaAtualizacao),
      };
    }),

  consultaRapida: protectedProcedure
    .input(z.object({ numeroCnj: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const limpo = input.numeroCnj.replace(/[.\-\s]/g, "");
      if (!validarNumeroCnj(limpo)) throw new TRPCError({ code: "BAD_REQUEST", message: "Número CNJ inválido." });

      const alias = extrairTribunalAlias(limpo);
      if (!alias) throw new TRPCError({ code: "BAD_REQUEST", message: "Tribunal não identificado." });

      const resultado = await consultarProcessoDataJud(limpo, alias);
      if (!resultado.success || !resultado.processo) {
        throw new TRPCError({ code: "NOT_FOUND", message: resultado.error || "Processo não encontrado." });
      }

      const proc = resultado.processo;
      const provider = getProviderByAlias(alias);
      const ultimaMovData = proc.movimentos[0]?.dataHora || null;

      return {
        numeroProcesso: proc.numeroProcesso,
        numeroCnjFormatado: formatarNumeroCnj(limpo),
        tribunal: proc.tribunal,
        classe: proc.classe?.nome,
        orgaoJulgador: proc.orgaoJulgador?.nome,
        grau: proc.grau,
        dataAjuizamento: proc.dataAjuizamento,
        assuntos: proc.assuntos,
        totalMovimentacoes: proc.movimentos.length,
        ultimaMovimentacao: proc.movimentos[0]?.nome || null,
        ultimaMovimentacaoData: ultimaMovData,
        fonteInfo: getFonteInfo(alias, ultimaMovData, proc.dataHoraUltimaAtualizacao),
      };
    }),

  adicionar: protectedProcedure
    .input(z.object({
      numeroCnj: z.string().min(1, "Número do processo é obrigatório"),
      apelido: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const numeroCnjLimpo = input.numeroCnj.replace(/[.\-\s]/g, "");
      if (!validarNumeroCnj(numeroCnjLimpo)) throw new TRPCError({ code: "BAD_REQUEST", message: "Número CNJ inválido." });

      const numeroCnjFormatado = formatarNumeroCnj(numeroCnjLimpo);
      const alias = extrairTribunalAlias(numeroCnjLimpo);
      if (!alias) throw new TRPCError({ code: "BAD_REQUEST", message: "Tribunal não identificado." });

      const [existente] = await db.select().from(processosMonitorados)
        .where(and(eq(processosMonitorados.userId, ctx.user.id), eq(processosMonitorados.numeroCnjLimpo, numeroCnjLimpo)))
        .limit(1);
      if (existente) throw new TRPCError({ code: "CONFLICT", message: "Este processo já está sendo monitorado." });

      const resultado = await consultarProcessoDataJud(numeroCnjLimpo, alias);
      if (!resultado.success || !resultado.processo) {
        throw new TRPCError({ code: "NOT_FOUND", message: resultado.error || "Processo não encontrado." });
      }

      const proc = resultado.processo;
      const movimentos = proc.movimentos || [];
      const ultimaMov = movimentos[0] || null;
      const provider = getProviderByAlias(alias);

      const [inserted] = await db.insert(processosMonitorados).values({
        userId: ctx.user.id,
        numeroCnj: numeroCnjFormatado,
        numeroCnjLimpo,
        tribunal: proc.tribunal || alias.toUpperCase(),
        aliasApi: alias,
        classe: proc.classe?.nome || null,
        assuntos: JSON.stringify(proc.assuntos || []),
        orgaoJulgador: proc.orgaoJulgador?.nome || null,
        dataAjuizamento: proc.dataAjuizamento || null,
        grau: proc.grau || null,
        ultimaAtualizacao: proc.dataHoraUltimaAtualizacao || null,
        totalMovimentacoes: movimentos.length,
        ultimaMovimentacao: ultimaMov?.nome || null,
        ultimaMovimentacaoData: ultimaMov?.dataHora || null,
        status: "ativo",
        apelido: input.apelido || null,
      });

      const processoId = Number(inserted.insertId);

      if (movimentos.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < movimentos.length; i += batchSize) {
          const batch = movimentos.slice(i, i + batchSize);
          await db.insert(movimentacoesProcesso).values(
            batch.map((m: any) => ({
              processoId,
              codigo: m.codigo,
              nome: m.nome,
              dataHora: m.dataHora,
              complementos: m.complementosTabelados ? JSON.stringify(m.complementosTabelados) : null,
              orgaoJulgador: m.orgaoJulgador?.nome || null,
              lida: true,
            }))
          );
        }
      }

      return {
        success: true,
        processoId,
        numeroCnj: numeroCnjFormatado,
        tribunal: proc.tribunal,
        classe: proc.classe?.nome,
        totalMovimentacoes: movimentos.length,
        fonteInfo: getFonteInfo(alias, ultimaMov?.dataHora || null, proc.dataHoraUltimaAtualizacao),
      };
    }),

  atualizar: protectedProcedure
    .input(z.object({ processoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const [processo] = await db.select().from(processosMonitorados)
        .where(and(eq(processosMonitorados.id, input.processoId), eq(processosMonitorados.userId, ctx.user.id)))
        .limit(1);
      if (!processo) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado." });

      const resultado = await consultarMovimentacoesRecentes(processo.numeroCnjLimpo, processo.aliasApi);
      if (!resultado.success || !resultado.processo) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: resultado.error || "Erro ao atualizar." });
      }

      const proc = resultado.processo;
      const movimentos = proc.movimentos || [];
      const ultimaMov = movimentos[0] || null;

      await db.update(processosMonitorados).set({
        classe: proc.classe?.nome || processo.classe,
        assuntos: JSON.stringify(proc.assuntos || []),
        orgaoJulgador: proc.orgaoJulgador?.nome || processo.orgaoJulgador,
        ultimaAtualizacao: proc.dataHoraUltimaAtualizacao || processo.ultimaAtualizacao,
        totalMovimentacoes: movimentos.length,
        ultimaMovimentacao: ultimaMov?.nome || processo.ultimaMovimentacao,
        ultimaMovimentacaoData: ultimaMov?.dataHora || processo.ultimaMovimentacaoData,
      }).where(and(eq(processosMonitorados.id, input.processoId), eq(processosMonitorados.userId, ctx.user.id)));

      const existentes = await db
        .select({ dataHora: movimentacoesProcesso.dataHora, codigo: movimentacoesProcesso.codigo })
        .from(movimentacoesProcesso)
        .where(eq(movimentacoesProcesso.processoId, processo.id));

      const existenteSet = new Set(existentes.map((m) => `${m.codigo}_${m.dataHora}`));
      const novas = movimentos.filter((m) => !existenteSet.has(`${m.codigo}_${m.dataHora}`));

      let novasCount = 0;
      if (novas.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < novas.length; i += batchSize) {
          const batch = novas.slice(i, i + batchSize);
          await db.insert(movimentacoesProcesso).values(
            batch.map((m: any) => ({
              processoId: processo.id,
              codigo: m.codigo, nome: m.nome, dataHora: m.dataHora,
              complementos: m.complementosTabelados ? JSON.stringify(m.complementosTabelados) : null,
              orgaoJulgador: m.orgaoJulgador?.nome || null, lida: false,
            }))
          );
        }
        novasCount = novas.length;

        try {
          const descMov = novas.slice(0, 3).map(m => m.nome).join("; ");
          await criarNotificacao({
            userId: ctx.user.id,
            titulo: `${novasCount} nova(s) movimentação(ões)`,
            mensagem: `Processo ${processo.numeroCnj}${processo.apelido ? ` (${processo.apelido})` : ""}: ${descMov}${novasCount > 3 ? "..." : ""}`,
            tipo: "movimentacao",
            processoId: processo.id,
          });
        } catch (e) { console.warn("[Processos] Erro notificação:", e); }
      }

      return {
        success: true,
        novasMovimentacoes: novasCount,
        totalMovimentacoes: movimentos.length,
        fonteInfo: getFonteInfo(processo.aliasApi, ultimaMov?.dataHora || processo.ultimaMovimentacaoData, proc.dataHoraUltimaAtualizacao),
      };
    }),

  atualizarTodos: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

    const ativos = await db.select().from(processosMonitorados)
      .where(and(eq(processosMonitorados.userId, ctx.user.id), eq(processosMonitorados.status, "ativo")));

    let totalNovas = 0;
    let totalErros = 0;

    for (const proc of ativos) {
      try {
        const resultado = await consultarMovimentacoesRecentes(proc.numeroCnjLimpo, proc.aliasApi);
        if (!resultado.success || !resultado.processo) { totalErros++; continue; }

        const movimentos = resultado.processo.movimentos || [];
        const ultimaMov = movimentos[0] || null;

        await db.update(processosMonitorados).set({
          totalMovimentacoes: movimentos.length,
          ultimaMovimentacao: ultimaMov?.nome || null,
          ultimaMovimentacaoData: ultimaMov?.dataHora || null,
          ultimaAtualizacao: resultado.processo.dataHoraUltimaAtualizacao || null,
        }).where(eq(processosMonitorados.id, proc.id));

        const existentes = await db
          .select({ dataHora: movimentacoesProcesso.dataHora, codigo: movimentacoesProcesso.codigo })
          .from(movimentacoesProcesso)
          .where(eq(movimentacoesProcesso.processoId, proc.id));

        const existenteSet = new Set(existentes.map(m => `${m.codigo}_${m.dataHora}`));
        const novas = movimentos.filter(m => !existenteSet.has(`${m.codigo}_${m.dataHora}`));

        if (novas.length > 0) {
          await db.insert(movimentacoesProcesso).values(
            novas.slice(0, 200).map((m: any) => ({
              processoId: proc.id, codigo: m.codigo, nome: m.nome, dataHora: m.dataHora,
              complementos: m.complementosTabelados ? JSON.stringify(m.complementosTabelados) : null,
              orgaoJulgador: m.orgaoJulgador?.nome || null, lida: false,
            }))
          );
          totalNovas += novas.length;

          try {
            await criarNotificacao({
              userId: ctx.user.id,
              titulo: `${novas.length} movimentação(ões) — ${proc.numeroCnj}`,
              mensagem: `${proc.apelido ? `${proc.apelido}: ` : ""}${novas.slice(0, 2).map(m => m.nome).join("; ")}${novas.length > 2 ? "..." : ""}`,
              tipo: "movimentacao", processoId: proc.id,
            });
          } catch (_) { /* silenciar */ }
        }

        await new Promise(r => setTimeout(r, 500));
      } catch (_) { totalErros++; }
    }

    return { success: true, processosAtualizados: ativos.length, novasMovimentacoes: totalNovas, erros: totalErros };
  }),

  buscarPorOAB: protectedProcedure
    .input(z.object({ numeroOAB: z.string().min(1), ufOAB: z.string().length(2), tribunal: z.string().min(1) }))
    .mutation(async ({ input }) => buscarProcessosPorOAB(input.numeroOAB, input.ufOAB, input.tribunal)),

  alterarStatus: protectedProcedure
    .input(z.object({ processoId: z.number(), status: z.enum(["ativo", "pausado", "arquivado"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });
      await db.update(processosMonitorados).set({ status: input.status })
        .where(and(eq(processosMonitorados.id, input.processoId), eq(processosMonitorados.userId, ctx.user.id)));
      return { success: true };
    }),

  atualizarApelido: protectedProcedure
    .input(z.object({ processoId: z.number(), apelido: z.string().max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });
      await db.update(processosMonitorados).set({ apelido: input.apelido || null })
        .where(and(eq(processosMonitorados.id, input.processoId), eq(processosMonitorados.userId, ctx.user.id)));
      return { success: true };
    }),

  remover: protectedProcedure
    .input(z.object({ processoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });
      const [processo] = await db.select({ id: processosMonitorados.id }).from(processosMonitorados)
        .where(and(eq(processosMonitorados.id, input.processoId), eq(processosMonitorados.userId, ctx.user.id)))
        .limit(1);
      if (!processo) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado." });
      await db.delete(movimentacoesProcesso).where(eq(movimentacoesProcesso.processoId, processo.id));
      await db.delete(processosMonitorados)
        .where(and(eq(processosMonitorados.id, processo.id), eq(processosMonitorados.userId, ctx.user.id)));
      return { success: true };
    }),

  marcarLidas: protectedProcedure
    .input(z.object({ processoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });
      const [processo] = await db.select({ id: processosMonitorados.id }).from(processosMonitorados)
        .where(and(eq(processosMonitorados.id, input.processoId), eq(processosMonitorados.userId, ctx.user.id)))
        .limit(1);
      if (!processo) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado." });
      await db.update(movimentacoesProcesso).set({ lida: true })
        .where(eq(movimentacoesProcesso.processoId, processo.id));
      return { success: true };
    }),
});
