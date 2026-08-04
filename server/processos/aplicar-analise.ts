/**
 * Cola entre a análise da IA e o que fica gravado: colunas de classificação
 * do evento e a sugestão de prazo com data já calculada.
 *
 * Fica separado do cron porque o mesmo caminho é usado quando o advogado
 * clica em "analisar de novo" no painel — e porque a parte que decide a data
 * do prazo merece teste sem precisar de banco nem de IA.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { eventosProcesso, prazosSugeridos } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import { contarPrazoProcessual } from "./prazo-processual";
import { localizarTrecho } from "./teor-documento";
import type { AnaliseMovimentacao } from "./resumir-movimentacao";

const log = createLogger("aplicar-analise");

export type PrazoMontado = {
  tipo: "audiencia" | "prazo_processual";
  titulo: string;
  dataSugerida: Date;
  prazoDias: number | null;
  prazoUteis: boolean;
  motivo: string;
  trechoOrigem: string | null;
};

/**
 * Converte a providência da análise numa sugestão de prazo com data.
 *
 * Devolve null quando não há providência nossa ou quando não há como chegar a
 * uma data — melhor não sugerir do que sugerir uma data inventada, porque um
 * prazo errado na agenda é pior que prazo nenhum.
 */
export function montarPrazoSugerido(
  analise: AnaliseMovimentacao,
  dataEvento: Date,
  feriadosExtras?: string[],
): PrazoMontado | null {
  const p = analise.providencia;
  if (!p.exigida) return null;

  // Data explícita (audiência, perícia, sessão) manda: o juiz já disse quando.
  if (p.dataExplicita) {
    const data = new Date(`${p.dataExplicita}T00:00:00Z`);
    if (Number.isNaN(data.getTime())) return null;
    return {
      tipo: analise.ato === "audiencia" ? "audiencia" : "prazo_processual",
      titulo: p.descricao ?? analise.titulo,
      dataSugerida: data,
      prazoDias: null,
      prazoUteis: false,
      motivo: `Data designada no documento${p.consequencia ? ` — ${p.consequencia}` : ""}`,
      trechoOrigem: p.citacao,
    };
  }

  if (!p.prazoDias) return null;

  const { vencimento, observacoes, fundamentos } = contarPrazoProcessual(
    dataEvento,
    p.prazoDias,
    p.prazoUteis,
    feriadosExtras,
  );

  return {
    tipo: "prazo_processual",
    titulo: p.descricao ?? analise.titulo,
    dataSugerida: vencimento,
    prazoDias: p.prazoDias,
    prazoUteis: p.prazoUteis,
    motivo: [
      `${p.prazoDias} dias ${p.prazoUteis ? "úteis" : "corridos"} contados da intimação`,
      p.consequencia ? `sob pena de ${p.consequencia}` : null,
      fundamentos.join("; "),
      ...observacoes,
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 1000),
    trechoOrigem: p.citacao,
  };
}

/**
 * Grava a análise no evento e, quando cabe, cria a sugestão de prazo.
 *
 * Não lança: falha aqui não pode derrubar o ciclo do cron nem a mutation da
 * UI — a movimentação já foi detectada, e é isso que o advogado não pode
 * perder.
 */
export async function persistirAnalise(params: {
  eventoId: number;
  escritorioId: number;
  monitoramentoId: number | null;
  cnj: string | null;
  dataEvento: Date;
  teor: string | null;
  analise: AnaliseMovimentacao;
  feriadosExtras?: string[];
}): Promise<{ prazoCriado: boolean }> {
  const db = await getDb();
  if (!db) return { prazoCriado: false };

  const { analise, teor } = params;

  // A IA reescreve acento e pontuação ao copiar. Se a citação existir de fato
  // no documento, troca pelo texto ORIGINAL — é o que a UI vai grifar, e
  // grifar um texto que não bate com o documento é pior que não grifar.
  if (analise.providencia.citacao && teor) {
    const literal = localizarTrecho(teor, analise.providencia.citacao);
    analise.providencia.citacao = literal ?? analise.providencia.citacao;
  }

  try {
    await db
      .update(eventosProcesso)
      .set({
        resumoIa: analise.titulo,
        desfecho: analise.desfecho,
        relevancia: analise.relevancia,
        analiseJson: JSON.stringify(analise),
      })
      .where(eq(eventosProcesso.id, params.eventoId));
  } catch (err) {
    log.warn(
      { eventoId: params.eventoId, err: err instanceof Error ? err.message : String(err) },
      "UPDATE da análise falhou",
    );
    return { prazoCriado: false };
  }

  const prazo = montarPrazoSugerido(analise, params.dataEvento, params.feriadosExtras);
  if (!prazo) return { prazoCriado: false };

  try {
    await db.insert(prazosSugeridos).values({
      escritorioId: params.escritorioId,
      eventoId: params.eventoId,
      monitoramentoId: params.monitoramentoId,
      tipo: prazo.tipo,
      titulo: prazo.titulo.slice(0, 255),
      dataSugerida: prazo.dataSugerida,
      prazoDias: prazo.prazoDias,
      prazoUteis: prazo.prazoUteis,
      motivo: prazo.motivo,
      trechoOrigem: prazo.trechoOrigem,
      cnjAfetado: params.cnj,
      status: "pendente",
    });
    return { prazoCriado: true };
  } catch (err) {
    const errAny = err as { cause?: { code?: string; errno?: number } };
    const isDup = errAny?.cause?.code === "ER_DUP_ENTRY" || errAny?.cause?.errno === 1062;
    if (!isDup) {
      log.warn(
        { eventoId: params.eventoId, err: err instanceof Error ? err.message : String(err) },
        "INSERT de prazo sugerido falhou",
      );
      return { prazoCriado: false };
    }

    // UNIQUE em evento_id. Já existe sugestão — em geral a da regex, criada no
    // momento em que a movimentação foi detectada. A da IA leu o documento e
    // sabe de que lado o cliente está, então substitui. Só mexe em `pendente`:
    // se o advogado já aprovou ou descartou, a decisão dele manda.
    try {
      await db
        .update(prazosSugeridos)
        .set({
          tipo: prazo.tipo,
          titulo: prazo.titulo.slice(0, 255),
          dataSugerida: prazo.dataSugerida,
          prazoDias: prazo.prazoDias,
          prazoUteis: prazo.prazoUteis,
          motivo: prazo.motivo,
          trechoOrigem: prazo.trechoOrigem,
        })
        .where(and(eq(prazosSugeridos.eventoId, params.eventoId), eq(prazosSugeridos.status, "pendente")));
      return { prazoCriado: true };
    } catch (errUpd) {
      log.warn(
        { eventoId: params.eventoId, err: errUpd instanceof Error ? errUpd.message : String(errUpd) },
        "UPDATE de prazo sugerido falhou",
      );
      return { prazoCriado: false };
    }
  }
}
