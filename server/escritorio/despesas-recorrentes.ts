/**
 * Geração automática de despesas recorrentes.
 *
 * Quando o usuário cria uma despesa com `recorrencia` ∈ {semanal,mensal,anual},
 * a primeira ocorrência fica no banco como "modelo" (recorrenciaDeOrigemId
 * = NULL). O cron `gerarDespesasRecorrentes` (1h tick) processa cada modelo
 * ativa e gera filhas com vencimentos sucessivos até alcançar hoje.
 *
 * IDEMPOTÊNCIA:
 *  - Antes de criar uma filha, verifica se já existe uma despesa com o
 *    mesmo `recorrenciaDeOrigemId` E mesmo `vencimento`. Se sim, pula
 *    (cron ressuscitando de reboot não duplica).
 *
 * CATCH-UP:
 *  - Se o cron ficou parado e várias gerações estão pendentes, o loop
 *    interno avança vencimentos até alcançar hoje. Salva no DB cada
 *    ocorrência em transação curta — falha no meio não bloqueia.
 *
 * QUANDO PARA:
 *  - `recorrenciaAtiva=false` (usuário pausou)
 *  - próximo vencimento > hoje (já está em dia)
 *  - limite de segurança: máximo 1000 iterações por modelo por tick
 *    (proteção contra modelo corrompida que geraria infinitas filhas)
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { despesas } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import { dataHojeBR } from "../../shared/escritorio-types";

const log = createLogger("escritorio-despesas-recorrentes");

const MAX_GERACOES_POR_MODELO_POR_TICK = 1000;

/**
 * Avança 1 unidade de recorrência a partir de uma data ISO YYYY-MM-DD.
 *
 *  - semanal: +7 dias
 *  - mensal: +1 mês (com clamp: 31-jan → 28/29-fev → 31-mar)
 *  - anual: +1 ano (com clamp: 29-fev em ano bissexto → 28-fev no ano seguinte)
 *
 * Implementação manual sem libs externas — testável e determinística.
 */
export function avancarRecorrencia(
  iso: string,
  recorrencia: "semanal" | "mensal" | "anual",
): string {
  const [y, m, d] = iso.split("-").map(Number);

  if (recorrencia === "semanal") {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 7);
    return dt.toISOString().slice(0, 10);
  }

  if (recorrencia === "mensal") {
    let novoMes = m; // 1-12
    let novoAno = y;
    if (novoMes === 12) {
      novoMes = 1;
      novoAno += 1;
    } else {
      novoMes += 1;
    }
    // Clamp: dia que não existe no mês seguinte (ex: 31-jan → 28/29-fev)
    const ultimoDiaDoNovoMes = new Date(Date.UTC(novoAno, novoMes, 0)).getUTCDate();
    const novoDia = Math.min(d, ultimoDiaDoNovoMes);
    return `${novoAno.toString().padStart(4, "0")}-${novoMes.toString().padStart(2, "0")}-${novoDia.toString().padStart(2, "0")}`;
  }

  // anual
  const novoAno = y + 1;
  // Clamp: 29-fev em bissexto → 28-fev no seguinte
  const ultimoDiaDoMes = new Date(Date.UTC(novoAno, m, 0)).getUTCDate();
  const novoDia = Math.min(d, ultimoDiaDoMes);
  return `${novoAno.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${novoDia.toString().padStart(2, "0")}`;
}

/**
 * Gera filhas pendentes pra UMA modelo. Idempotente: se uma filha com o
 * mesmo vencimento já existe, pula. Retorna quantas foram criadas.
 *
 * Chamada pelo cron e (futuramente) por procedure manual "gerar agora".
 */
