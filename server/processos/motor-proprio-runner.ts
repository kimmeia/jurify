/**
 * Orquestrador do motor próprio em produção.
 *
 * Recebe pedidos via `consultarCNJ` (router-processos), executa
 * o adapter PJe TJCE em background, cacheia o resultado e expõe
 * shape `ResultadoScraper` direto pro frontend.
 *
 * Cache: memória do processo (TTL 30min). Sprint 2+ pode mover pra Redis.
 */

import { randomUUID } from "node:crypto";
import { consultarTjce } from "./adapters/pje-tjce";
import { parseCnjTribunal } from "./cnj-parser";
import type { ResultadoScraper } from "../../scripts/spike-motor-proprio/lib/types-spike";
import { createLogger } from "../_core/logger";

const log = createLogger("motor-proprio-runner");

export type StatusMotorProprio = "running" | "completed" | "error";

type EntradaCache = {
  status: StatusMotorProprio;
  resultado: ResultadoScraper | null;
  cnj: string;
  criadoEm: number;
  expiraEm: number;
};

const PREFIXO_REQUEST_ID = "motor:";
const TTL_CACHE_MS = 30 * 60 * 1000; // 30min

const cache = new Map<string, EntradaCache>();

function limparExpirados(): void {
  const agora = Date.now();
  for (const [requestId, entrada] of cache) {
    if (entrada.expiraEm < agora) cache.delete(requestId);
  }
}

export function ehRequestMotorProprio(requestId: string): boolean {
  return requestId.startsWith(PREFIXO_REQUEST_ID);
}

export function iniciarConsultaMotorProprio(
  cnj: string,
  storageStateJson: string,
): { requestId: string; status: StatusMotorProprio } {
  limparExpirados();

  const tribunal = parseCnjTribunal(cnj);
  if (!tribunal?.temMotorProprio) {
    throw new Error(
      `Motor próprio não disponível pra ${tribunal?.siglaTribunal ?? "tribunal desconhecido"}`,
    );
  }

  const requestId = `${PREFIXO_REQUEST_ID}${tribunal.codigoTribunal}:${randomUUID()}`;
  const inicio = Date.now();

  cache.set(requestId, {
    status: "running",
    resultado: null,
    cnj,
    criadoEm: inicio,
    expiraEm: inicio + TTL_CACHE_MS,
  });

  void executarConsulta(requestId, cnj, storageStateJson, tribunal.codigoTribunal);

  return { requestId, status: "running" };
}

async function executarConsulta(
  requestId: string,
  cnj: string,
  storageStateJson: string,
  codigoTribunal: string,
): Promise<void> {
  try {
    let resultado: ResultadoScraper;
    if (codigoTribunal === "tjce") {
      resultado = await consultarTjce(cnj, storageStateJson);
    } else {
      throw new Error(`Adapter motor próprio pra ${codigoTribunal} não implementado`);
    }

    log.info(
      {
        cnj,
        codigoTribunal,
        ok: resultado.ok,
        valorCents: resultado.capa?.valorCausaCentavos ?? null,
        dataDistribuicao: resultado.capa?.dataDistribuicao ?? null,
        movsCount: resultado.movimentacoes.length,
        latenciaMs: resultado.latenciaMs,
      },
      "[motor-proprio-runner] consulta finalizada",
    );

    cache.set(requestId, {
      ...(cache.get(requestId) as EntradaCache),
      status: resultado.ok ? "completed" : "error",
      resultado,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ cnj, codigoTribunal, err: msg }, "[motor-proprio-runner] consulta falhou");
    cache.set(requestId, {
      ...(cache.get(requestId) as EntradaCache),
      status: "error",
      resultado: {
        ok: false,
        tribunal: codigoTribunal,
        cnj,
        latenciaMs: 0,
        capa: null,
        movimentacoes: [],
        categoriaErro: "outro",
        mensagemErro: msg,
        screenshotPath: null,
        finalizadoEm: new Date().toISOString(),
      },
    });
  }
}

export function obterStatusMotorProprio(requestId: string): {
  status: StatusMotorProprio;
  requestId: string;
  updatedAt: string;
} | null {
  limparExpirados();
  const entrada = cache.get(requestId);
  if (!entrada) return null;
  return {
    status: entrada.status,
    requestId,
    updatedAt: new Date(entrada.criadoEm).toISOString(),
  };
}

/**
 * Retorna o `ResultadoScraper` cacheado (frontend renderiza direto,
 * sem bridge intermediário).
 */
export function obterResultadoMotorProprio(
  requestId: string,
): ResultadoScraper | null {
  limparExpirados();
  const entrada = cache.get(requestId);
  if (!entrada) return null;
  if (entrada.status === "running") {
    return null; // caller trata como "ainda processando"
  }
  return entrada.resultado;
}
