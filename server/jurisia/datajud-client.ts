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
type FormaValor = "numero" | "texto";

const ORDENACOES: Array<{ nome: string; spec: unknown[]; forma: FormaValor[] }> = [
  {
    nome: "@timestamp+numeroProcesso",
    spec: [{ "@timestamp": { order: "asc" } }, { numeroProcesso: { order: "asc" } }],
    forma: ["numero", "texto"],
  },
  { nome: "@timestamp", spec: [{ "@timestamp": { order: "asc" } }], forma: ["numero"] },
  { nome: "numeroProcesso", spec: [{ numeroProcesso: { order: "asc" } }], forma: ["texto"] },
];

/**
 * O cursor guarda QUAL ordenação o produziu.
 *
 * Antes ele era só o array de `search_after`, e a ordenação em uso vivia numa
 * variável de processo. Bastava um redeploy: a variável zerava, a varredura
 * recomeçava pela primeira ordenação da lista e o cursor gravado sob outra não
 * batia mais — a fila do STJ travou assim, repetindo "reinicie o tribunal" a
 * cada ciclo sem nunca avançar. Cursor que se descreve não depende de memória
 * de processo nenhuma.
 */
interface CursorVarredura {
  ordenacao: string;
  valores: unknown[];
}

function serializarCursor(c: CursorVarredura): string {
  return JSON.stringify({ o: c.ordenacao, v: c.valores });
}

const formaDe = (v: unknown): FormaValor | null =>
  typeof v === "number" ? "numero" : typeof v === "string" ? "texto" : null;

/**
 * Deduz a ordenação de um cursor no formato antigo (array puro).
 *
 * O formato dos valores basta: `@timestamp` ordena por epoch (número) e
 * `numeroProcesso` por string. Não é adivinhação — é a assinatura do próprio
 * `search_after`. Sem casar nenhuma, devolve null e quem chama decide.
 */
export function ordenacaoDoCursorLegado(valores: unknown[]): string | null {
  const forma = valores.map(formaDe);
  if (forma.some((f) => f === null)) return null;
  const alvo = ORDENACOES.find(
    (o) => o.forma.length === forma.length && o.forma.every((f, i) => f === forma[i]),
  );
  return alvo?.nome ?? null;
}

/** Aceita os dois formatos. Cursor ilegível vira erro; cursor de ordenação
 *  desconhecida vira null, que o chamador trata recomeçando o tribunal. */
export function lerCursor(bruto: string): CursorVarredura | null {
  let c: any;
  try {
    c = JSON.parse(bruto);
  } catch {
    throw new Error("Cursor da varredura corrompido — reinicie o tribunal.");
  }

  if (Array.isArray(c)) {
    if (c.length === 0) throw new Error("Cursor da varredura corrompido — reinicie o tribunal.");
    const ordenacao = ordenacaoDoCursorLegado(c);
    return ordenacao ? { ordenacao, valores: c } : null;
  }

  if (c && typeof c === "object" && typeof c.o === "string" && Array.isArray(c.v)) {
    return ORDENACOES.some((o) => o.nome === c.o) ? { ordenacao: c.o, valores: c.v } : null;
  }

  throw new Error("Cursor da varredura corrompido — reinicie o tribunal.");
}

/**
 * Ordenação que já deu certo, POR TRIBUNAL — evita pagar a tentativa toda
 * página. Um cache só pra todos fazia o resultado de um índice decidir por
 * qual ordenação outro começava, e o mapeamento varia entre os 90+ índices.
 */
const ordenacaoResolvida = new Map<string, number>();

/** Só pra teste: desfaz o cache entre casos. */
export function esquecerOrdenacaoDataJud() {
  ordenacaoResolvida.clear();
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
  /** Total no índice, quando o ES devolve. */
  total: number | null;
  /**
   * true quando o ES parou de contar e o índice tem MAIS que `total`.
   *
   * O Elasticsearch capa a contagem em 10.000 por padrão e avisa disso em
   * `hits.total.relation = "gte"`. Ignorar esse campo faz um tribunal com
   * milhões de processos aparecer como "10.000" no painel — e a varredura
   * parecer quase pronta quando mal começou.
   */
  totalEhMinimo: boolean;
}

