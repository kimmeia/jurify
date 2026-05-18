/**
 * Importa um board do Trello (JSON exportado) pro Kanban do Jurify.
 *
 * Trello permite "Print and Export → Export as JSON" — o usuário cola
 * esse JSON aqui. Mapeamos:
 *
 *   board.name           → kanbanFunis.nome
 *   board.lists[]        → kanbanColunas (preservando ordem via .pos)
 *   board.cards[]        → kanbanCards (titulo, descricao, prazo, tags
 *                          via labels concatenadas, ordem via .pos)
 *
 * Membros/anexos/comentários NÃO são importados (não há mapeamento
 * confiável). Anexos podem ser linkados como texto no fim da descrição
 * — feature futura.
 *
 * Hard caps defensivos: 50 colunas, 1500 cards por board. Acima disso
 * lança erro pedindo pra dividir o board.
 *
 * Idempotência: NÃO há dedup automático — chamar 2x cria 2 funis novos.
 * É intencional: usuário pode querer importar o mesmo board várias vezes
 * (ex: snapshot do mês passado vs atual). Se quiser substituir, deleta
 * o funil antigo primeiro.
 *
 * Falha-segura: se a inserção quebrar no meio (ex: timeout no chunk dos
 * cards), o funil parcialmente criado é deletado em cascata (colunas +
 * cards) pra não ficar lixo. Usuário recebe erro e tenta de novo.
 */

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { kanbanCards, kanbanColunas, kanbanFunis, kanbanTags } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("kanban-import-trello");

const MAX_COLUNAS = 50;
const MAX_CARDS = 1500;
const CHUNK_INSERT_CARDS = 200;

/** Cor do Trello → hex usado pelo Jurify em kanbanTags.cor. Cobre variantes
 *  light/dark. Trello pode mandar null/undefined (label sem cor) → cinza. */
const COR_TRELLO_HEX: Record<string, string> = {
  red: "#ef4444",
  red_dark: "#b91c1c",
  red_light: "#fca5a5",
  orange: "#f97316",
  orange_dark: "#c2410c",
  orange_light: "#fdba74",
  yellow: "#eab308",
  yellow_dark: "#a16207",
  yellow_light: "#fde047",
  green: "#22c55e",
  green_dark: "#15803d",
  green_light: "#86efac",
  blue: "#3b82f6",
  blue_dark: "#1d4ed8",
  blue_light: "#93c5fd",
  purple: "#a855f7",
  purple_dark: "#7e22ce",
  purple_light: "#d8b4fe",
  pink: "#ec4899",
  pink_dark: "#be185d",
  pink_light: "#f9a8d4",
  sky: "#0ea5e9",
  sky_dark: "#0369a1",
  sky_light: "#7dd3fc",
  lime: "#84cc16",
  lime_dark: "#4d7c0f",
  lime_light: "#bef264",
  black: "#1f2937",
  black_dark: "#111827",
  black_light: "#9ca3af",
};
const COR_FALLBACK = "#6b7280";

/** Estrutura mínima do JSON do Trello que usamos. Outros campos são ignorados. */
interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
  pos: number;
}

interface TrelloLabel {
  id?: string;
  name?: string;
  color?: string;
}

interface TrelloCard {
  id: string;
  name: string;
  desc?: string | null;
  idList: string;
  pos: number;
  closed: boolean;
  due?: string | null;
  labels?: TrelloLabel[];
  /** Trello passou a aninhar atividades nesse campo em alguns exports. Ignorado. */
  badges?: unknown;
}

interface TrelloBoard {
  name: string;
  desc?: string | null;
  lists?: TrelloList[];
  cards?: TrelloCard[];
}

export interface OpcoesImportTrello {
  /** Pula listas/cards com closed=true. Default true (mais comum). */
  ignorarArchivados?: boolean;
}

export interface ResultadoImportTrello {
  funilId: number;
  funilNome: string;
  colunasCriadas: number;
  cardsCriados: number;
  cardsIgnorados: number;
  listasIgnoradas: number;
  /** Tags novas criadas no catálogo do escritório (kanbanTags). */
  tagsCriadas: number;
  /** Tags já existentes no catálogo que foram reusadas. */
  tagsReusadas: number;
}

/** Cores rotativas pras colunas (Trello listas não têm cor). */
const CORES_COLUNAS = [
  "#6b7280", // slate
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#22c55e", // emerald
  "#ec4899", // pink
  "#0ea5e9", // sky
  "#84cc16", // lime
];

/** Faz parse seguro do JSON e valida estrutura mínima. */
export function parseTrelloJson(raw: string): TrelloBoard {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("JSON inválido: não consegui interpretar.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("JSON inválido: esperava um objeto no topo.");
  }
  if (typeof parsed.name !== "string" || parsed.name.length === 0) {
    throw new Error("JSON inválido: campo 'name' do board ausente.");
  }
  return parsed as TrelloBoard;
}

/**
 * Prévia da importação sem efetuar — usado pra mostrar números na UI
 * antes do usuário confirmar.
 */
