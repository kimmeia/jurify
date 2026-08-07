/**
 * Cliente da API Pública do DataJud (CNJ).
 *
 * A varredura PAGINA O ÍNDICE do tribunal em vez de gerar número CNJ e testar
 * se existe. O espaço de numeração é enorme e quase toda tentativa seria
 * desperdiçada; paginar percorre só o que existe, em ordens de magnitude menos
 * requisições.
 *
 * A chave da API Pública é publicada pelo próprio CNJ e é a mesma para todos
 * os consumidores — não é credencial de ninguém. Por isso ela vem embutida:
 * exigir cadastro de um segredo que não é segredo só transformava o módulo em
 * tela de erro no primeiro uso.
 *
 * A ordem de precedência existe pra o dia em que o CNJ rotacionar a chave:
 * `admin_integracoes` (provedor "datajud") vence, depois `DATAJUD_API_KEY`,
 * depois a pública. Assim dá pra consertar sem esperar deploy.
 */

import { createLogger } from "../_core/logger";

const log = createLogger("datajud");

const BASE = "https://api-publica.datajud.cnj.jus.br";

/** Chave pública documentada em datajud-wiki.cnj.jus.br/api-publica/acesso. */
const CHAVE_PUBLICA_CNJ =
  "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

export interface PaginaDataJud {
  hits: unknown[];
  /** `search_after` da próxima página. null = acabou. */
  proximoCursor: string | null;
  /** Total estimado no índice, quando o ES devolve. */
  total: number | null;
}

/**
 * Decide o cursor da próxima página a partir da resposta.
 *
 * Separado da chamada HTTP porque é a parte que erra: cursor errado faz a
 * varredura repetir a mesma página pra sempre ou pular metade do tribunal, e
 * nenhum dos dois dá erro visível.
 */
export function proximaPagina(resposta: unknown, tamanhoPedido: number): PaginaDataJud {
  const r: any = resposta;
  const hits: unknown[] = Array.isArray(r?.hits?.hits) ? r.hits.hits : [];

  const totalCru = r?.hits?.total;
  const total = typeof totalCru === "number"
    ? totalCru
    : typeof totalCru?.value === "number"
      ? totalCru.value
      : null;

  // Página incompleta significa fim do índice — pedir a próxima só gastaria
  // requisição pra receber vazio.
  if (hits.length === 0 || hits.length < tamanhoPedido) {
    return { hits, proximoCursor: null, total };
  }

  const ultimo: any = hits[hits.length - 1];
  const sort = ultimo?.sort;
  if (!Array.isArray(sort) || sort.length === 0) {
    // Sem `sort` não dá pra continuar com segurança: seguir sem cursor
    // relê a primeira página em loop.
    return { hits, proximoCursor: null, total };
  }

  return { hits, proximoCursor: JSON.stringify(sort), total };
}

async function chaveCadastrada(): Promise<string | null> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) return null;
  const { adminIntegracoes } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const [reg] = await db
    .select()
    .from(adminIntegracoes)
    .where(eq(adminIntegracoes.provedor, "datajud"))
    .limit(1);
  if (!reg?.apiKeyEncrypted || !reg.apiKeyIv || !reg.apiKeyTag) return null;
  try {
    const { decrypt } = await import("../escritorio/crypto-utils");
    return decrypt(reg.apiKeyEncrypted, reg.apiKeyIv, reg.apiKeyTag);
  } catch (e) {
    // Chave cadastrada mas ilegível não pode derrubar o módulo em silêncio:
    // cai pra pública e o warn conta o que houve.
    log.warn({ e: String(e) }, "falha ao decriptar chave do DataJud — usando a pública");
    return null;
  }
}

export async function chaveDataJud(): Promise<string> {
  return (await chaveCadastrada()) || process.env.DATAJUD_API_KEY?.trim() || CHAVE_PUBLICA_CNJ;
}

/**
 * Uma página do índice de um tribunal.
 *
 * `alias` é o identificador do tribunal na API (ex.: "tjce", "trt7") — o mesmo
 * que `tribunal-providers.ts` já mapeia por tribunal.
 */
export async function buscarPagina(args: {
  alias: string;
  cursor: string | null;
  tamanho?: number;
  timeoutMs?: number;
}): Promise<PaginaDataJud> {
  const chave = await chaveDataJud();

  const tamanho = Math.min(Math.max(args.tamanho ?? 100, 1), 1000);
  const corpo: Record<string, unknown> = {
    size: tamanho,
    // Ordenação estável é o que torna o `search_after` confiável: sem um
    // desempate único, dois processos com a mesma data podem se revezar entre
    // páginas e um deles nunca aparecer.
    sort: [{ "@timestamp": { order: "asc" } }, { _id: "asc" }],
    query: { match_all: {} },
  };
  if (args.cursor) {
    try {
      corpo.search_after = JSON.parse(args.cursor);
    } catch {
      throw new Error("Cursor da varredura corrompido — reinicie o tribunal.");
    }
  }

  const res = await fetch(`${BASE}/api_publica_${args.alias}/_search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `APIKey ${chave}`,
    },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`DataJud ${res.status}: ${t.slice(0, 200)}`);
  }

  return proximaPagina(await res.json(), tamanho);
}