/**
 * Decide o cursor da próxima página a partir da resposta.
 *
 * Separado da chamada HTTP porque é a parte que erra: cursor errado faz a
 * varredura repetir a mesma página pra sempre ou pular metade do tribunal, e
 * nenhum dos dois dá erro visível.
 */
export function proximaPagina(
  resposta: unknown,
  tamanhoPedido: number,
  ordenacao: string,
): PaginaDataJud {
  const r: any = resposta;
  const hits: unknown[] = Array.isArray(r?.hits?.hits) ? r.hits.hits : [];

  const totalCru = r?.hits?.total;
  const total = typeof totalCru === "number"
    ? totalCru
    : typeof totalCru?.value === "number"
      ? totalCru.value
      : null;
  const totalEhMinimo = totalCru?.relation === "gte";

  // Página incompleta significa fim do índice — pedir a próxima só gastaria
  // requisição pra receber vazio.
  if (hits.length === 0 || hits.length < tamanhoPedido) {
    return { hits, proximoCursor: null, total, totalEhMinimo };
  }

  const ultimo: any = hits[hits.length - 1];
  const sort = ultimo?.sort;
  if (!Array.isArray(sort) || sort.length === 0) {
    // Sem `sort` não dá pra continuar com segurança: seguir sem cursor
    // relê a primeira página em loop.
    return { hits, proximoCursor: null, total, totalEhMinimo };
  }

  return {
    hits,
    proximoCursor: serializarCursor({ ordenacao, valores: sort }),
    total,
    totalEhMinimo,
  };
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

  const cursor = args.cursor ? lerCursor(args.cursor) : null;

  // Cursor de ordenação que não existe mais: recomeçar do zero é seguro
  // (a gravação é upsert, nada duplica) e é infinitamente melhor que travar a
  // fila pedindo intervenção manual que ninguém vê.
  if (args.cursor && !cursor) {
    log.warn(
      { alias: args.alias },
      "cursor de ordenação desconhecida — recomeçando o tribunal do início",
    );
  }

  // Com cursor, a ordenação é a dele: começar por outra pularia metade do
  // tribunal em silêncio.
  const inicio = cursor
    ? ORDENACOES.findIndex((o) => o.nome === cursor.ordenacao)
    : (ordenacaoResolvida.get(args.alias) ?? 0);

  let ultimoErro = "";
  for (let i = Math.max(0, inicio); i < ORDENACOES.length; i++) {
    const ordenacao = ORDENACOES[i];

    const corpo: Record<string, unknown> = {
      size: tamanho,
      sort: ordenacao.spec,
      query: { match_all: {} },
    };
    if (cursor) corpo.search_after = cursor.valores;

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
      if (ordenacaoResolvida.get(args.alias) !== i) {
        ordenacaoResolvida.set(args.alias, i);
        log.info({ ordenacao: ordenacao.nome, alias: args.alias }, "ordenação do DataJud definida");
      }
      return proximaPagina(await res.json(), tamanho, ordenacao.nome);
    }

    const texto = await res.text();
    ultimoErro = `DataJud ${res.status}: ${texto.slice(0, 200)}`;
    if (!ehErroDeOrdenacao(res.status, texto)) throw new Error(ultimoErro);

    // Degradar pra próxima ordenação com um cursor em mãos trocaria o eixo do
    // `search_after` no meio da varredura — daí em diante o tribunal seria
    // percorrido por outro critério e os processos entre os dois pontos
    // sumiriam sem erro nenhum.
    if (cursor) {
      throw new Error(
        `O índice recusou a ordenação "${ordenacao.nome}", que produziu o cursor gravado — reinicie o tribunal. ${ultimoErro}`,
      );
    }

    log.warn(
      { ordenacao: ordenacao.nome, alias: args.alias, erro: texto.slice(0, 120) },
      "ordenação recusada pelo índice — tentando a próxima",
    );
  }

  throw new Error(`Nenhuma ordenação aceita pelo índice. Último erro: ${ultimoErro}`);
}
