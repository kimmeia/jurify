/**
 * A fila de ingestão — o robô perseguindo uma meta em vez do admin clicando.
 *
 * O botão de varredura é síncrono: segura a requisição, faz cinco páginas e
 * devolve. Com 59 tribunais e milhões de processos, quem vira o laço de
 * repetição é a pessoa. Aqui a pessoa diz "quero 20 mil hoje" e sai.
 *
 * O ciclo é curto de propósito. Uma tarefa que tentasse 20 mil processos numa
 * chamada só seria uma requisição HTTP de horas, morreria no primeiro deploy e
 * ninguém saberia de onde retomar. Em ciclos, cada pedaço é commitado: reiniciar
 * o servidor custa no máximo um ciclo.
 */

import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { jurisiaProcessos, jurisiaTarefas, jurisiaVarredura } from "../../drizzle/schema";
import { varrerTribunal } from "./varredura-datajud";
import { createLogger } from "../_core/logger";

const log = createLogger("jurisia-fila");

/**
 * Páginas por ciclo. Cada página são 100 processos.
 *
 * Baixo de propósito: o DataJud é uma API pública compartilhada e as respostas
 * levam de 2 a 16 segundos. Três páginas dão um ciclo de menos de um minuto,
 * que cabe folgado entre os ticks e deixa o serviço respirar.
 */
const PAGINAS_POR_CICLO = 3;

/**
 * Quanto tempo o ciclo fica reservado.
 *
 * Generoso em relação ao ciclo (que leva menos de um minuto) porque o risco de
 * expirar cedo é pior que o de expirar tarde: cedo, duas instâncias trabalham
 * o mesmo pedaço; tarde, a fila só espera alguns minutos depois de um deploy.
 */
const RESERVA_MINUTOS = 5;

/**
 * Trava em-processo — primeira barreira, contra tick sobreposto na MESMA
 * instância. A segunda barreira é a reserva no banco, que é a que vale quando
 * o Railway sobe duas.
 */
let rodando = false;

interface Alvo {
  tribunal: string;
  alias: string;
}

/** Linhas distintas deste tribunal. É o número que não mente. */
async function contarDoTribunal(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tribunal: string,
): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(jurisiaProcessos)
    .where(eq(jurisiaProcessos.tribunal, tribunal.toUpperCase()));
  return Number(r?.n ?? 0);
}

export interface TarefaIngestao {
  id: number;
  tribunal: string | null;
  metaProcessos: number;
  /** Processos novos — o que a meta persegue. */
  processos: number;
  /** Gravações, incluindo reler processo conhecido. */
  gravacoes: number;
  paginas: number;
  status: "fila" | "rodando" | "concluida" | "cancelada" | "erro";
  ultimoErro: string | null;
  criadoEm: Date;
  iniciadoEm: Date | null;
  concluidoEm: Date | null;
}

