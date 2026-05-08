/**
 * Router — Processos via Motor Próprio
 *
 * Substituiu `judit-processos.ts` (08/05/2026) após decisão de remover
 * Judit completamente. Toda consulta passa pelo adapter motor próprio.
 *
 * Tribunais cobertos hoje:
 *   - TJCE 1º grau ✅ (PJe via PDPJ-cloud, login + 2FA via cofre)
 *
 * Tribunais sem adapter retornam TRPCError NOT_IMPLEMENTED com
 * mensagem instrutiva.
 *
 * Cobrança: 1 cred por consulta (cobrado via `motorCreditos`/
 * `motorTransacoes`). Consulta motor próprio não tem custo
 * operacional externo (só servidor + tribunal de origem).
 */

import { z } from "zod";
import { eq, desc, and, or, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  motorCreditos,
  motorTransacoes,
  cofreCredenciais,
  motorMonitoramentos,
  eventosProcesso,
} from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { createLogger } from "../_core/logger";
import { parseCnjTribunal, sistemaCofrePorTribunal } from "../processos/cnj-parser";
import { normalizarCnj, mascararCnj } from "../../scripts/spike-motor-proprio/lib/parser-utils";
import {
  ehRequestMotorProprio,
  iniciarConsultaMotorProprio,
  obterStatusMotorProprio,
  obterResultadoMotorProprio,
} from "../processos/motor-proprio-runner";
import { consultarTjce } from "../processos/adapters/pje-tjce";
import { recuperarSessao } from "../escritorio/cofre-helpers";

const log = createLogger("processos-motor");

const PACOTES_CREDITOS = [
  { id: "pack_50", nome: "50 creditos", creditos: 50, preco: 49.9, popular: false },
  { id: "pack_200", nome: "200 creditos", creditos: 200, preco: 149.9, popular: true },
  { id: "pack_500", nome: "500 creditos", creditos: 500, preco: 299.9, popular: false },
  { id: "pack_1000", nome: "1000 creditos", creditos: 1000, preco: 499.9, popular: false },
] as const;

export const CUSTOS = {
  consulta_cnj: 1,
  monitorar_processo_mes: 2,    // ANTES: Judit cobrava 5
  monitorar_pessoa_mes: 15,     // ANTES: Judit cobrava 35
} as const;

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Converte ResultadoScraper (motor próprio) para o shape "lawsuit"
 * que o frontend MonitoramentoCard espera (legado Judit). Mantém
 * compat até refator profundo do componente.
 *
 * - amount em REAIS (não cents) — frontend formata com formatBRL direto
 * - parties[].side: "Active"/"Passive" (frontend filtra por isso)
 * - steps[].step_date / content: shape Judit
 */
function adaptarParaJuditShape(r: any, cnj: string) {
  const capa = r?.capa ?? {};
  const partes: Array<{ nome?: string; polo?: string; documento?: string | null }> = capa.partes ?? [];
  const movs: Array<{ data?: string; texto?: string }> = r?.movimentacoes ?? [];
  return {
    code: cnj,
    name: capa.classe ?? null,
    classifications: capa.classe ? [{ name: capa.classe }] : [],
    amount:
      typeof capa.valorCausaCentavos === "number"
        ? capa.valorCausaCentavos / 100
        : null,
    distribution_date: capa.dataDistribuicao ?? null,
    parties: partes.map((p) => ({
      name: p.nome ?? "",
      side: (p.polo ?? "").toLowerCase().startsWith("ativ") ? "Active" : "Passive",
      main_document: p.documento ?? null,
    })),
    steps: movs.map((m) => ({
      step_date: m.data ?? null,
      content: m.texto ?? "",
    })),
  };
}

async function consumirCreditos(
  escritorioId: number,
  userId: number,
  custo: number,
  operacao: string,
  detalhes?: string,
): Promise<void> {
  // Saldo unificado por escritório (migration 0073).
  // Helper trata: garante registro existe (cria com cota do plano se não),
  // valida saldo, debita, registra transação. Lança TRPCError se sem saldo.
  const { consumirCreditosEscritorio } = await import("../billing/escritorio-creditos");
  await consumirCreditosEscritorio(escritorioId, userId, custo, operacao, detalhes);
}

