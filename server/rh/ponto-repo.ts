/**
 * A captura do ponto.
 *
 * Nada aqui é uma tela nova pro colaborador bater cartão: o sistema já sabe
 * quando ele está trabalhando, porque o frontend manda um heartbeat a cada
 * cinco minutos desde antes deste módulo existir. A entrada é o primeiro
 * heartbeat do dia; a atividade é cada um dos seguintes; a saída é o clique em
 * "sair", quando ele acontece.
 *
 * Ser pendurado num sinal que já existia é o que torna o ponto confiável sem
 * pedir disciplina de ninguém — e disciplina é exatamente o que falta num
 * cartão de ponto manual.
 *
 * Toda escrita aqui é best-effort e engolida em caso de erro: o ponto não pode
 * derrubar o heartbeat nem o logout. Perder uma marcação é um dia pra o gestor
 * ajustar; derrubar o logout é o usuário achando que saiu quando não saiu.
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../db";
import { pontoDias } from "../../drizzle/schema";
import { diaCivilEmTz } from "../_core/dates";
import { createLogger } from "../_core/logger";

const log = createLogger("ponto");

interface Alvo {
  escritorioId: number;
  colaboradorId: number;
  fusoHorario: string;
}

/**
 * Marca presença: cria o dia com a entrada no primeiro sinal e atualiza a
 * última atividade em todos os seguintes.
 *
 * A entrada só é gravada uma vez por dia — `entradaEm` nunca é sobrescrita
 * aqui. Quem chegou às 8h e recarregou a página às 14h não começou a trabalhar
 * às 14h, e um UPSERT descuidado transformaria isso numa jornada de duas
 * horas.
 */
export async function marcarPresenca(alvo: Alvo, agora = new Date()): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const dia = diaCivilEmTz(agora, alvo.fusoHorario);

    await db
      .insert(pontoDias)
      .values({
        escritorioId: alvo.escritorioId,
        colaboradorId: alvo.colaboradorId,
        dia,
        entradaEm: agora,
        entradaOrigem: "login",
        ultimaAtividadeEm: agora,
      })
      .onDuplicateKeyUpdate({ set: { ultimaAtividadeEm: agora } });
  } catch (err) {
    log.warn({ err: String(err), colaboradorId: alvo.colaboradorId }, "Falha ao marcar presença");
  }
}

/**
 * Registra a saída no clique em "sair" — a única marcação que é fato batido.
 *
 * Só grava se o dia já tiver entrada: quem faz logout de uma sessão que nunca
 * virou expediente (abriu, não trabalhou, saiu) não deve ganhar um dia no
 * espelho. E não sobrescreve saída já registrada, porque a segunda saída do
 * mesmo dia é o segundo logout, não o fim do expediente.
 */
export async function marcarSaida(alvo: Alvo, agora = new Date()): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const dia = diaCivilEmTz(agora, alvo.fusoHorario);

    const [atual] = await db
      .select({ id: pontoDias.id, entradaEm: pontoDias.entradaEm, saidaEm: pontoDias.saidaEm })
      .from(pontoDias)
      .where(and(eq(pontoDias.colaboradorId, alvo.colaboradorId), eq(pontoDias.dia, dia)))
      .limit(1);

    if (!atual?.entradaEm || atual.saidaEm) return;

    await db
      .update(pontoDias)
      .set({ saidaEm: agora, saidaOrigem: "registrada", ultimaAtividadeEm: agora })
      .where(eq(pontoDias.id, atual.id));
  } catch (err) {
    log.warn({ err: String(err), colaboradorId: alvo.colaboradorId }, "Falha ao marcar saída");
  }
}

export type LadoDaPausa = "inicio" | "fim";