export async function gerarFilhasDeModelo(modelo: {
  id: number;
  escritorioId: number;
  categoriaId: number | null;
  descricao: string;
  valor: string;
  vencimento: string;
  recorrencia: "semanal" | "mensal" | "anual";
  observacoes: string | null;
  criadoPorUserId: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Acha a filha mais recente da série pra continuar a partir dela.
  // Se não houver filhas ainda, parte do vencimento da modelo.
  const filhas = await db
    .select({
      id: despesas.id,
      vencimento: despesas.vencimento,
    })
    .from(despesas)
    .where(eq(despesas.recorrenciaDeOrigemId, modelo.id))
    .orderBy(asc(despesas.vencimento));

  const ultimoVencimento =
    filhas.length > 0
      ? filhas[filhas.length - 1].vencimento
      : modelo.vencimento;

  const vencimentosExistentes = new Set([
    modelo.vencimento,
    ...filhas.map((f) => f.vencimento),
  ]);

  // Fuso BR: server roda em UTC; após 21h BRT viraria amanhã e o cron
  // antecipa a geração da próxima ocorrência por umas horas. Não é
  // crítico, mas consistente com o resto do módulo.
  const hojeIso = dataHojeBR();
  let proximoVencimento = avancarRecorrencia(ultimoVencimento, modelo.recorrencia);
  let geradas = 0;

  while (
    proximoVencimento <= hojeIso &&
    geradas < MAX_GERACOES_POR_MODELO_POR_TICK
  ) {
    // Idempotência: se já existe filha com este vencimento (cron rodou
    // antes parcialmente, ou usuário criou manual com mesma data), pula.
    if (vencimentosExistentes.has(proximoVencimento)) {
      proximoVencimento = avancarRecorrencia(proximoVencimento, modelo.recorrencia);
      continue;
    }

    try {
      await db.insert(despesas).values({
        escritorioId: modelo.escritorioId,
        categoriaId: modelo.categoriaId,
        descricao: modelo.descricao,
        valor: modelo.valor,
        valorPago: "0.00",
        vencimento: proximoVencimento,
        dataPagamento: null,
        status: "pendente",
        recorrencia: modelo.recorrencia,
        recorrenciaAtiva: false, // filhas não disparam o cron
        recorrenciaDeOrigemId: modelo.id,
        origem: "recorrencia",
        observacoes: modelo.observacoes,
        criadoPorUserId: modelo.criadoPorUserId,
      });
      vencimentosExistentes.add(proximoVencimento);
      geradas++;
    } catch (err: any) {
      // ER_DUP_ENTRY = race com outro caller (cron+botão "Gerar agora"
      // simultâneos). A UNIQUE (recorrenciaDeOrigemId, vencimento) garante
      // que só 1 filha vingue; o segundo INSERT cai aqui e é segurado
      // pelo Set em memória pra próximas iterações.
      if (
        err.code === "ER_DUP_ENTRY" ||
        /Duplicate entry/i.test(err.message ?? "")
      ) {
        vencimentosExistentes.add(proximoVencimento);
        log.info(
          { modeloId: modelo.id, vencimento: proximoVencimento },
          "[despesas-recorrentes] filha já existia (race com outro worker) — pula",
        );
      } else {
        log.warn(
          { err: err.message, modeloId: modelo.id, vencimento: proximoVencimento },
          "[despesas-recorrentes] falha ao gerar filha — pula",
        );
      }
    }

    proximoVencimento = avancarRecorrencia(proximoVencimento, modelo.recorrencia);
  }

  return geradas;
}

/**
 * Função-cron que processa todas as modelos ativas e gera filhas
 * pendentes. Chamada a cada 1h por `cron-jobs.ts`.
 */
export async function gerarDespesasRecorrentes(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Pega modelos elegíveis: recorrência ativa, não-nenhuma, sem
  // recorrenciaDeOrigemId (= é a modelo da série).
  const modelos = await db
    .select({
      id: despesas.id,
      escritorioId: despesas.escritorioId,
      categoriaId: despesas.categoriaId,
      descricao: despesas.descricao,
      valor: despesas.valor,
      vencimento: despesas.vencimento,
      recorrencia: despesas.recorrencia,
      observacoes: despesas.observacoes,
      criadoPorUserId: despesas.criadoPorUserId,
    })
    .from(despesas)
    .where(
      and(
        eq(despesas.recorrenciaAtiva, true),
        isNull(despesas.recorrenciaDeOrigemId),
      ),
    );

  // Filtra fora as não-recorrentes (recorrencia='nenhuma') — Drizzle não
  // tem `ne` simples em enum, fica mais limpo aqui.
  const modelosRecorrentes = modelos.filter((m) => m.recorrencia !== "nenhuma");

  if (modelosRecorrentes.length === 0) return;

  let totalGeradas = 0;
  for (const m of modelosRecorrentes) {
    try {
      const n = await gerarFilhasDeModelo(
        m as Parameters<typeof gerarFilhasDeModelo>[0],
      );
      totalGeradas += n;
    } catch (err: any) {
      log.error(
        { err: err.message, modeloId: m.id },
        "[despesas-recorrentes] exceção no processamento da modelo",
      );
    }
  }

  if (totalGeradas > 0) {
    log.info(
      `[despesas-recorrentes] ${totalGeradas} despesa(s) gerada(s) em ${modelosRecorrentes.length} modelo(s)`,
    );
  }
}
