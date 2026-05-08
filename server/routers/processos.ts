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
import { eq, desc, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { motorCreditos, motorTransacoes, cofreCredenciais } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { createLogger } from "../_core/logger";
import { parseCnjTribunal, sistemaCofrePorTribunal } from "../processos/cnj-parser";
import {
  ehRequestMotorProprio,
  iniciarConsultaMotorProprio,
  obterStatusMotorProprio,
  obterResultadoMotorProprio,
} from "../processos/motor-proprio-runner";
import { recuperarSessao } from "../escritorio/cofre-helpers";

const log = createLogger("processos-motor");

const PACOTES_CREDITOS = [
  { id: "pack_50", nome: "50 creditos", creditos: 50, preco: 49.9, popular: false },
  { id: "pack_200", nome: "200 creditos", creditos: 200, preco: 149.9, popular: true },
  { id: "pack_500", nome: "500 creditos", creditos: 500, preco: 299.9, popular: false },
  { id: "pack_1000", nome: "1000 creditos", creditos: 1000, preco: 499.9, popular: false },
] as const;

const CUSTOS = {
  consulta_cnj: 1,
} as const;

async function consumirCreditos(
  escritorioId: number,
  userId: number,
  custo: number,
  operacao: string,
  detalhes?: string,
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
  }

  const [creditos] = await db
    .select()
    .from(motorCreditos)
    .where(eq(motorCreditos.escritorioId, escritorioId))
    .limit(1);

  if (!creditos) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Escritório sem saldo de créditos. Compre um pacote pra começar.",
    });
  }

  if (creditos.saldo < custo) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Créditos insuficientes (saldo=${creditos.saldo}, custo=${custo}). Compre mais.`,
    });
  }

  const novoSaldo = creditos.saldo - custo;
  await db
    .update(motorCreditos)
    .set({
      saldo: novoSaldo,
      totalConsumido: creditos.totalConsumido + custo,
    })
    .where(eq(motorCreditos.id, creditos.id));

  await db.insert(motorTransacoes).values({
    escritorioId,
    tipo: "consumo",
    quantidade: custo,
    saldoAnterior: creditos.saldo,
    saldoDepois: novoSaldo,
    operacao,
    detalhes: detalhes ?? null,
    userId,
  });
}

export const processosRouter = router({
  saldo: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { saldo: 0, totalConsumido: 0, totalComprado: 0 };
    const db = await getDb();
    if (!db) return { saldo: 0, totalConsumido: 0, totalComprado: 0 };

    const [c] = await db
      .select()
      .from(motorCreditos)
      .where(eq(motorCreditos.escritorioId, esc.escritorio.id))
      .limit(1);

    return {
      saldo: c?.saldo ?? 0,
      totalConsumido: c?.totalConsumido ?? 0,
      totalComprado: c?.totalComprado ?? 0,
    };
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
});