/** Início e retorno do almoço. Marcação explícita — não há como inferir. */
export async function marcarPausa(
  alvo: Alvo,
  lado: LadoDaPausa,
  agora = new Date(),
): Promise<{ ok: boolean; motivo?: string }> {
  const db = await getDb();
  if (!db) return { ok: false, motivo: "Base de dados indisponível." };
  const dia = diaCivilEmTz(agora, alvo.fusoHorario);

  const [atual] = await db
    .select({
      id: pontoDias.id,
      entradaEm: pontoDias.entradaEm,
      pausaInicioEm: pontoDias.pausaInicioEm,
      pausaFimEm: pontoDias.pausaFimEm,
    })
    .from(pontoDias)
    .where(and(eq(pontoDias.colaboradorId, alvo.colaboradorId), eq(pontoDias.dia, dia)))
    .limit(1);

  if (!atual?.entradaEm) return { ok: false, motivo: "Sem entrada registrada hoje." };

  if (lado === "inicio") {
    if (atual.pausaInicioEm) return { ok: false, motivo: "A pausa de hoje já foi iniciada." };
    await db
      .update(pontoDias)
      .set({ pausaInicioEm: agora, ultimaAtividadeEm: agora })
      .where(eq(pontoDias.id, atual.id));
    return { ok: true };
  }

  if (!atual.pausaInicioEm) return { ok: false, motivo: "Não há pausa aberta pra encerrar." };
  if (atual.pausaFimEm) return { ok: false, motivo: "A pausa de hoje já foi encerrada." };
  await db
    .update(pontoDias)
    .set({ pausaFimEm: agora, ultimaAtividadeEm: agora })
    .where(eq(pontoDias.id, atual.id));
  return { ok: true };
}

/**
 * Desde quando o ponto está olhando pra este escritório.
 *
 * Existe por causa do primeiro dia: o módulo entrou no ar às 15h, o primeiro
 * heartbeat de todo mundo foi o do deploy, e o espelho acusou sete horas de
 * atraso de gente que estava trabalhando desde as oito. A conta estava certa;
 * a premissa não. Às 08:00 daquele dia não havia sistema registrando nada.
 *
 * O instante da primeira linha do escritório é o marco: antes dele, o ponto
 * não viu — e o que não foi visto não vira atraso. Vale pra qualquer
 * escritório novo pelo mesmo motivo, e some sozinho no segundo dia.
 */
export async function observandoDesde(escritorioId: number): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const [linha] = await db
    .select({ em: pontoDias.createdAt })
    .from(pontoDias)
    .where(eq(pontoDias.escritorioId, escritorioId))
    .orderBy(pontoDias.createdAt)
    .limit(1);
  const em = linha?.em;
  if (!em) return null;
  const d = em instanceof Date ? em : new Date(em);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Os dias de um colaborador num intervalo, crus — o cálculo é do `shared`. */
export async function diasDoPeriodo(
  escritorioId: number,
  colaboradorId: number,
  de: string,
  ate: string,
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(pontoDias)
    .where(and(
      eq(pontoDias.escritorioId, escritorioId),
      eq(pontoDias.colaboradorId, colaboradorId),
      gte(pontoDias.dia, de),
      lte(pontoDias.dia, ate),
    ))
    .orderBy(pontoDias.dia);
}

/** Os dias de TODO o escritório num intervalo — o espelho da equipe. */
export async function diasDoEscritorio(escritorioId: number, de: string, ate: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(pontoDias)
    .where(and(
      eq(pontoDias.escritorioId, escritorioId),
      gte(pontoDias.dia, de),
      lte(pontoDias.dia, ate),
    ))
    .orderBy(pontoDias.dia);
}

/**
 * Ajuste do gestor.
 *
 * Cria o dia se ele não existir — falta lançada à mão é o caso mais comum, e
 * exigir que o colaborador tenha logado pra o gestor poder corrigir seria
 * exigir justamente o que falhou.
 *
 * Toda marcação tocada aqui vira origem `manual`, e o registro guarda quem
 * mexeu, quando e por quê. Sem isso o espelho ficaria certo e não auditável, e
 * folha de ponto sem rastro de ajuste não vale como prova pra nenhum dos dois
 * lados.
 */
export async function ajustarDia(args: {
  escritorioId: number;
  colaboradorId: number;
  dia: string;
  gestorId: number;
  observacao: string;
  entradaEm?: Date | null;
  pausaInicioEm?: Date | null;
  pausaFimEm?: Date | null;
  saidaEm?: Date | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");

  const campos = {
    ...(args.entradaEm !== undefined ? { entradaEm: args.entradaEm, entradaOrigem: "manual" as const } : {}),
    ...(args.pausaInicioEm !== undefined ? { pausaInicioEm: args.pausaInicioEm } : {}),
    ...(args.pausaFimEm !== undefined ? { pausaFimEm: args.pausaFimEm } : {}),
    ...(args.saidaEm !== undefined ? { saidaEm: args.saidaEm, saidaOrigem: "manual" as const } : {}),
    ajustadoPor: args.gestorId,
    ajustadoEm: new Date(),
    observacao: args.observacao,
  };

  await db
    .insert(pontoDias)
    .values({
      escritorioId: args.escritorioId,
      colaboradorId: args.colaboradorId,
      dia: args.dia,
      ...campos,
    })
    .onDuplicateKeyUpdate({ set: campos });
}
