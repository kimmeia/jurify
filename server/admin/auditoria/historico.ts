/**
 * Histórico das varreduras do robô auditor.
 *
 * Este é o ÚNICO módulo do robô que escreve, e escreve só na tabela dele
 * (`robo_auditor_varreduras`). A detecção continua read-only — as regras
 * não têm caminho de escrita nenhum, e um teste em `regras.test.ts` trava
 * isso por varredura de texto.
 *
 * O motivo de existir: a varredura agendada reportava só no Sentry, e
 * `captureError` é no-op quando não há DSN. O achado sumia e o painel de
 * erros vazio parecia banco saudável. Persistir aqui é o que transforma
 * "não tem nada em aberto" numa afirmação verificável.
 */

import { desc, lt } from "drizzle-orm";
import { getDb } from "../../db";
import { roboAuditorVarreduras } from "../../../drizzle/schema";
import { createLogger } from "../../_core/logger";
import type { ResultadoVarredura } from "./tipos";

const log = createLogger("robo-auditor-historico");

/**
 * Por quanto tempo o histórico interessa. Passou disso, a linha só ocupa
 * espaço: o valor está na curva recente, não no que o banco era em abril.
 */
const DIAS_RETENCAO = 60;

export type OrigemVarredura = "cron" | "manual";

export interface RegraNoHistorico {
  id: string;
  severidade: string;
  total: number;
  erro?: string;
}

function detalhar(resultado: ResultadoVarredura): RegraNoHistorico[] {
  return resultado.achados.map((a) => ({
    id: a.regra.id,
    severidade: a.regra.severidade,
    total: a.total,
    ...(a.erro ? { erro: a.erro } : {}),
  }));
}

/**
 * Grava a varredura. Fail-safe: erro ao gravar histórico não pode derrubar
 * a varredura em si — o achado já foi produzido e o log estruturado já saiu.
 */
export async function salvarVarredura(
  resultado: ResultadoVarredura,
  origem: OrigemVarredura,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    await db.insert(roboAuditorVarreduras).values({
      runId: resultado.runId,
      origem,
      iniciadoEm: new Date(resultado.iniciadoEm),
      latenciaMs: resultado.latenciaMs,
      regrasExecutadas: resultado.resumo.regrasExecutadas,
      achados: resultado.resumo.achados,
      linhasAfetadas: resultado.resumo.linhasAfetadas,
      regrasComErro: resultado.resumo.regrasComErro,
      detalhePorRegra: JSON.stringify(detalhar(resultado)),
    });

    const corte = new Date(Date.now() - DIAS_RETENCAO * 24 * 60 * 60 * 1000);
    await db.delete(roboAuditorVarreduras).where(lt(roboAuditorVarreduras.createdAt, corte));
  } catch (err: any) {
    log.error({ err: err?.message ?? String(err) }, "Falha ao gravar histórico da varredura");
  }
}

export interface VarreduraResumida {
  id: number;
  runId: string;
  origem: OrigemVarredura;
  iniciadoEm: string;
  latenciaMs: number;
  regrasExecutadas: number;
  achados: number;
  linhasAfetadas: number;
  regrasComErro: number;
  regras: RegraNoHistorico[];
}

function parsearDetalhe(json: string | null): RegraNoHistorico[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function listarUltimasVarreduras(limite = 10): Promise<VarreduraResumida[]> {
  const db = await getDb();
  if (!db) return [];

  const linhas = await db
    .select()
    .from(roboAuditorVarreduras)
    .orderBy(desc(roboAuditorVarreduras.id))
    .limit(limite);

  return linhas.map((l) => ({
    id: l.id,
    runId: l.runId,
    origem: l.origem,
    iniciadoEm: l.iniciadoEm.toISOString(),
    latenciaMs: l.latenciaMs,
    regrasExecutadas: l.regrasExecutadas,
    achados: l.achados,
    linhasAfetadas: l.linhasAfetadas,
    regrasComErro: l.regrasComErro,
    regras: parsearDetalhe(l.detalhePorRegra),
  }));
}
