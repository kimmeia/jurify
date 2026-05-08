/**
 * Saldo único de créditos por escritório.
 *
 * Antes (legado, removido em 0073):
 *   - user_credits cobrava cálculos
 *   - motor_creditos cobrava processos/monitoramentos
 *
 * Agora: TUDO cobra de `escritorio_creditos`. O saldo é alimentado por:
 *   1. Cota mensal do plano (resetada via cron a cada 30 dias)
 *   2. Pacotes pré-pagos comprados (totalComprado, soma direto ao saldo)
 *
 * Política de reset: "saldo += cotaMensal" toda renovação. Sobra do mês
 * anterior é PRESERVADA (acumula). Justificativa: pacotes pré-pagos não
 * podem expirar arbitrariamente; cota mensal idem (cliente paga cheio).
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { escritorioCreditos, escritorioTransacoes, subscriptions, escritorios } from "../../drizzle/schema";
import { getPlanById } from "./products";
import { TRPCError } from "@trpc/server";

export interface SaldoEscritorio {
  saldo: number;
  cotaMensal: number;
  totalComprado: number;
  totalConsumido: number;
  ultimoReset: Date | null;
}

/**
 * Busca saldo (cria registro com cota do plano se não existe ainda).
 * NÃO consome — só leitura. Usa pra dashboards/headers.
 */
export async function getSaldoEscritorio(escritorioId: number): Promise<SaldoEscritorio> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

  const [existing] = await db.select().from(escritorioCreditos)
    .where(eq(escritorioCreditos.escritorioId, escritorioId)).limit(1);

  if (existing) {
    return {
      saldo: existing.saldo,
      cotaMensal: existing.cotaMensal,
      totalComprado: existing.totalComprado,
      totalConsumido: existing.totalConsumido,
      ultimoReset: existing.ultimoReset,
    };
  }

  // Não existe — cria com cota do plano do escritório
  const cotaMensal = await calcularCotaDoPlano(escritorioId);
  await db.insert(escritorioCreditos).values({
    escritorioId,
    saldo: cotaMensal,
    cotaMensal,
    totalComprado: 0,
    totalConsumido: 0,
    ultimoReset: new Date(),
  });

  return {
    saldo: cotaMensal,
    cotaMensal,
    totalComprado: 0,
    totalConsumido: 0,
    ultimoReset: new Date(),
  };
}

/**
 * Cobra créditos do saldo do escritório. Falha com TRPCError se saldo
 * insuficiente. Registra transação pra histórico.
 */
export async function consumirCreditosEscritorio(
  escritorioId: number,
  userId: number,
  custo: number,
  operacao: string,
  detalhes?: string,
): Promise<{ saldoAnterior: number; saldoDepois: number }> {
  if (custo <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "custo deve ser positivo" });

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

  // Garante registro existe (com cota do plano se primeiro acesso)
  const saldoAtual = await getSaldoEscritorio(escritorioId);

  if (saldoAtual.saldo < custo) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `Créditos insuficientes (precisa ${custo}, saldo ${saldoAtual.saldo}). ` +
        `Aguarde renovação do plano ou compre um pacote avulso.`,
    });
  }

  const novoSaldo = saldoAtual.saldo - custo;
  await db.update(escritorioCreditos)
    .set({
      saldo: novoSaldo,
      totalConsumido: saldoAtual.totalConsumido + custo,
    })
    .where(eq(escritorioCreditos.escritorioId, escritorioId));

  await db.insert(escritorioTransacoes).values({
    escritorioId,
    tipo: "consumo",
    quantidade: custo,
    saldoAnterior: saldoAtual.saldo,
    saldoDepois: novoSaldo,
    operacao,
    detalhes: detalhes ?? null,
    userId,
  });

  return { saldoAnterior: saldoAtual.saldo, saldoDepois: novoSaldo };
}

/**
 * Soma créditos ao saldo (pacote avulso comprado, bônus admin, estorno).
 */
export async function creditarEscritorio(
  escritorioId: number,
  userId: number,
  quantidade: number,
  tipo: "compra" | "bonus" | "estorno" | "reset_mensal",
  operacao: string,
  detalhes?: string,
): Promise<{ saldoNovo: number }> {
  if (quantidade <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "quantidade deve ser positiva" });

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

  const saldoAtual = await getSaldoEscritorio(escritorioId);
  const novoSaldo = saldoAtual.saldo + quantidade;
  const novoTotalComprado = tipo === "compra"
    ? saldoAtual.totalComprado + quantidade
    : saldoAtual.totalComprado;

  await db.update(escritorioCreditos)
    .set({ saldo: novoSaldo, totalComprado: novoTotalComprado })
    .where(eq(escritorioCreditos.escritorioId, escritorioId));

  await db.insert(escritorioTransacoes).values({
    escritorioId,
    tipo,
    quantidade,
    saldoAnterior: saldoAtual.saldo,
    saldoDepois: novoSaldo,
    operacao,
    detalhes: detalhes ?? null,
    userId,
  });

  return { saldoNovo: novoSaldo };
}

/**
 * Determina cota mensal do plano do escritório:
 *   - Procura subscription ativa do dono
 *   - Lê creditsPerMonth do plano
 *   - Free / sem subscription = 3 (legado pra trial)
 */
export async function calcularCotaDoPlano(escritorioId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Pega o dono do escritório
  const [esc] = await db.select({ ownerId: escritorios.ownerId })
    .from(escritorios)
    .where(eq(escritorios.id, escritorioId)).limit(1);
  if (!esc?.ownerId) return 0;

  // Subscription ativa do dono
  const [sub] = await db.select({ planId: subscriptions.planId, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.userId, esc.ownerId))
    .limit(1);

  if (!sub) return 3; // trial fallback (3 cred — manda criar conta)
  if (sub.status !== "active" && sub.status !== "trialing") return 3;

  if (!sub.planId) return 3;
  const plan = getPlanById(sub.planId);
  return plan?.creditsPerMonth ?? 3;
}

/**
 * Cron: pra cada escritório com ultimoReset > 30 dias, soma cotaMensal
 * ao saldo (renovação preservando sobras).
 *
 * Roda 1x/dia (ou cada 6h). Idempotente: só atua quando passou 30 dias.
 */
export async function resetCotaMensalEscritorios(): Promise<{ resetados: number }> {
  const db = await getDb();
  if (!db) return { resetados: 0 };

  const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const todos = await db.select().from(escritorioCreditos);
  let resetados = 0;

  for (const cred of todos) {
    const precisaReset = !cred.ultimoReset || cred.ultimoReset < trintaDiasAtras;
    if (!precisaReset) continue;

    // Recalcula cota baseado no plano atual (pode ter mudado)
    const cotaAtual = await calcularCotaDoPlano(cred.escritorioId);
    if (cotaAtual <= 0) continue; // free/sem plano: não acumula

    const novoSaldo = cred.saldo + cotaAtual;
    await db.update(escritorioCreditos)
      .set({
        saldo: novoSaldo,
        cotaMensal: cotaAtual,
        ultimoReset: new Date(),
      })
      .where(eq(escritorioCreditos.id, cred.id));

    await db.insert(escritorioTransacoes).values({
      escritorioId: cred.escritorioId,
      tipo: "reset_mensal",
      quantidade: cotaAtual,
      saldoAnterior: cred.saldo,
      saldoDepois: novoSaldo,
      operacao: "reset_mensal",
      detalhes: `Cota mensal do plano (${cotaAtual} cred)`,
      userId: 0, // sistema
    });

    resetados++;
  }

  return { resetados };
}
