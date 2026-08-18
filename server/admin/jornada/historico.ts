/**
 * Histórico das execuções do robô de jornada.
 *
 * A execução leva minutos, então a linha nasce ANTES dela terminar, com
 * status `rodando`. Sem isso o painel ficaria mudo entre o clique e o
 * resultado, e quem clicou não teria como saber se começou.
 *
 * O detalhe vai em JSON porque o formato do achado ainda vai mudar — migração
 * por causa de campo de relatório não se paga. O resumo fica em coluna porque
 * é o que a listagem lê.
 */

import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { jornadaVarreduras } from "../../../drizzle/schema";
import { createLogger } from "../../_core/logger";
import { CONFERENCIAS } from "./conferencias";
import type { ResultadoJornada } from "./executor";

const log = createLogger("robo-jornada");

export type OrigemJornada = "manual" | "cron";

export async function abrirVarredura(
  runId: string,
  baseUrl: string,
  origem: OrigemJornada,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(jornadaVarreduras).values({
    runId,
    baseUrl: baseUrl.slice(0, 255),
    origem,
    status: "rodando",
    conferenciasTotal: CONFERENCIAS.length,
  });
}

export async function fecharVarredura(runId: string, r: ResultadoJornada): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(jornadaVarreduras)
    .set({
      status: r.erro ? "falhou" : "concluida",
      terminadoEm: new Date(),
      duracaoMs: r.duracaoMs,
      rotasVisitadas: r.rotas.length,
      rotasComAchado: r.rotasComAchado,
      escritorioLimpo: r.escritorioLimpo,
      erro: r.erro?.slice(0, 500) ?? null,
      // Só as rotas com problema entram no detalhe: guardar as 19 sempre
      // encheria a coluna de linha verde que ninguém lê.
      detalheJson: JSON.stringify({
        rotas: r.rotas.filter((x) => !x.ok),
        totalRotas: r.rotas.length,
      }),
    })
    .where(eq(jornadaVarreduras.runId, runId));

  log.info(
    { runId, rotas: r.rotas.length, achados: r.rotasComAchado, limpo: r.escritorioLimpo },
    "varredura de jornada registrada",
  );
}

/**
 * Marca como falha uma execução que morreu sem passar pelo `fechar` — processo
 * derrubado no meio, por exemplo. Sem isso a linha ficaria `rodando` pra
 * sempre e o painel diria que o robô está trabalhando quando não está.
 */
export async function marcarFalha(runId: string, motivo: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(jornadaVarreduras)
    .set({ status: "falhou", terminadoEm: new Date(), erro: motivo.slice(0, 500) })
    .where(eq(jornadaVarreduras.runId, runId));
}

export interface VarreduraResumida {
  runId: string;
  origem: string;
  baseUrl: string;
  status: string;
  iniciadoEm: string;
  duracaoMs: number | null;
  rotasVisitadas: number;
  rotasComAchado: number;
  conferenciasTotal: number;
  conferenciasFalhas: number;
  escritorioLimpo: boolean;
  erro: string | null;
  rotasComProblema: Array<{ rota: string; problemas: string[] }>;
}

export async function listarVarreduras(limite = 10): Promise<VarreduraResumida[]> {
  const db = await getDb();
  if (!db) return [];
  const linhas = await db
    .select()
    .from(jornadaVarreduras)
    .orderBy(desc(jornadaVarreduras.iniciadoEm))
    .limit(limite);

  return linhas.map((l) => {
    let rotasComProblema: VarreduraResumida["rotasComProblema"] = [];
    try {
      // JSON quebrado de alguma versão anterior não pode derrubar a listagem
      // inteira — a execução aconteceu, e o resumo em coluna continua válido.
      const d = l.detalheJson ? JSON.parse(l.detalheJson) : null;
      if (Array.isArray(d?.rotas)) {
        rotasComProblema = d.rotas.map((r: any) => ({
          rota: String(r?.rota ?? ""),
          problemas: Array.isArray(r?.problemas) ? r.problemas.map(String) : [],
        }));
      }
    } catch {
      /* detalhe ilegível — o resumo basta */
    }
    return {
      runId: l.runId,
      origem: l.origem,
      baseUrl: l.baseUrl,
      status: l.status,
      iniciadoEm: l.iniciadoEm?.toISOString() ?? "",
      duracaoMs: l.duracaoMs,
      rotasVisitadas: l.rotasVisitadas,
      rotasComAchado: l.rotasComAchado,
      conferenciasTotal: l.conferenciasTotal,
      conferenciasFalhas: l.conferenciasFalhas,
      escritorioLimpo: l.escritorioLimpo,
      erro: l.erro,
      rotasComProblema,
    };
  });
}