export function preverImportTrello(
  raw: string,
  opts: OpcoesImportTrello = {},
): {
  nome: string;
  colunas: number;
  cards: number;
  listasIgnoradas: number;
  cardsIgnorados: number;
  primeirasColunas: string[];
} {
  const board = parseTrelloJson(raw);
  const ignorar = opts.ignorarArchivados !== false;

  const listas = board.lists ?? [];
  const listasUsadas = ignorar ? listas.filter((l) => !l.closed) : listas;
  const idsListasUsadas = new Set(listasUsadas.map((l) => l.id));

  const cards = board.cards ?? [];
  const cardsUsados = cards.filter((c) => {
    if (ignorar && c.closed) return false;
    if (!idsListasUsadas.has(c.idList)) return false;
    if (!c.name || c.name.trim() === "") return false;
    return true;
  });

  return {
    nome: board.name,
    colunas: listasUsadas.length,
    cards: cardsUsados.length,
    listasIgnoradas: listas.length - listasUsadas.length,
    cardsIgnorados: cards.length - cardsUsados.length,
    primeirasColunas: listasUsadas
      .sort((a, b) => a.pos - b.pos)
      .slice(0, 5)
      .map((l) => l.name),
  };
}

function truncar(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const t = s.trim();
  if (t === "") return null;
  return t.length > max ? t.slice(0, max) : t;
}