export async function criarTarefa(args: {
  tribunal: string | null;
  metaProcessos: number;
  criadoPor: number | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");

  const [r] = await db.insert(jurisiaTarefas).values({
    tribunal: args.tribunal?.toUpperCase() ?? null,
    metaProcessos: args.metaProcessos,
    criadoPor: args.criadoPor,
  });
  return Number((r as { insertId: number }).insertId);
}

export async function listarTarefas(limite = 20): Promise<TarefaIngestao[]> {
  const db = await getDb();
  if (!db) return [];
  const linhas = await db
    .select()
    .from(jurisiaTarefas)
    .orderBy(sql`${jurisiaTarefas.id} DESC`)
    .limit(limite);
  return linhas as TarefaIngestao[];
}

export async function cancelarTarefa(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Só cancela o que ainda não terminou: cancelar tarefa concluída apagaria o
  // registro de que ela deu certo.
  await db
    .update(jurisiaTarefas)
    .set({ status: "cancelada", concluidoEm: new Date() })
    .where(and(eq(jurisiaTarefas.id, id), inArray(jurisiaTarefas.status, ["fila", "rodando"])));
}

/**
 * Qual tribunal atacar quando a tarefa não nomeia um.
 *
 * O mais atrasado primeiro — que é o de menos processos entre os que ainda não
 * terminaram. Alfabético faria o TJAC receber a mesma atenção que o TJSP, e é
 * no TJSP que estão os processos.
 *
 * Tribunal com erro fica de fora: insistir nele queima o ciclo que outro usaria
 * e o erro se repete no log até ninguém mais ler.
 */
async function proximoTribunal(): Promise<Alvo | null> {
  const db = await getDb();
  if (!db) return null;

  const { TRIBUNAL_PROVIDERS } = await import("../processos/tribunal-providers");
  const elegiveis = Object.values(TRIBUNAL_PROVIDERS).filter(
    (p) => p.temIndiceDataJud !== false,
  );

  const estados = await db
    .select({
      tribunal: jurisiaVarredura.tribunal,
      status: jurisiaVarredura.status,
      processos: jurisiaVarredura.processos,
    })
    .from(jurisiaVarredura);

  const porTribunal = new Map(estados.map((e) => [e.tribunal.toUpperCase(), e]));

  return escolherProximo(
    elegiveis.map((p) => {
      const e = porTribunal.get(p.sigla.toUpperCase());
      return {
        tribunal: p.sigla.toUpperCase(),
        alias: p.alias,
        status: e?.status ?? "fila",
        processos: e?.processos ?? 0,
      };
    }),
  );
}

export interface CandidatoTribunal {
  tribunal: string;
  alias: string;
  status: string;
  processos: number;
}

/**
 * A política de rodízio, isolada porque errar aqui esfomeia um tribunal pra
 * sempre e nada na tela denuncia.
 *
 * Menos processos primeiro. Empate desempata pela sigla — não por acaso: sem
 * desempate estável, dois tribunais zerados se revezariam conforme a ordem que
 * o banco devolvesse, e nenhum dos dois avançaria de forma previsível.
 */
export function escolherProximo(candidatos: CandidatoTribunal[]): Alvo | null {
  const vivos = candidatos
    .filter((c) => c.status !== "completo" && c.status !== "erro")
    .sort((a, b) => a.processos - b.processos || a.tribunal.localeCompare(b.tribunal));

  const escolhido = vivos[0];
  return escolhido ? { tribunal: escolhido.tribunal, alias: escolhido.alias } : null;
}

/**
 * Resolve a sigla no alias do DataJud pelo registro, não por `toLowerCase()`.
 *
 * O alias nem sempre é a sigla em minúscula — o TJDFT é o contraexemplo — e um
 * alias errado vira 404 no índice, que a tela mostraria como "tribunal com
 * erro" em vez de "eu montei o endereço errado".
 */
async function resolverAlvo(sigla: string): Promise<Alvo | null> {
  const { TRIBUNAL_PROVIDERS } = await import("../processos/tribunal-providers");
  const p = Object.values(TRIBUNAL_PROVIDERS).find(
    (t) => t.sigla.toUpperCase() === sigla.toUpperCase(),
  );
  if (!p || p.temIndiceDataJud === false) return null;
  return { tribunal: p.sigla.toUpperCase(), alias: p.alias };
}

/**
 * Um ciclo. Chamado pelo cron.
 *
 * Pega a tarefa viva mais antiga, avança um pedaço, grava e sai. O progresso
 * fica no banco a cada ciclo — reiniciar o servidor custa no máximo um ciclo,
 * não a tarefa inteira.
 */
export async function rodarCicloFila(): Promise<void> {
  if (rodando) {
    log.info("ciclo anterior ainda em andamento — pulando");
    return;
  }
  rodando = true;

  try {
    const db = await getDb();
    if (!db) return;

    const [tarefa] = await db
      .select()
      .from(jurisiaTarefas)
      .where(inArray(jurisiaTarefas.status, ["fila", "rodando"]))
      .orderBy(asc(jurisiaTarefas.id))
      .limit(1);

    if (!tarefa) return;

    if (tarefa.processos >= tarefa.metaProcessos) {
      await db
        .update(jurisiaTarefas)
        .set({ status: "concluida", concluidoEm: new Date() })
        .where(eq(jurisiaTarefas.id, tarefa.id));
      log.info({ tarefa: tarefa.id }, "meta atingida");
      return;
    }

    const alvo = tarefa.tribunal
      ? await resolverAlvo(tarefa.tribunal)
      : await proximoTribunal();

    if (!alvo) {
      await db
        .update(jurisiaTarefas)
        .set({
          status: "erro",
          ultimoErro: tarefa.tribunal
            ? `${tarefa.tribunal} não tem índice no DataJud.`
            : "Nenhum tribunal elegível — todos completos ou em erro.",
          concluidoEm: new Date(),
        })
        .where(eq(jurisiaTarefas.id, tarefa.id));
      return;
    }

    // Reserva atômica do ciclo. `affectedRows === 0` significa que outra
    // instância pegou este pedaço primeiro — sair é o comportamento certo.
    const reserva = await db
      .update(jurisiaTarefas)
      .set({
        status: "rodando",
        lockAte: sql`DATE_ADD(NOW(), INTERVAL ${RESERVA_MINUTOS} MINUTE)`,
        iniciadoEm: sql`COALESCE(${jurisiaTarefas.iniciadoEm}, NOW())`,
      })
      .where(
        and(
          eq(jurisiaTarefas.id, tarefa.id),
          inArray(jurisiaTarefas.status, ["fila", "rodando"]),
          or(sql`${jurisiaTarefas.lockAte} IS NULL`, sql`${jurisiaTarefas.lockAte} < NOW()`),
        ),
      );

    if ((reserva as unknown as { affectedRows?: number }).affectedRows === 0) {
      log.info({ tarefa: tarefa.id }, "ciclo já reservado por outra instância");
      return;
    }

    // Diferença de linhas distintas ANTES e DEPOIS. É a única forma honesta de
    // saber quantos processos NOVOS entraram: `r.processos` conta gravações, e
    // upsert reconta o mesmo CNJ quando a página é relida.
    const antes = await contarDoTribunal(db, alvo.tribunal);

    const r = await varrerTribunal({
      tribunal: alvo.tribunal,
      alias: alvo.alias,
      maxPaginas: PAGINAS_POR_CICLO,
    });

    const depois = await contarDoTribunal(db, alvo.tribunal);
    const novos = Math.max(0, depois - antes);

    // O erro fica na tarefa mas NÃO a mata: um tribunal fora do ar é motivo
    // pra tentar outro no próximo ciclo, não pra desistir da meta.
    await db
      .update(jurisiaTarefas)
      .set({
        processos: sql`${jurisiaTarefas.processos} + ${novos}`,
        gravacoes: sql`${jurisiaTarefas.gravacoes} + ${r.processos}`,
        paginas: sql`${jurisiaTarefas.paginas} + ${r.paginas}`,
        ultimoErro: r.erro ? `${alvo.tribunal}: ${r.erro}`.slice(0, 500) : null,
        lockAte: null,
      })
      .where(eq(jurisiaTarefas.id, tarefa.id));

    log.info(
      {
        tarefa: tarefa.id,
        tribunal: alvo.tribunal,
        novos,
        gravacoes: r.processos,
        erro: r.erro,
      },
      "ciclo concluído",
    );
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "ciclo falhou");
  } finally {
    rodando = false;
  }
}
