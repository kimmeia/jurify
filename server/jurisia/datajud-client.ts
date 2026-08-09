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

/**
 * Ordenações candidatas, da mais correta pra mais tolerante.
 *
 * `search_after` só é confiável com ordenação ESTÁVEL: sem um desempate único,
 * dois processos com o mesmo instante podem se revezar entre páginas e um
 * deles nunca aparecer. O desempate óbvio seria `_id`, mas o Elasticsearch
 * proíbe ordenar por ele (fielddata no `_id` é desabilitado por padrão, e o
 * cluster do CNJ não vai reabilitar) — foi assim que a primeira varredura
 * morreu com 400.
 *
 * `numeroProcesso` é o desempate certo quando mapeado como keyword. Como o
 * mapeamento varia entre os 90+ índices e daqui não dá pra provar, a lista é
 * tentada em ordem e a que funcionar fica cacheada pro resto do processo.
 */
const ORDENACOES: Array<{ nome: string; spec: unknown[] }> = [
  {
    nome: "@timestamp+numeroProcesso",
    spec: [{ "@timestamp": { order: "asc" } }, { numeroProcesso: { order: "asc" } }],
  },
  { nome: "@timestamp", spec: [{ "@timestamp": { order: "asc" } }] },
  { nome: "numeroProcesso", spec: [{ numeroProcesso: { order: "asc" } }] },
];

/** Índice da ordenação que já deu certo — evita pagar a tentativa toda página. */
let ordenacaoResolvida: number | null = null;

/** Só pra teste: desfaz o cache entre casos. */
export function esquecerOrdenacaoDataJud() {
  ordenacaoResolvida = null;
}

/**
 * Erro de ordenação é o único que vale tentar de novo com outra spec. Erro de
 * chave, de índice inexistente ou de rate limit não melhora trocando o sort —
 * repetir só gastaria requisição no tribunal.
 */
export function ehErroDeOrdenacao(status: number, corpo: string): boolean {
  if (status !== 400) return false;
  const t = corpo.toLowerCase();
  return (
    t.includes("fielddata") ||
    t.includes("no mapping found") ||
    t.includes("illegal_argument_exception") ||
    t.includes("sort")
  );
}

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

  let cursorDecodificado: unknown[] | null = null;
  if (args.cursor) {
    try {
      const c = JSON.parse(args.cursor);
      if (!Array.isArray(c)) throw new Error("cursor não é array");
      cursorDecodificado = c;
    } catch {
      throw new Error("Cursor da varredura corrompido — reinicie o tribunal.");
    }
  }

  let ultimoErro = "";
  for (let i = ordenacaoResolvida ?? 0; i < ORDENACOES.length; i++) {
    const ordenacao = ORDENACOES[i];

    // Cursor gravado sob outra ordenação tem outro formato de `search_after`;
    // seguir com ele pularia metade do tribunal em silêncio.
    if (cursorDecodificado && cursorDecodificado.length !== ordenacao.spec.length) {
      throw new Error(
        "A ordenação da varredura mudou e o cursor gravado não serve mais — reinicie o tribunal.",
      );
    }

    const corpo: Record<string, unknown> = {
      size: tamanho,
      sort: ordenacao.spec,
      query: { match_all: {} },
    };
    if (cursorDecodificado) corpo.search_after = cursorDecodificado;

    const res = await fetch(`${BASE}/api_publica_${args.alias}/_search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `APIKey ${chave}`,
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
    });

    if (res.ok) {
      if (ordenacaoResolvida !== i) {
        ordenacaoResolvida = i;
        log.info({ ordenacao: ordenacao.nome, alias: args.alias }, "ordenação do DataJud definida");
      }
      return proximaPagina(await res.json(), tamanho);
    }

    const texto = await res.text();
    ultimoErro = `DataJud ${res.status}: ${texto.slice(0, 200)}`;
    if (!ehErroDeOrdenacao(res.status, texto)) throw new Error(ultimoErro);

    log.warn(
      { ordenacao: ordenacao.nome, alias: args.alias, erro: texto.slice(0, 120) },
      "ordenação recusada pelo índice — tentando a próxima",
    );
  }

  throw new Error(`Nenhuma ordenação aceita pelo índice. Último erro: ${ultimoErro}`);
}