export async function importarTrelloJson(
  escritorioId: number,
  userId: number,
  raw: string,
  opts: OpcoesImportTrello = {},
): Promise<ResultadoImportTrello> {
  const board = parseTrelloJson(raw);
  const ignorar = opts.ignorarArchivados !== false;

  const listas = board.lists ?? [];
  const listasUsadas = (ignorar ? listas.filter((l) => !l.closed) : listas)
    .slice() // não muta o array original
    .sort((a, b) => a.pos - b.pos);

  if (listasUsadas.length > MAX_COLUNAS) {
    throw new Error(
      `Board com ${listasUsadas.length} colunas excede o limite (${MAX_COLUNAS}). Divida o board no Trello.`,
    );
  }

  const idsListasUsadas = new Set(listasUsadas.map((l) => l.id));
  const cardsBrutos = board.cards ?? [];
  const cardsUsados = cardsBrutos.filter((c) => {
    if (ignorar && c.closed) return false;
    if (!idsListasUsadas.has(c.idList)) return false;
    if (!c.name || c.name.trim() === "") return false;
    return true;
  });

  if (cardsUsados.length > MAX_CARDS) {
    throw new Error(
      `Board com ${cardsUsados.length} cards excede o limite (${MAX_CARDS}). Divida o board no Trello.`,
    );
  }

  const db = await getDb();
  if (!db) throw new Error("DB indisponível.");

  // 1) Cria o funil.
  const tituloFunil = truncar(board.name, 128) ?? "Importado do Trello";
  const descFunil = truncar(board.desc ?? null, 512);
  const [r] = await db.insert(kanbanFunis).values({
    escritorioId,
    nome: tituloFunil,
    descricao: descFunil,
    cor: null,
    criadoPor: userId,
  });
  const funilId = (r as { insertId: number }).insertId;

  // Cleanup automático em caso de falha após criação do funil.
  const cleanup = async () => {
    try {
      const cols = await db
        .select({ id: kanbanColunas.id })
        .from(kanbanColunas)
        .where(eq(kanbanColunas.funilId, funilId));
      for (const c of cols) {
        await db.delete(kanbanCards).where(eq(kanbanCards.colunaId, c.id));
      }
      await db.delete(kanbanColunas).where(eq(kanbanColunas.funilId, funilId));
      await db.delete(kanbanFunis).where(eq(kanbanFunis.id, funilId));
    } catch (cleanupErr: any) {
      log.error(
        { funilId, err: cleanupErr?.message },
        "Falha no cleanup do funil parcial — pode ter ficado lixo",
      );
    }
  };

  try {
    // 2) Cria as colunas (1 por uma — drizzle MySQL não suporta bulk com
    //    insertIds determinísticos cross-versions; volume é baixo, ok).
    const trelloIdParaColunaId = new Map<string, number>();
    let ordem = 1;
    for (const l of listasUsadas) {
      const [colR] = await db.insert(kanbanColunas).values({
        funilId,
        nome: truncar(l.name, 64) ?? `Coluna ${ordem}`,
        cor: CORES_COLUNAS[(ordem - 1) % CORES_COLUNAS.length],
        ordem,
      });
      const colunaId = (colR as { insertId: number }).insertId;
      trelloIdParaColunaId.set(l.id, colunaId);
      ordem++;
    }

    // 3) Sincroniza tags no catálogo do escritório (kanbanTags).
    //    Pra cada label única dos cards Trello: se já existe (mesmo nome
    //    case-insensitive) no escritório, reusa; senão, cria com cor
    //    mapeada do Trello. O card aponta pra tag pelo NOME (single-source
    //    como o sistema já faz).
    const labelsUnicas = new Map<string, { name: string; color: string | null }>();
    for (const c of cardsUsados) {
      for (const l of c.labels ?? []) {
        const raw = l.name?.trim();
        if (!raw) continue;
        // kanbanTags.nome é varchar(32) — trunca pra evitar erro de schema.
        const nome = raw.slice(0, 32);
        const key = nome.toLowerCase();
        if (!labelsUnicas.has(key)) {
          labelsUnicas.set(key, { name: nome, color: l.color ?? null });
        }
      }
    }

    // Busca tags existentes no escritório (uma query só) pra detectar
    // duplicatas por nome case-insensitive.
    const tagsExistentes = await db
      .select({ id: kanbanTags.id, nome: kanbanTags.nome, cor: kanbanTags.cor })
      .from(kanbanTags)
      .where(eq(kanbanTags.escritorioId, escritorioId));

    // Mapa nome-lower → nome original (pra usar nos cards exatamente como
    // já está cadastrado, preservando maiúsculas/minúsculas existentes).
    const tagPorNomeLower = new Map<string, string>();
    for (const t of tagsExistentes) {
      tagPorNomeLower.set(t.nome.toLowerCase(), t.nome);
    }

    let tagsCriadas = 0;
    let tagsReusadas = 0;
    for (const [key, info] of labelsUnicas) {
      if (tagPorNomeLower.has(key)) {
        tagsReusadas++;
        continue;
      }
      const cor = (info.color && COR_TRELLO_HEX[info.color]) || COR_FALLBACK;
      await db.insert(kanbanTags).values({
        escritorioId,
        nome: info.name,
        cor,
      });
      tagPorNomeLower.set(key, info.name);
      tagsCriadas++;
    }

    // 4) Cria os cards em chunks bulk.
    const cardsAgrupadosPorColuna = new Map<string, TrelloCard[]>();
    for (const c of cardsUsados) {
      const arr = cardsAgrupadosPorColuna.get(c.idList) ?? [];
      arr.push(c);
      cardsAgrupadosPorColuna.set(c.idList, arr);
    }

    type CardRow = {
      escritorioId: number;
      colunaId: number;
      titulo: string;
      descricao: string | null;
      prioridade: "alta" | "media" | "baixa";
      tags: string | null;
      prazo: Date | null;
      ordem: number;
    };
    const rows: CardRow[] = [];

    for (const [trelloListId, lista] of cardsAgrupadosPorColuna) {
      const colunaId = trelloIdParaColunaId.get(trelloListId);
      if (colunaId == null) continue;
      const ordenados = lista.slice().sort((a, b) => a.pos - b.pos);
      let ord = 1;
      for (const c of ordenados) {
        // Usa o nome canônico que está em kanbanTags (preserva
        // maiúsculas/minúsculas do catálogo existente). Limita a 32 chars
        // pra bater com tag.nome.
        const labels = (c.labels ?? [])
          .map((l) => l.name?.trim())
          .filter((n): n is string => !!n && n.length > 0)
          .map((n) => tagPorNomeLower.get(n.slice(0, 32).toLowerCase()) ?? n);
        const tagsStr = labels.length > 0 ? labels.join(", ") : null;

        let prazo: Date | null = null;
        if (c.due) {
          const d = new Date(c.due);
          if (!isNaN(d.getTime())) prazo = d;
        }

        rows.push({
          escritorioId,
          colunaId,
          titulo: truncar(c.name, 255) ?? "(sem título)",
          descricao: c.desc?.trim() ? c.desc : null,
          prioridade: "media",
          tags: truncar(tagsStr, 255),
          prazo,
          ordem: ord++,
        });
      }
    }

    let cardsInseridos = 0;
    for (let i = 0; i < rows.length; i += CHUNK_INSERT_CARDS) {
      const chunk = rows.slice(i, i + CHUNK_INSERT_CARDS);
      if (chunk.length === 0) continue;
      await db.insert(kanbanCards).values(chunk);
      cardsInseridos += chunk.length;
    }

    log.info(
      {
        escritorioId,
        funilId,
        nome: tituloFunil,
        colunas: listasUsadas.length,
        cards: cardsInseridos,
        listasIgnoradas: listas.length - listasUsadas.length,
        cardsIgnorados: cardsBrutos.length - cardsUsados.length,
        tagsCriadas,
        tagsReusadas,
      },
      "Import Trello concluído",
    );

    return {
      funilId,
      funilNome: tituloFunil,
      colunasCriadas: listasUsadas.length,
      cardsCriados: cardsInseridos,
      cardsIgnorados: cardsBrutos.length - cardsUsados.length,
      listasIgnoradas: listas.length - listasUsadas.length,
      tagsCriadas,
      tagsReusadas,
    };
  } catch (err: any) {
    log.error(
      { escritorioId, funilId, err: err?.message },
      "Falha no import — limpando funil parcial",
    );
    await cleanup();
    throw err;
  }
}
