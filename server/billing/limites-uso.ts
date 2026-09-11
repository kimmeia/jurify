/**
 * Quanto o escritório já usou no mês, e se pode usar mais.
 *
 * Substitui o saldo de créditos como régua das operações avulsas (consultar
 * processo, buscar por CPF/CNPJ, resumir com IA, calcular). Vaga — processos
 * e CPFs vigiados — continua com a régua dela em `limites-monitoramento`.
 *
 * Fail-open em tudo que for dúvida nossa, igual ao limite de monitoramento:
 * banco fora, escritório sem plano resolvido, cortesia ou erro NUNCA barram.
 * Barra só quando o plano foi lido e o número está lá.
 *
 * O saldo de créditos e o histórico dele continuam no banco — pararam de
 * decidir operação, não foram apagados.
 */

import { and, eq, sql } from "drizzle-orm";

import { getDb } from "../db";
import { escritorioUsoMensal, escritorios } from "../../drizzle/schema";
import {
  CAMPO_DO_PLANO,
  OPERACOES_LIMITADAS,
  competenciaDaData,
  excedeuLimite,
  limiteVale,
  mensagemLimiteAtingido,
  type OperacaoLimitada,
  type UsoDoMes,
} from "../../shared/limites-uso";
import { createLogger } from "../_core/logger";

const log = createLogger("limites-uso");

export type AvaliacaoUso = {
  permitido: boolean;
  usado: number;
  limite: number | null;
  mensagem: string | null;
};

const LIBERADO: AvaliacaoUso = { permitido: true, usado: 0, limite: null, mensagem: null };

export function competenciaAtual(): string {
  return competenciaDaData(new Date());
}

/** Limite do plano para a operação, já somado ao extra concedido no mês. */
async function limiteDoEscritorio(
  escritorioId: number,
  operacao: OperacaoLimitada,
  extra: number,
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const [esc] = await db
    .select({ ownerId: escritorios.ownerId })
    .from(escritorios)
    .where(eq(escritorios.id, escritorioId))
    .limit(1);
  if (!esc?.ownerId) return null;

  const { getActiveSubscriptionComHeranca } = await import("../db");
  const sub = await getActiveSubscriptionComHeranca(esc.ownerId);
  if (!sub?.planId || sub.cortesia) return null;

  const { getPlanoBySlug } = await import("./planos-repo");
  const plano = await getPlanoBySlug(sub.planId);
  if (!plano) return null;

  const bruto = plano.limites[CAMPO_DO_PLANO[operacao]] as number | null | undefined;
  if (!limiteVale(bruto)) return null;
  return (bruto as number) + Math.max(0, extra);
}

async function lerUso(escritorioId: number, operacao: OperacaoLimitada): Promise<{ usado: number; extra: number }> {
  const db = await getDb();
  if (!db) return { usado: 0, extra: 0 };
  const [row] = await db
    .select({ quantidade: escritorioUsoMensal.quantidade, extra: escritorioUsoMensal.extraConcedido })
    .from(escritorioUsoMensal)
    .where(and(
      eq(escritorioUsoMensal.escritorioId, escritorioId),
      eq(escritorioUsoMensal.competencia, competenciaAtual()),
      eq(escritorioUsoMensal.operacao, operacao),
    ))
    .limit(1);
  return { usado: Number(row?.quantidade ?? 0), extra: Number(row?.extra ?? 0) };
}

/** Pode fazer mais uma? Chamada ANTES do gasto externo. */
export async function verificarUso(escritorioId: number, operacao: OperacaoLimitada): Promise<AvaliacaoUso> {
  try {
    const { usado, extra } = await lerUso(escritorioId, operacao);
    const limite = await limiteDoEscritorio(escritorioId, operacao, extra);
    if (!limiteVale(limite)) return { permitido: true, usado, limite: null, mensagem: null };
    if (excedeuLimite(usado, limite)) {
      return { permitido: false, usado, limite, mensagem: mensagemLimiteAtingido(operacao, limite as number) };
    }
    return { permitido: true, usado, limite, mensagem: null };
  } catch (err: any) {
    log.warn({ err: err?.message, escritorioId, operacao }, "Falha ao ler limite de uso — liberando");
    return LIBERADO;
  }
}

/**
 * Soma uma unidade ao contador do mês. Silencioso de propósito: a operação do
 * advogado já aconteceu; perder a contagem é melhor do que derrubar o pedido.
 */
export async function registrarUso(
  escritorioId: number,
  operacao: OperacaoLimitada,
  quantidade = 1,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const competencia = competenciaAtual();
    await db
      .insert(escritorioUsoMensal)
      .values({ escritorioId, competencia, operacao, quantidade })
      .onDuplicateKeyUpdate({
        set: { quantidade: sql`${escritorioUsoMensal.quantidade} + ${quantidade}` },
      });
  } catch (err: any) {
    log.warn({ err: err?.message, escritorioId, operacao }, "Falha ao registrar uso do mês");
  }
}

/**
 * Trava + contagem numa chamada só, para quem cobra antes do gasto externo.
 * Lança quando o mês acabou — a mensagem é a que o usuário lê.
 */
export async function consumirUso(escritorioId: number, operacao: OperacaoLimitada): Promise<void> {
  const aval = await verificarUso(escritorioId, operacao);
  if (!aval.permitido) throw new Error(aval.mensagem || "Limite do mês atingido.");
  await registrarUso(escritorioId, operacao);
}

/** As quatro barras da tela: usado, limite e extra de cada operação. */
export async function usoDoMes(escritorioId: number): Promise<UsoDoMes[]> {
  const out: UsoDoMes[] = [];
  for (const operacao of OPERACOES_LIMITADAS) {
    try {
      const { usado, extra } = await lerUso(escritorioId, operacao);
      const limite = await limiteDoEscritorio(escritorioId, operacao, extra);
      out.push({ operacao, usado, limite: limiteVale(limite) ? (limite as number) : null, extra });
    } catch {
      out.push({ operacao, usado: 0, limite: null, extra: 0 });
    }
  }
  return out;
}

/**
 * Libera mais para ESTE mês (painel admin). Não vira saldo: na virada da
 * competência o extra some junto com a contagem.
 */
export async function concederExtra(
  escritorioId: number,
  operacao: OperacaoLimitada,
  quantidade: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const competencia = competenciaAtual();
  await db
    .insert(escritorioUsoMensal)
    .values({ escritorioId, competencia, operacao, quantidade: 0, extraConcedido: quantidade })
    .onDuplicateKeyUpdate({
      set: { extraConcedido: sql`${escritorioUsoMensal.extraConcedido} + ${quantidade}` },
    });
  log.info({ escritorioId, operacao, quantidade, competencia }, "Limite do mês aumentado pelo painel");
}
