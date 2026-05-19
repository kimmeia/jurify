/**
 * Runner pra "atualizar todos os monitoramentos" sob demanda.
 *
 * Padrão: user clica botão → procedure retorna `operacaoId` → background
 * task itera todos os monitoramentos do escritório chamando
 * `pollarUmMonitoramento*` (limite 3 paralelos pra não sobrecarregar
 * tribunal). Progresso é guardado em memória do processo (TTL 1h) +
 * emitido via SSE pra frontend atualizar em tempo real.
 *
 * Persistência em memória, NÃO em DB — operação efêmera, se o servidor
 * reiniciar a operação morre. Tradeoff aceitável: o usuário pode clicar
 * de novo. Salvar em DB criaria complexidade (limpeza de operações
 * abandonadas, retry após restart, etc) sem ganho proporcional.
 *
 * "Continua mesmo se user sair da página": o frontend pode reconectar
 * via `progressoAtualizacao(operacaoId)` e retomar exibição enquanto
 * a operação ainda estiver na memória.
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "../_core/logger";
import { emitirNotificacao } from "../_core/sse-notifications";
import {
  pollarUmMonitoramentoMovs,
  pollarUmMonitoramentoNovasAcoes,
} from "./cron-monitoramento";
import { getDb } from "../db";
import { motorMonitoramentos } from "../../drizzle/schema";
import { eq, and, or, inArray } from "drizzle-orm";

const log = createLogger("atualizacao-runner");

export type StatusAtualizacao = "rodando" | "concluido" | "erro";

export type ResultadoMonitorAtualizacao = {
  monitoramentoId: number;
  apelido: string | null;
  tipo: "movimentacoes" | "novas_acoes";
  status: "pendente" | "rodando" | "ok" | "erro";
  detectadas?: number;
  baseline?: boolean;
  erro?: string;
  inicioEm?: number;
  fimEm?: number;
};

type EntradaOperacao = {
  id: string;
  userId: number;
  escritorioId: number;
  status: StatusAtualizacao;
  iniciadoEm: number;
  finalizadoEm?: number;
  expiraEm: number;
  total: number;
  processados: number;
  ok: number;
  erro: number;
  detectadasTotal: number;
  monitores: ResultadoMonitorAtualizacao[];
};

const TTL_OPERACAO_MS = 60 * 60 * 1000; // 1h
const PARALELISMO_MAX = 3;

const operacoes = new Map<string, EntradaOperacao>();

function limparExpiradas(): void {
  const agora = Date.now();
  for (const [id, op] of operacoes) {
    if (op.expiraEm < agora) operacoes.delete(id);
  }
}

/**
 * Inicia operação "atualizar todos". Retorna operacaoId imediatamente
 * e processa em background.
 *
 * Filtro `monitoramentoIds`: quando fornecido, processa só esses ids.
 * Útil pra "atualizar selecionados" no futuro.
 */
export async function iniciarAtualizacaoTodos(
  userId: number,
  escritorioId: number,
  filtro?: { monitoramentoIds?: number[] },
): Promise<{ operacaoId: string; total: number }> {
  limparExpiradas();

  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  // Busca monitoramentos do escritório — todos os tipos
  // (movimentacoes + novas_acoes). User pode ter restringido por id.
  //
  // Quando `monitoramentoIds` está presente, o user escolheu o subset
  // explicitamente — não filtra por status="ativo" (senão pausados/erro
  // são silenciosamente pulados e o user vê "1 atualizou" quando pediu
  // pra atualizar N). Quando não há filtro, mantém só ativos pra evitar
  // varrer monitoramentos desligados num "atualizar tudo" global.
  const conds = [eq(motorMonitoramentos.escritorioId, escritorioId)];
  if (filtro?.monitoramentoIds && filtro.monitoramentoIds.length > 0) {
    conds.push(inArray(motorMonitoramentos.id, filtro.monitoramentoIds));
  } else {
    conds.push(eq(motorMonitoramentos.status, "ativo"));
  }

  const monitoramentos = await db
    .select()
    .from(motorMonitoramentos)
    .where(and(...conds));

  if (monitoramentos.length === 0) {
    throw new Error("Nenhum monitoramento pra atualizar");
  }

  const operacaoId = `atualiz:${randomUUID()}`;
  const agora = Date.now();

  const entrada: EntradaOperacao = {
    id: operacaoId,
    userId,
    escritorioId,
    status: "rodando",
    iniciadoEm: agora,
    expiraEm: agora + TTL_OPERACAO_MS,
    total: monitoramentos.length,
    processados: 0,
    ok: 0,
    erro: 0,
    detectadasTotal: 0,
    monitores: monitoramentos.map((m) => ({
      monitoramentoId: m.id,
      apelido: m.apelido,
      tipo: m.tipoMonitoramento as "movimentacoes" | "novas_acoes",
      status: "pendente",
    })),
  };

  operacoes.set(operacaoId, entrada);
  log.info(
    { operacaoId, userId, escritorioId, total: monitoramentos.length },
    "[atualizacao-runner] operação iniciada",
  );

  void executarAtualizacao(operacaoId, monitoramentos);

  return { operacaoId, total: monitoramentos.length };
}

