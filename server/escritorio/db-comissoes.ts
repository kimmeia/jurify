/**
 * Lógica reutilizável de fechamento de comissão. Compartilhada entre:
 *  - `router-comissoes.fechar` (mutation manual chamada pelo dono/gestor)
 *  - `cron-comissoes.processarAgendasComissao` (worker que roda a cada
 *     15 min e fecha automaticamente conforme `comissoes_agenda`)
 *
 * A função NÃO valida permissão — o caller é responsável (no router já
 * há `requireGestao`; no cron é o sistema).
 */

import { getDb } from "../db";
import {
  asaasCobrancas,
  categoriasCobranca,
  comissoesFechadas,
  comissoesFechadasItens,
  comissoesLancamentosLog,
} from "../../drizzle/schema";
import { and, asc, between, eq, inArray, isNotNull } from "drizzle-orm";
import { listarFaixasComissao, obterRegraComissao } from "./db-financeiro";
import {
  calcularComissao,
  type CobrancaParaComissao,
  type FaixaComissao,
  type MotivoExclusao,
} from "../../shared/calculo-comissao";

const STATUS_PAGOS = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];

/** Simula comissão detalhada de um atendente em um período. Lê regra
 *  vigente, faixas (se modo=faixas) e cobranças com JOIN em categoria.
 *  Retorna estrutura usada por UI e por `fecharComissao`. */
export async function simularComissao(
  escritorioId: number,
  atendenteId: number,
  periodoInicio: string,
  periodoFim: string,
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const regraRow = await obterRegraComissao(escritorioId);
  const aliquotaPercent = regraRow ? Number(regraRow.aliquotaPercent) : 0;
  const valorMinimo = regraRow ? Number(regraRow.valorMinimoCobranca) : 0;
  const modo = regraRow?.modo ?? "flat";
  const baseFaixa = regraRow?.baseFaixa ?? "comissionavel";

  const faixasRows = modo === "faixas" ? await listarFaixasComissao(escritorioId) : [];
  const faixas: FaixaComissao[] = faixasRows.map((f) => ({
    limiteAte: f.limiteAte === null ? null : Number(f.limiteAte),
    aliquotaPercent: Number(f.aliquotaPercent),
  }));

  const linhas = await db
    .select({
      id: asaasCobrancas.id,
      valor: asaasCobrancas.valor,
      dataPagamento: asaasCobrancas.dataPagamento,
      status: asaasCobrancas.status,
      atendenteId: asaasCobrancas.atendenteId,
      categoriaId: asaasCobrancas.categoriaId,
      comissionavelOverride: asaasCobrancas.comissionavelOverride,
      categoriaNome: categoriasCobranca.nome,
      categoriaComissionavel: categoriasCobranca.comissionavel,
      descricao: asaasCobrancas.descricao,
      asaasPaymentId: asaasCobrancas.asaasPaymentId,
    })
    .from(asaasCobrancas)
    .leftJoin(categoriasCobranca, eq(categoriasCobranca.id, asaasCobrancas.categoriaId))
    .where(
      and(
        eq(asaasCobrancas.escritorioId, escritorioId),
        eq(asaasCobrancas.atendenteId, atendenteId),
        isNotNull(asaasCobrancas.dataPagamento),
        between(asaasCobrancas.dataPagamento, periodoInicio, periodoFim),
        inArray(asaasCobrancas.status, STATUS_PAGOS),
      ),
    )
    .orderBy(asc(asaasCobrancas.dataPagamento));

  const cobrancasParaCalculo: CobrancaParaComissao[] = linhas.map((l) => ({
    id: l.id,
    valor: Number(l.valor),
    dataPagamento: new Date(l.dataPagamento + "T00:00:00"),
    atendenteId: l.atendenteId,
    categoriaComissionavel: l.categoriaComissionavel ?? null,
    comissionavelOverride: l.comissionavelOverride ?? null,
  }));

  const resultado = calcularComissao(cobrancasParaCalculo, {
    modo,
    aliquotaPercent,
    valorMinimo,
    faixas,
    baseFaixa,
  });

  const linhasMap = new Map(linhas.map((l) => [l.id, l]));
  const enriquecer = (id: number, motivo?: MotivoExclusao) => {
    const l = linhasMap.get(id)!;
    return {
      id: l.id,
      asaasPaymentId: l.asaasPaymentId,
      valor: Number(l.valor),
      dataPagamento: l.dataPagamento,
      descricao: l.descricao,
      categoriaNome: l.categoriaNome,
      categoriaComissionavel: l.categoriaComissionavel,
      comissionavelOverride: l.comissionavelOverride,
      motivoExclusao: motivo ?? null,
    };
  };

  return {
    regra: { aliquotaPercent, valorMinimo, modo, baseFaixa, faixas },
    aliquotaAplicada: resultado.aliquotaAplicada,
    faixaAplicada: resultado.faixaAplicada ?? null,
    comissionaveis: resultado.comissionaveis.map((c) => enriquecer(c.id)),
    naoComissionaveis: resultado.naoComissionaveis.map((n) =>
      enriquecer(n.cobranca.id, n.motivo),
    ),
    totais: resultado.totais,
  };
}

export interface FecharComissaoParams {
  escritorioId: number;
  atendenteId: number;
  periodoInicio: string;
  periodoFim: string;
  /** Pra origem='automatico' use o dono do escritório como autor
   *  "fictício" — auditoria depende disso. */
  fechadoPorUserId: number;
  origem?: "manual" | "automatico";
  agendaId?: number | null;
  observacoes?: string | null;
}

