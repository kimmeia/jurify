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
 * Retorna resultado em formato compatível com `JuditResponsesPage` que
 * o frontend espera. Adapta `ResultadoScraper` → `page_data` shape com
 * um único `response_data` no formato JuditLawsuit-like.
 *
 * Mantém compat com frontend ate refator profundo de Processos.tsx
 * (Sprint 2). amount já vem em REAIS (não cents) pra `formatBRL` no
 * frontend exibir corretamente.
 */
export function obterResultadoMotorProprio(requestId: string): {
  request_status: string;
  page: number;
  page_count: number;
  all_pages_count: number;
  all_count: number;
  page_data: Array<{
    request_id: string;
    response_id: string;
    response_type: string;
    response_data: unknown;
    user_id: string;
    created_at: string;
    tags: { source: string };
  }>;
} | null {
  limparExpirados();
  const entrada = cache.get(requestId);
  if (!entrada) return null;

  if (entrada.status === "running") {
    return {
      request_status: "pending",
      page: 1,
      page_count: 0,
      all_pages_count: 0,
      all_count: 0,
      page_data: [],
    };
  }

  const r = entrada.resultado;
  if (!r) {
    return {
      request_status: "completed",
      page: 1,
      page_count: 0,
      all_pages_count: 0,
      all_count: 0,
      page_data: [],
    };
  }

  // Se erro, retorna application_error
  if (!r.ok) {
    return {
      request_status: "completed",
      page: 1,
      page_count: 1,
      all_pages_count: 1,
      all_count: 1,
      page_data: [
        {
          request_id: requestId,
          response_id: `${requestId}:err`,
          response_type: "application_error",
          response_data: {
            message: r.mensagemErro ?? "Erro desconhecido",
            code: r.categoriaErro ?? "outro",
          },
          user_id: "motor-proprio",
          created_at: new Date(entrada.criadoEm).toISOString(),
          tags: { source: "motor-proprio" },
        },
      ],
    };
  }

  // Sucesso: bridge ResultadoScraper → JuditLawsuit shape
  const capa = r.capa;
  const lawsuit = capa
    ? {
        code: capa.cnj,
        instance: 1,
        name: capa.classe ?? capa.cnj,
        tribunal_acronym: r.tribunal.toUpperCase(),
        county: capa.comarca ?? "",
        city: capa.comarca ?? "",
        state: capa.uf ?? "",
        distribution_date: capa.dataDistribuicao ?? "",
        status: capa.status ?? undefined,
        judge: capa.juiz ?? undefined,
        // amount em REAIS (não cents) pra frontend formatBRL exibir
        // corretamente: valorCausaCentavos=5449470 → amount=54494.70
        amount: capa.valorCausaCentavos != null
          ? capa.valorCausaCentavos / 100
          : undefined,
        last_step: r.movimentacoes[0]
          ? {
              step_id: `motor:${r.movimentacoes[0].data}`,
              step_date: r.movimentacoes[0].data,
              content: r.movimentacoes[0].texto,
              steps_count: r.movimentacoes.length,
            }
          : undefined,
        subjects: capa.assuntos.map((a, idx) => ({
          code: `motor-${idx}`,
          name: a,
        })),
        classifications: capa.classe
          ? [{ code: "main", name: capa.classe }]
          : [],
        parties: capa.partes.map((p) => ({
          name: p.nome,
          side: (p.polo === "passivo" ? "Passive" : "Active") as
            | "Active"
            | "Passive",
          person_type:
            p.tipo === "juridica"
              ? "Legal Entity"
              : p.tipo === "fisica"
                ? "Natural Person"
                : "Unknown",
          main_document: p.documento ?? undefined,
          lawyers: p.advogados.map((a) => ({
            name: a.nome,
            main_document: a.oab ?? undefined,
          })),
        })),
        steps: r.movimentacoes.map((m) => ({
          step_id: `motor:${m.data}:${m.texto.slice(0, 16)}`,
          step_date: m.data,
          content: m.texto,
          step_type: m.tipo ?? undefined,
        })),
      }
    : null;

  return {
    request_status: "completed",
    page: 1,
    page_count: 1,
    all_pages_count: 1,
    all_count: 1,
    page_data: [
      {
        request_id: requestId,
        response_id: `${requestId}:ok`,
        response_type: "lawsuit",
        response_data: lawsuit,
        user_id: "motor-proprio",
        created_at: new Date(entrada.criadoEm).toISOString(),
        tags: { source: "motor-proprio" },
      },
    ],
  };
}