async function executarAtualizacao(
  operacaoId: string,
  monitoramentos: (typeof motorMonitoramentos.$inferSelect)[],
): Promise<void> {
  const op = operacoes.get(operacaoId);
  if (!op) return;

  // Limit 3 paralelos via batches. Mais sofisticado seria pool com
  // queue, mas pra ~20-50 monitoramentos batch fica simples e suficiente.
  for (let i = 0; i < monitoramentos.length; i += PARALELISMO_MAX) {
    const batch = monitoramentos.slice(i, i + PARALELISMO_MAX);
    await Promise.all(
      batch.map(async (mon) => {
        const entradaMon = op.monitores.find((m) => m.monitoramentoId === mon.id);
        if (!entradaMon) return;
        entradaMon.status = "rodando";
        entradaMon.inicioEm = Date.now();
        emitirProgresso(op);

        try {
          const r =
            mon.tipoMonitoramento === "novas_acoes"
              ? await pollarUmMonitoramentoNovasAcoes(mon)
              : await pollarUmMonitoramentoMovs(mon);

          entradaMon.status = r.ok ? "ok" : "erro";
          entradaMon.detectadas = r.detectadas;
          entradaMon.baseline = r.baseline;
          entradaMon.erro = r.erro;
          entradaMon.fimEm = Date.now();

          if (r.ok) op.ok++;
          else op.erro++;
          op.detectadasTotal += r.detectadas;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          entradaMon.status = "erro";
          entradaMon.erro = msg.slice(0, 200);
          entradaMon.fimEm = Date.now();
          op.erro++;
          log.error({ operacaoId, monId: mon.id, err: msg }, "[atualizacao-runner] poll crashed");
        }
        op.processados++;
        emitirProgresso(op);
      }),
    );
  }

  op.status = "concluido";
  op.finalizadoEm = Date.now();
  emitirProgresso(op);
  log.info(
    {
      operacaoId,
      total: op.total,
      ok: op.ok,
      erro: op.erro,
      detectadas: op.detectadasTotal,
      duracaoMs: op.finalizadoEm - op.iniciadoEm,
    },
    "[atualizacao-runner] operação concluída",
  );
}

function emitirProgresso(op: EntradaOperacao): void {
  emitirNotificacao(op.userId, {
    tipo: "info",
    titulo: `Atualizando ${op.processados}/${op.total}`,
    mensagem:
      op.status === "concluido"
        ? `Concluído: ${op.ok} ok, ${op.erro} erro, ${op.detectadasTotal} novidades`
        : `${op.ok} ok, ${op.erro} erro até agora`,
    dados: {
      kind: "atualizacao_progresso",
      operacaoId: op.id,
      total: op.total,
      processados: op.processados,
      ok: op.ok,
      erro: op.erro,
      detectadasTotal: op.detectadasTotal,
      status: op.status,
    },
  });
}

export function obterProgressoAtualizacao(
  operacaoId: string,
  userId: number,
): EntradaOperacao | null {
  limparExpiradas();
  const op = operacoes.get(operacaoId);
  if (!op) return null;
  // Só o user que iniciou pode ver
  if (op.userId !== userId) return null;
  return op;
}

/**
 * Lista operações pendentes do usuário. Usado pelo frontend pra retomar
 * exibição quando user volta pra página de Processos.
 */
export function listarOperacoesPendentes(userId: number): EntradaOperacao[] {
  limparExpiradas();
  const lista: EntradaOperacao[] = [];
  for (const op of operacoes.values()) {
    if (op.userId === userId && op.status === "rodando") {
      lista.push(op);
    }
  }
  return lista;
}