/** Persiste cabeçalho + itens. Função pura: NÃO valida permissões. */
export async function fecharComissao(
  params: FecharComissaoParams,
): Promise<{ id: number; totais: { bruto: number; comissionavel: number; naoComissionavel: number; valorComissao: number } }> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const sim = await simularComissao(
    params.escritorioId,
    params.atendenteId,
    params.periodoInicio,
    params.periodoFim,
  );

  const [novo] = await db
    .insert(comissoesFechadas)
    .values({
      escritorioId: params.escritorioId,
      atendenteId: params.atendenteId,
      periodoInicio: params.periodoInicio,
      periodoFim: params.periodoFim,
      totalBrutoRecebido: sim.totais.bruto.toFixed(2),
      totalComissionavel: sim.totais.comissionavel.toFixed(2),
      totalNaoComissionavel: sim.totais.naoComissionavel.toFixed(2),
      totalComissao: sim.totais.valorComissao.toFixed(2),
      aliquotaUsada: sim.aliquotaAplicada.toFixed(2),
      modoUsado: sim.regra.modo,
      baseFaixaUsada: sim.regra.modo === "faixas" ? sim.regra.baseFaixa : null,
      faixasUsadas: sim.regra.modo === "faixas" ? JSON.stringify(sim.regra.faixas) : null,
      valorMinimoUsado: sim.regra.valorMinimo.toFixed(2),
      fechadoPorUserId: params.fechadoPorUserId,
      observacoes: params.observacoes ?? null,
      origem: params.origem ?? "manual",
      agendaId: params.agendaId ?? null,
    })
    .$returningId();

  const itens = [
    ...sim.comissionaveis.map((c) => ({
      comissaoFechadaId: novo.id,
      asaasCobrancaId: c.id,
      valor: c.valor.toFixed(2),
      foiComissionavel: true,
      motivoExclusao: null,
    })),
    ...sim.naoComissionaveis.map((c) => ({
      comissaoFechadaId: novo.id,
      asaasCobrancaId: c.id,
      valor: c.valor.toFixed(2),
      foiComissionavel: false,
      motivoExclusao: c.motivoExclusao ?? null,
    })),
  ];

  if (itens.length > 0) {
    await db.insert(comissoesFechadasItens).values(itens);
  }

  return { id: novo.id, totais: sim.totais };
}

// ─── Helpers de período ─────────────────────────────────────────────────────

/** Retorna primeiro e último dia do mês ANTERIOR à data de referência,
 *  no formato YYYY-MM-DD. Ex: ref=2026-04-01 → ['2026-03-01','2026-03-31']. */
export function periodoMesAnterior(referencia: Date): { inicio: string; fim: string } {
  const ano = referencia.getFullYear();
  const mes = referencia.getMonth();
  const inicio = new Date(ano, mes - 1, 1);
  const fim = new Date(ano, mes, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { inicio: fmt(inicio), fim: fmt(fim) };
}

// ─── Log helpers ────────────────────────────────────────────────────────────

/** Reserva uma execução no log. Retorna `null` se já existe registro
 *  (concluído ou em andamento) — caller deve pular. Race ⇒ INSERT do
 *  segundo worker falha (UNIQUE) e retornamos null. */
export async function reservarExecucao(params: {
  escritorioId: number;
  agendaId: number;
  atendenteId: number;
  periodoInicio: string;
  periodoFim: string;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const existente = await db
    .select({ id: comissoesLancamentosLog.id, status: comissoesLancamentosLog.status })
    .from(comissoesLancamentosLog)
    .where(
      and(
        eq(comissoesLancamentosLog.escritorioId, params.escritorioId),
        eq(comissoesLancamentosLog.agendaId, params.agendaId),
        eq(comissoesLancamentosLog.atendenteId, params.atendenteId),
        eq(comissoesLancamentosLog.periodoInicio, params.periodoInicio),
        eq(comissoesLancamentosLog.periodoFim, params.periodoFim),
      ),
    )
    .limit(1);

  if (existente.length > 0) {
    const ex = existente[0];
    if (ex.status === "concluido" || ex.status === "em_andamento") return null;
    // 'falhou' → limpa pra permitir retry
    await db.delete(comissoesLancamentosLog).where(eq(comissoesLancamentosLog.id, ex.id));
  }

  try {
    const [r] = await db
      .insert(comissoesLancamentosLog)
      .values({
        escritorioId: params.escritorioId,
        agendaId: params.agendaId,
        atendenteId: params.atendenteId,
        periodoInicio: params.periodoInicio,
        periodoFim: params.periodoFim,
        status: "em_andamento",
      })
      .$returningId();
    return r.id;
  } catch {
    return null;
  }
}

export async function marcarExecucaoConcluida(
  logId: number,
  comissaoFechadaId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(comissoesLancamentosLog)
    .set({ status: "concluido", comissaoFechadaId, finalizadoEm: new Date() })
    .where(eq(comissoesLancamentosLog.id, logId));
}

export async function marcarExecucaoFalhou(logId: number, mensagem: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(comissoesLancamentosLog)
    .set({ status: "falhou", mensagemErro: mensagem.slice(0, 1000), finalizadoEm: new Date() })
    .where(eq(comissoesLancamentosLog.id, logId));
}
