/**
 * Orquestrador do motor próprio em produção.
 *
 * Recebe pedidos via `consultarCNJ` (router-judit-processos), executa
 * o adapter PJe TJCE em background, cacheia o resultado e expõe shape
 * compatível com flow Judit (request → status → resultados).
 *
 * Decisão arquitetural: NÃO mudamos o frontend. Quando consultarCNJ
 * detecta tribunal coberto pelo motor (TJCE 1º grau), redireciona pra
 * cá; o resto continua via Judit. UI nem percebe.
 *
 * Cache: memória do processo. Suficiente pra MVP (consultas levam
 * 5-15s; cliente busca resultado segundos depois). Sprint 2+ pode
 * mover pra Redis.
 *
 * Pricing: cobrança feita pelo caller via `consumirCreditos()` (igual
 * Judit). Motor próprio fica com 100% da margem (sem custo externo).
 */

import { randomUUID } from "node:crypto";
import { consultarTjce } from "./adapters/pje-tjce";
import { resultadoScraperParaJuditLawsuit } from "./motor-bridge";
import { parseCnjTribunal } from "./cnj-parser";
import type { JuditLawsuit } from "../integracoes/judit-client";
import { createLogger } from "../_core/logger";

const log = createLogger("motor-proprio-runner");

export type StatusMotorProprio = "running" | "completed" | "error";

type EntradaCache = {
  status: StatusMotorProprio;
  /** JuditLawsuit pronto pra UI (resultado bem-sucedido) */
  juditLawsuit: JuditLawsuit | null;
  /** Mensagem de erro (quando status === "error") */
  erroMensagem: string | null;
  /** Categoria do erro (sessao_expirada, parse_falhou, etc) */
  erroCategoria: string | null;
  /** Latência da operação em ms */
  latenciaMs: number;
  /** CNJ original consultado */
  cnj: string;
  /** Quando foi criado (ms epoch) */
  criadoEm: number;
  /** Quando expira do cache (ms epoch) */
  expiraEm: number;
};

const PREFIXO_REQUEST_ID = "motor:";
const TTL_CACHE_MS = 30 * 60 * 1000; // 30min

const cache = new Map<string, EntradaCache>();

/** Limpa entradas vencidas a cada chamada (lazy GC). */
function limparExpirados(): void {
  const agora = Date.now();
  for (const [requestId, entrada] of cache) {
    if (entrada.expiraEm < agora) cache.delete(requestId);
  }
}

/** Verifica se um requestId pertence ao motor próprio. */
export function ehRequestMotorProprio(requestId: string): boolean {
  return requestId.startsWith(PREFIXO_REQUEST_ID);
}

/**
 * Inicia consulta no motor próprio. Roda em background; status fica
 * "running" até completar.
 *
 * @param cnj CNJ a consultar
 * @param storageStateJson Sessão Playwright pré-criada (do cofre)
 * @returns requestId fake (compatível com Judit)
 */
export function iniciarConsultaMotorProprio(
  cnj: string,
  storageStateJson: string,
): { requestId: string; status: StatusMotorProprio } {
  limparExpirados();

  const tribunal = parseCnjTribunal(cnj);
  if (!tribunal?.temMotorProprio) {
    throw new Error(
      `Motor próprio não disponível pra ${tribunal?.siglaTribunal ?? "tribunal desconhecido"} no CNJ ${cnj}`,
    );
  }

  const requestId = `${PREFIXO_REQUEST_ID}${tribunal.codigoTribunal}:${randomUUID()}`;
  const inicio = Date.now();

  cache.set(requestId, {
    status: "running",
    juditLawsuit: null,
    erroMensagem: null,
    erroCategoria: null,
    latenciaMs: 0,
    cnj,
    criadoEm: inicio,
    expiraEm: inicio + TTL_CACHE_MS,
  });

  // Executa em background — não aguarda
  void executarConsulta(requestId, cnj, storageStateJson, tribunal.codigoTribunal);

  return { requestId, status: "running" };
}

async function executarConsulta(
  requestId: string,
  cnj: string,
  storageStateJson: string,
  codigoTribunal: string,
): Promise<void> {
  const inicio = Date.now();
  try {
    let resultado;
    if (codigoTribunal === "tjce") {
      resultado = await consultarTjce(cnj, storageStateJson);
    } else {
      throw new Error(
        `Adapter motor próprio pra ${codigoTribunal} não implementado`,
      );
    }

    // Log estruturado do raw value extraído — ajuda calibrar parser
    // quando valor sai 100x off (PJe TJCE expõe sem máscara em alguns
    // lugares). console.warn em background não chega no Railway, mas
    // log.warn (pino) chega.
    const valorRaw = (globalThis as { __pjeTjceValorRaw?: string | null })
      .__pjeTjceValorRaw;
    log.warn(
      {
        cnj,
        codigoTribunal,
        valorRaw,
        valorCents: resultado.capa?.valorCausaCentavos ?? null,
        dataDistribuicao: resultado.capa?.dataDistribuicao ?? null,
        movsCount: resultado.movimentacoes.length,
      },
      "[motor-proprio-runner] resultado consulta",
    );

    if (!resultado.ok) {
      cache.set(requestId, {
        ...(cache.get(requestId) as EntradaCache),
        status: "error",
        juditLawsuit: null,
        erroMensagem: resultado.mensagemErro ?? "Erro desconhecido",
        erroCategoria: resultado.categoriaErro ?? "outro",
        latenciaMs: Date.now() - inicio,
      });
      return;
    }

    const lawsuit = resultadoScraperParaJuditLawsuit(resultado);
    cache.set(requestId, {
      ...(cache.get(requestId) as EntradaCache),
      status: "completed",
      juditLawsuit: lawsuit,
      erroMensagem: null,
      erroCategoria: null,
      latenciaMs: Date.now() - inicio,
    });
  } catch (err) {
    cache.set(requestId, {
      ...(cache.get(requestId) as EntradaCache),
      status: "error",
      juditLawsuit: null,
      erroMensagem: err instanceof Error ? err.message : String(err),
      erroCategoria: "outro",
      latenciaMs: Date.now() - inicio,
    });
  }
}

/** Retorna status atual de um requestId (ou null se não encontrado/expirado). */
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
    updatedAt: new Date(entrada.criadoEm + entrada.latenciaMs).toISOString(),
  };
}

/**
 * Retorna resultado em formato Judit (page de respostas).
 *
 * Compatível com `client.buscarRespostas(requestId, page, pageSize)`.
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
    response_data: JuditLawsuit | { message: string; code?: string };
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

  if (entrada.status === "error" || !entrada.juditLawsuit) {
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
            message: entrada.erroMensagem ?? "Erro desconhecido",
            code: entrada.erroCategoria ?? "outro",
          },
          user_id: "motor-proprio",
          created_at: new Date(entrada.criadoEm).toISOString(),
          tags: { source: "motor-proprio" },
        },
      ],
    };
  }

  // Sucesso
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
        response_data: entrada.juditLawsuit,
        user_id: "motor-proprio",
        created_at: new Date(entrada.criadoEm).toISOString(),
        tags: { source: "motor-proprio" },
      },
    ],
  };
}