export const processosRouter = router({
  saldo: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { saldo: 0, totalConsumido: 0, totalComprado: 0, cotaMensal: 0, ultimoReset: null };

    // Helper garante registro existe (cria com cota do plano se primeiro
    // acesso). Sem race conditions porque getSaldoEscritorio é idempotente.
    try {
      const { getSaldoEscritorio } = await import("../billing/escritorio-creditos");
      const s = await getSaldoEscritorio(esc.escritorio.id);
      return {
        saldo: s.saldo,
        totalConsumido: s.totalConsumido,
        totalComprado: s.totalComprado,
        cotaMensal: s.cotaMensal,
        ultimoReset: s.ultimoReset,
      };
    } catch {
      return { saldo: 0, totalConsumido: 0, totalComprado: 0, cotaMensal: 0, ultimoReset: null };
    }
  }),

  pacotes: protectedProcedure.query(() => ({ pacotes: PACOTES_CREDITOS, custos: CUSTOS })),

  /**
   * Inicia consulta de processo por CNJ via motor próprio.
   *
   * Detecta tribunal pelo CNJ. Se motor próprio cobre + escritório
   * tem credencial OAB ativa no cofre + sessão válida → executa
   * background, retorna requestId pra polling.
   *
   * Senão: TRPCError instrutivo (cadastrar credencial / aguardar
   * adapter / etc).
   */
  consultarCNJ: protectedProcedure
    .input(z.object({ cnj: z.string().min(15).max(30) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const tribunal = parseCnjTribunal(input.cnj);
      if (!tribunal) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "CNJ inválido — verifique o formato (ex: 0000000-00.0000.0.00.0000)",
        });
      }

      if (!tribunal.temMotorProprio) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            `Consulta para ${tribunal.siglaTribunal} ainda está em desenvolvimento. ` +
            `Tribunais cobertos hoje: TJCE 1º grau. Próximos: TJSP, TRT-7, TJRJ.`,
          cause: { motivo: "tribunal_sem_motor", tribunal: tribunal.codigoTribunal },
        });
      }

      const sistemaCofre = sistemaCofrePorTribunal(tribunal.codigoTribunal);
      if (!sistemaCofre) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: `Sistema cofre pra ${tribunal.siglaTribunal} ainda não mapeado`,
        });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const credencial = await db
        .select()
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.criadoPor, ctx.user.id),
            eq(cofreCredenciais.sistema, sistemaCofre),
            eq(cofreCredenciais.status, "ativa"),
          ),
        )
        .limit(1);

      if (credencial.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `Pra consultar processos do ${tribunal.siglaTribunal}, ` +
            `cadastre sua credencial OAB-${tribunal.uf ?? ""} no Cofre. ` +
            `→ /cofre-credenciais`,
          cause: { motivo: "credencial_ausente", tribunal: tribunal.codigoTribunal },
        });
      }

      const credId = credencial[0].id;
      const storageState = await recuperarSessao(credId);
      if (!storageState) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `Sua credencial ${tribunal.siglaTribunal} expirou. ` +
            `Vá em Cofre de Credenciais → Validar pra renovar.`,
          cause: { motivo: "sessao_expirada", credencialId: credId },
        });
      }

      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS.consulta_cnj,
        "consulta_cnj",
        `CNJ: ${input.cnj} (${tribunal.siglaTribunal})`,
      );

      const { requestId, status } = iniciarConsultaMotorProprio(input.cnj, storageState);
      log.info(
        { cnj: input.cnj, requestId, tribunal: tribunal.codigoTribunal },
        "[motor-proprio] consulta iniciada",
      );
      return { requestId, status };
    }),

  /** Verifica status de uma consulta em andamento */
  statusConsulta: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .query(({ input }) => {
      if (!ehRequestMotorProprio(input.requestId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "RequestId inválido" });
      }
      const status = obterStatusMotorProprio(input.requestId);
      if (!status) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Consulta não encontrada (TTL 30min expirou)",
        });
      }
      return status;
    }),

  /** Retorna o resultado completo da consulta (ResultadoScraper shape) */
  resultados: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .mutation(({ input }) => {
      if (!ehRequestMotorProprio(input.requestId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "RequestId inválido" });
      }
      const r = obterResultadoMotorProprio(input.requestId);
      if (!r) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Consulta não encontrada (TTL 30min expirou)",
        });
      }
      return r;
    }),

  /** Histórico de transações do escritório */
  transacoes: protectedProcedure
    .input(z.object({ limite: z.number().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(motorTransacoes)
        .where(eq(motorTransacoes.escritorioId, esc.escritorio.id))
        .orderBy(desc(motorTransacoes.createdAt))
        .limit(input?.limite ?? 50);
    }),

  /** Admin: adiciona créditos manualmente (após pagamento via Stripe etc) */
  adicionarCreditos: adminProcedure
    .input(
      z.object({
        escritorioId: z.number().int().positive(),
        quantidade: z.number().int().positive(),
        motivo: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      let [creditos] = await db
        .select()
        .from(motorCreditos)
        .where(eq(motorCreditos.escritorioId, input.escritorioId))
        .limit(1);

      if (!creditos) {
        await db.insert(motorCreditos).values({
          escritorioId: input.escritorioId,
          saldo: 0,
          totalComprado: 0,
          totalConsumido: 0,
        });
        const [novo] = await db
          .select()
          .from(motorCreditos)
          .where(eq(motorCreditos.escritorioId, input.escritorioId))
          .limit(1);
        creditos = novo;
      }

      const novoSaldo = creditos.saldo + input.quantidade;
      await db
        .update(motorCreditos)
        .set({
          saldo: novoSaldo,
          totalComprado: creditos.totalComprado + input.quantidade,
        })
        .where(eq(motorCreditos.id, creditos.id));

      await db.insert(motorTransacoes).values({
        escritorioId: input.escritorioId,
        tipo: "compra",
        quantidade: input.quantidade,
        saldoAnterior: creditos.saldo,
        saldoDepois: novoSaldo,
        operacao: "compra_admin",
        detalhes: input.motivo,
        userId: ctx.user.id,
      });

      return { adicionados: input.quantidade, saldoNovo: novoSaldo };
    }),

  // ─── MONITORAMENTOS (Sprint 2) ──────────────────────────────────────────
  // Cobra cred imediatamente (primeira mensalidade) na criação. Cron mensal
  // (cobrarMonitoramentosMensais) cobra renovação após 30 dias.

  meusMonitoramentos: protectedProcedure
    .input(
      z
        .object({
          tipoMonitoramento: z.enum(["movimentacoes", "novas_acoes"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [
        eq(motorMonitoramentos.criadoPor, ctx.user.id),
        ne(motorMonitoramentos.status, "pausado" as const), // mostra ativo + erro
      ];
      // Filtro opcional por tipo
      if (input?.tipoMonitoramento) {
        conditions.push(
          eq(motorMonitoramentos.tipoMonitoramento, input.tipoMonitoramento),
        );
      }
      // Sempre lista todos do user, incluindo pausados (UI filtra na exibição)
      const rows = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          input?.tipoMonitoramento
            ? and(
                eq(motorMonitoramentos.criadoPor, ctx.user.id),
                eq(motorMonitoramentos.tipoMonitoramento, input.tipoMonitoramento),
              )
            : eq(motorMonitoramentos.criadoPor, ctx.user.id),
        )
        .orderBy(desc(motorMonitoramentos.createdAt));
      return rows;
    }),

  criarMonitoramento: protectedProcedure
    .input(
      z.object({
        numeroCnj: z.string().min(15).max(30),
        credencialId: z.number().int().positive(),
        apelido: z.string().max(255).optional(),
        recurrenceHoras: z.number().int().min(1).max(168).default(6),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const tribunal = parseCnjTribunal(input.numeroCnj);
      if (!tribunal) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CNJ inválido" });
      }
      if (!tribunal.temMotorProprio) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: `Monitoramento para ${tribunal.siglaTribunal} ainda em desenvolvimento. Hoje cobrimos: TJCE 1º grau.`,
        });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      // Confirma credencial pertence ao user
      const [cred] = await db
        .select()
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.id, input.credencialId),
            eq(cofreCredenciais.criadoPor, ctx.user.id),
            eq(cofreCredenciais.status, "ativa"),
          ),
        )
        .limit(1);
      if (!cred) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Credencial não encontrada ou inativa. Cadastre/valide em /cofre-credenciais.",
        });
      }

      // Cobra primeira mensalidade
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS.monitorar_processo_mes,
        "monitorar_processo_mes",
        `Monitor CNJ ${input.numeroCnj} (${tribunal.siglaTribunal})`,
      );

      const cnjMascarado = mascararCnj(input.numeroCnj);
      const result = await db.insert(motorMonitoramentos).values({
        escritorioId: esc.escritorio.id,
        criadoPor: ctx.user.id,
        tipoMonitoramento: "movimentacoes",
        searchType: "lawsuit_cnj",
        searchKey: cnjMascarado,
        apelido: input.apelido ?? cnjMascarado,
        tribunal: tribunal.codigoTribunal,
        credencialId: input.credencialId,
        status: "ativo",
        recurrenceHoras: input.recurrenceHoras,
        ultimaCobrancaEm: new Date(),
      });
      const insertId =
        (result as unknown as { insertId: number }[])[0]?.insertId ??
        (result as unknown as { insertId: number }).insertId;

      log.info(
        { user: ctx.user.id, monId: insertId, cnj: cnjMascarado, tribunal: tribunal.codigoTribunal },
        "[motor-proprio] monitoramento de processo criado",
      );

      return { id: insertId, custoCred: CUSTOS.monitorar_processo_mes };
    }),

  pausarMonitoramento: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const [mon] = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, input.id),
            eq(motorMonitoramentos.criadoPor, ctx.user.id),
          ),
        )
        .limit(1);
      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });
      await db
        .update(motorMonitoramentos)
        .set({ status: "pausado" })
        .where(eq(motorMonitoramentos.id, input.id));
      return { ok: true };
    }),

  reativarMonitoramento: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const [mon] = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, input.id),
            eq(motorMonitoramentos.criadoPor, ctx.user.id),
          ),
        )
        .limit(1);
      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });
      await db
        .update(motorMonitoramentos)
        .set({ status: "ativo" })
        .where(eq(motorMonitoramentos.id, input.id));
      return { ok: true };
    }),

  deletarMonitoramento: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      // Verifica posse
      const [mon] = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, input.id),
            eq(motorMonitoramentos.criadoPor, ctx.user.id),
          ),
        )
        .limit(1);
      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });
      // Hard delete — eventos_processo associados ficam (auditoria)
      await db.delete(motorMonitoramentos).where(eq(motorMonitoramentos.id, input.id));
      return { ok: true };
    }),

  historicoMonitoramento: protectedProcedure
    .input(
      z.object({
        monitoramentoId: z.number().int().positive(),
        page: z.number().int().min(1).default(1).optional(),
        pageSize: z.number().int().min(1).max(200).default(50).optional(),
        // mantido pra compat com chamadas antigas
        limite: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const limite = input.limite ?? input.pageSize ?? 50;
      if (!db) return { items: [], eventos: [], totalNaoLidas: 0 };
      const [mon] = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, input.monitoramentoId),
            eq(motorMonitoramentos.criadoPor, ctx.user.id),
          ),
        )
        .limit(1);
      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });

      const eventos = await db
        .select()
        .from(eventosProcesso)
        .where(eq(eventosProcesso.monitoramentoId, input.monitoramentoId))
        .orderBy(desc(eventosProcesso.dataEvento))
        .limit(limite);

      // Shape compat com frontend antigo (esperava resp Judit):
      // items[].responseType + items[].responseData. Mapeia eventos
      // pra esse formato. Se não há eventos, retorna [].
      const items = eventos.map((e) => ({
        id: e.id,
        responseType: e.tipo === "movimentacao" ? "step" : e.tipo,
        responseData: e.conteudoJson ? safeParse(e.conteudoJson) : { texto: e.conteudo, data: e.dataEvento },
        createdAt: e.createdAt,
        lido: e.lido,
      }));
      const naoLidas = eventos.filter((e) => !e.lido).length;
      return { items, eventos, totalNaoLidas: naoLidas };
    }),

  // Dispara consulta direta do processo associado a um monitoramento.
  // Cobra 1 cred. Útil quando o user clica "Histórico" no card pra
  // forçar atualização imediata em vez de esperar o cron de 6h.
  buscarProcessoCompleto: protectedProcedure
    .input(z.object({ monitoramentoId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const [mon] = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, input.monitoramentoId),
            eq(motorMonitoramentos.criadoPor, ctx.user.id),
          ),
        )
        .limit(1);
      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });

      if (!mon.credencialId) {
        return { encontrado: false, mensagem: "Monitoramento sem credencial vinculada" };
      }

      const sessao = await recuperarSessao(mon.credencialId);
      if (!sessao) {
        return {
          encontrado: false,
          mensagem: "Sessão expirou. Vá em Cofre de Credenciais → Validar pra renovar.",
        };
      }

      // Cobra 1 cred (mesma tarifa de consultarCNJ direta)
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS.consulta_cnj,
        "consulta_cnj",
        `Histórico monitoramento ${mon.searchKey}`,
      );

      let resultado;
      if (mon.tribunal === "tjce") {
        resultado = await consultarTjce(mon.searchKey, sessao);
      } else {
        return {
          encontrado: false,
          mensagem: `Tribunal ${mon.tribunal} ainda sem adapter implementado.`,
        };
      }

      if (!resultado.ok) {
        await db
          .update(motorMonitoramentos)
          .set({ ultimoErro: resultado.mensagemErro ?? "Erro na consulta", ultimaConsultaEm: new Date() })
          .where(eq(motorMonitoramentos.id, mon.id));
        return { encontrado: false, mensagem: resultado.mensagemErro ?? "Erro desconhecido" };
      }

      // Atualiza monitoramento + insere movs novas (best effort)
      try {
        await db
          .update(motorMonitoramentos)
          .set({
            ultimaConsultaEm: new Date(),
            ultimaMovimentacaoEm: resultado.movimentacoes[0]?.data
              ? new Date(resultado.movimentacoes[0].data)
              : null,
            ultimaMovimentacaoTexto: resultado.movimentacoes[0]?.texto?.slice(0, 500) ?? null,
            ultimoErro: null,
          })
          .where(eq(motorMonitoramentos.id, mon.id));
      } catch {
        /* best-effort */
      }

      // Adapta ResultadoScraper → shape JuditLawsuit-like que o
      // frontend `MonitoramentoCard` espera (steps, parties, code, etc).
      const processoAdaptado = adaptarParaJuditShape(resultado, mon.searchKey);
      return { encontrado: true, processo: processoAdaptado };
    }),

  // ─── NOVAS AÇÕES por CPF/CNPJ (Sub-sprint 2.2) ─────────────────────────
  // Implementa em sub-sprint 2.2 quando consultarPorCpf adapter estiver pronto.
  // Stubs aqui pra typecheck do frontend não quebrar.

  criarMonitoramentoNovasAcoes: protectedProcedure
    .input(
      z.object({
        tipo: z.enum(["cpf", "cnpj"]),
        valor: z.string().min(11).max(20),
        apelido: z.string().max(255).optional(),
        credencialId: z.number().int().positive(),
        recurrenceHoras: z.number().int().min(1).max(168).default(6),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const docLimpo = input.valor.replace(/\D/g, "");
      if (input.tipo === "cpf" && docLimpo.length !== 11) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CPF deve ter 11 dígitos" });
      }
      if (input.tipo === "cnpj" && docLimpo.length !== 14) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CNPJ deve ter 14 dígitos" });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      // Confirma posse da credencial
      const [cred] = await db
        .select()
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.id, input.credencialId),
            eq(cofreCredenciais.criadoPor, ctx.user.id),
            eq(cofreCredenciais.status, "ativa"),
          ),
        )
        .limit(1);
      if (!cred) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Credencial inválida ou inativa. Cadastre/valide em /cofre-credenciais.",
        });
      }

      // Mapeia sistema cofre → tribunal. Hoje só TJCE 1º grau.
      const tribunalDaCred = cred.sistema === "esaj_tjce" || cred.sistema === "pje_tjce" ? "tjce" : null;
      if (!tribunalDaCred) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: `Monitoramento de novas ações ainda só funciona pra TJCE. Sistema ${cred.sistema} entra em sprint futura.`,
        });
      }

      // Cobra primeira mensalidade (15 cred)
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS.monitorar_pessoa_mes,
        "monitorar_pessoa_mes",
        `Monitor ${input.tipo.toUpperCase()} ${docLimpo.slice(0, 3)}***`,
      );

      const result = await db.insert(motorMonitoramentos).values({
        escritorioId: esc.escritorio.id,
        criadoPor: ctx.user.id,
        tipoMonitoramento: "novas_acoes",
        searchType: input.tipo,
        searchKey: docLimpo,
        apelido: input.apelido ?? `${input.tipo.toUpperCase()} ${docLimpo.slice(0, 3)}***`,
        tribunal: tribunalDaCred,
        credencialId: input.credencialId,
        status: "ativo",
        recurrenceHoras: input.recurrenceHoras,
        cnjsConhecidos: "[]",
        ultimaCobrancaEm: new Date(),
      });
      const insertId =
        (result as unknown as { insertId: number }[])[0]?.insertId ??
        (result as unknown as { insertId: number }).insertId;

      log.info(
        { user: ctx.user.id, monId: insertId, tipo: input.tipo, tribunal: tribunalDaCred },
        "[motor-proprio] monitoramento de novas ações criado",
      );

      return { id: insertId, custoCred: CUSTOS.monitorar_pessoa_mes };
    }),

  listarNovasAcoes: protectedProcedure
    .input(
      z.object({
        apenasNaoLidas: z.boolean().optional(),
        limite: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { acoes: [], monitoramentos: [], totalNaoLidas: 0 };
      // Por enquanto retorna eventos tipo "nova_acao" do escritório
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return { acoes: [], monitoramentos: [], totalNaoLidas: 0 };

      const acoes = await db
        .select()
        .from(eventosProcesso)
        .where(
          and(
            eq(eventosProcesso.escritorioId, esc.escritorio.id),
            eq(eventosProcesso.tipo, "nova_acao"),
          ),
        )
        .orderBy(desc(eventosProcesso.createdAt))
        .limit(input.limite);

      const monitoramentos = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.criadoPor, ctx.user.id),
            eq(motorMonitoramentos.tipoMonitoramento, "novas_acoes"),
          ),
        );

      const naoLidas = acoes.filter((a) => !a.lido).length;
      return { acoes, monitoramentos, totalNaoLidas: naoLidas };
    }),

  marcarNovaAcaoLida: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      await db
        .update(eventosProcesso)
        .set({ lido: true })
        .where(
          and(
            eq(eventosProcesso.id, input.id),
            eq(eventosProcesso.escritorioId, esc.escritorio.id),
          ),
        );
      return { ok: true };
    }),

  /**
   * Força polling sob demanda de UM monitoramento de novas ações.
   * Não cobra crédito (já está na mensalidade de 15 cred/mês).
   * Útil pra validar adapter sem esperar cron de 1h.
   */
  atualizarNovasAcoesAgora: protectedProcedure
    .input(z.object({ monitoramentoId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const [mon] = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, input.monitoramentoId),
            eq(motorMonitoramentos.criadoPor, ctx.user.id),
            eq(motorMonitoramentos.tipoMonitoramento, "novas_acoes"),
          ),
        )
        .limit(1);
      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });

      if (!mon.credencialId) {
        return { ok: false, mensagem: "Credencial não vinculada" };
      }

      const sessao = await recuperarSessao(mon.credencialId);
      if (!sessao) {
        return {
          ok: false,
          mensagem: "Sessão expirou. Vá em Cofre de Credenciais → Validar pra renovar.",
        };
      }

      let resultado;
      if (mon.tribunal === "tjce") {
        const { consultarTjcePorCpf } = await import("../processos/adapters/pje-tjce");
        resultado = await consultarTjcePorCpf(mon.searchKey, sessao);
      } else {
        return { ok: false, mensagem: `Tribunal ${mon.tribunal} sem adapter de CPF` };
      }

      if (!resultado.ok) {
        await db
          .update(motorMonitoramentos)
          .set({
            ultimaConsultaEm: new Date(),
            ultimoErro: resultado.mensagemErro ?? "Erro na consulta",
          })
          .where(eq(motorMonitoramentos.id, mon.id));
        return {
          ok: false,
          mensagem: resultado.mensagemErro ?? "Erro desconhecido",
        };
      }

      // Compara com cnjsConhecidos (igual cron faz)
      const cnjsConhecidos: string[] = mon.cnjsConhecidos
        ? (JSON.parse(mon.cnjsConhecidos) as string[])
        : [];
      const cnjsNovos = resultado.cnjs.filter((c) => !cnjsConhecidos.includes(c));
      const isPrimeiraExecucao = cnjsConhecidos.length === 0;

      // Atualiza cnjsConhecidos
      const todosCnjs = isPrimeiraExecucao
        ? resultado.cnjs
        : [...cnjsConhecidos, ...cnjsNovos];

      await db
        .update(motorMonitoramentos)
        .set({
          cnjsConhecidos: JSON.stringify(todosCnjs),
          totalNovasAcoes: isPrimeiraExecucao
            ? mon.totalNovasAcoes
            : mon.totalNovasAcoes + cnjsNovos.length,
          ultimaConsultaEm: new Date(),
          ultimoErro: null,
        })
        .where(eq(motorMonitoramentos.id, mon.id));

      // Se NÃO é primeira execução E há CNJs novos, INSERT eventos
      if (!isPrimeiraExecucao && cnjsNovos.length > 0) {
        const crypto = await import("node:crypto");
        for (const cnj of cnjsNovos) {
          const dedup = crypto
            .createHash("sha256")
            .update(["nova_acao", String(mon.id), cnj].join("|"))
            .digest("hex");
          try {
            await db.insert(eventosProcesso).values({
              monitoramentoId: mon.id,
              escritorioId: mon.escritorioId,
              tipo: "nova_acao",
              dataEvento: new Date(),
              fonte: "pje",
              conteudo: `Nova ação: ${cnj} contra ${mon.apelido ?? mon.searchKey}`,
              conteudoJson: JSON.stringify({
                cnj,
                searchKey: mon.searchKey,
                searchType: mon.searchType,
                tribunal: mon.tribunal,
              }),
              cnjAfetado: cnj,
              hashDedup: dedup,
              lido: false,
            });
          } catch {
            /* dedup */
          }
        }
      }

      return {
        ok: true,
        cnjsTotal: resultado.cnjs.length,
        cnjsNovos: isPrimeiraExecucao ? 0 : cnjsNovos.length,
        baseline: isPrimeiraExecucao,
        latenciaMs: resultado.latenciaMs,
      };
    }),
});
