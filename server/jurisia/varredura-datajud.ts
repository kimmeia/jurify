/**
 * Varredura de um tribunal no DataJud.
 *
 * Roda em lotes com teto de páginas por execução, e grava o cursor a cada
 * página. Assim uma execução interrompida — deploy, timeout, erro da API —
 * retoma de onde parou em vez de recomeçar o tribunal, que é a diferença
 * entre horas e semanas num tribunal grande.
 */

import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { jurisiaMovimentos, jurisiaProcessos, jurisiaVarredura } from "../../drizzle/schema";
import {
  normalizarHit,
  type MovimentoDataJud,
  type ProcessoDataJud,
} from "../../shared/datajud-normalizar";
import { deduzirDesfecho } from "../../shared/datajud-desfecho";
import { deduzirDesfechoRecurso } from "../../shared/datajud-recurso";
import { detectarTransito } from "../../shared/datajud-transito";
import { buscarPagina } from "./datajud-client";
import { createLogger } from "../_core/logger";

const log = createLogger("datajud-varredura");

export interface ResultadoVarredura {
  tribunal: string;
  paginas: number;
  processos: number;
  sigilosos: number;
  completo: boolean;
  erro: string | null;
}

/**
 * Uma execução da varredura.
 *
 * `maxPaginas` existe pra a execução ter fim previsível: o admin dispara,
 * acompanha, e dispara de novo. Varredura sem teto vira processo que ninguém
 * sabe se está viva.
 */
export async function varrerTribunal(args: {
  tribunal: string;
  alias: string;
  maxPaginas?: number;
  tamanhoPagina?: number;
}): Promise<ResultadoVarredura> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");

  const tribunal = args.tribunal.toUpperCase();
  const maxPaginas = Math.min(Math.max(args.maxPaginas ?? 10, 1), 200);

  await db
    .insert(jurisiaVarredura)
    .values({ tribunal, status: "rodando" })
    .onDuplicateKeyUpdate({ set: { status: "rodando", ultimoErro: null } });

  const [estado] = await db
    .select({ cursor: jurisiaVarredura.cursor })
    .from(jurisiaVarredura)
    .where(eq(jurisiaVarredura.tribunal, tribunal))
    .limit(1);

  let cursor = estado?.cursor ?? null;
  let paginas = 0;
  let processos = 0;
  let sigilosos = 0;
  let completo = false;

  try {
    while (paginas < maxPaginas) {
      const pagina = await buscarPagina({
        alias: args.alias,
        cursor,
        tamanho: args.tamanhoPagina ?? 100,
      });
      paginas++;

      // Contador DESTA página. Somar o acumulado da execução a cada volta
      // contaria a primeira página de novo em toda página seguinte.
      let daPagina = 0;
      for (const hit of pagina.hits) {
        const n = normalizarHit(hit);
        if (!n.ok) {
          if (n.motivo === "sigiloso") sigilosos++;
          continue;
        }
        await gravarProcesso(db, n.processo, n.movimentos);
        daPagina++;
      }
      processos += daPagina;

      cursor = pagina.proximoCursor;

      // Cursor gravado a cada página: interrupção no meio não custa o
      // tribunal inteiro.
      await db
        .update(jurisiaVarredura)
        .set({
          cursor,
          processos: sql`${jurisiaVarredura.processos} + ${daPagina}`,
          ultimaExecucao: new Date(),
        })
        .where(eq(jurisiaVarredura.tribunal, tribunal));

      if (!cursor) {
        completo = true;
        break;
      }
    }

    await db
      .update(jurisiaVarredura)
      .set({
        status: completo ? "completo" : "fila",
        cursor,
        sigilosos: sql`${jurisiaVarredura.sigilosos} + ${sigilosos}`,
        ultimaExecucao: new Date(),
        ultimoErro: null,
      })
      .where(eq(jurisiaVarredura.tribunal, tribunal));

    log.info({ tribunal, paginas, processos, sigilosos, completo }, "varredura concluída");
    return { tribunal, paginas, processos, sigilosos, completo, erro: null };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    // Erro persiste no banco em vez de morrer no log: a tela do admin precisa
    // mostrar por que o tribunal parou.
    await db
      .update(jurisiaVarredura)
      .set({ status: "erro", ultimoErro: erro.slice(0, 500), ultimaExecucao: new Date() })
      .where(eq(jurisiaVarredura.tribunal, tribunal));
    log.error({ tribunal, erro }, "varredura falhou");
    return { tribunal, paginas, processos, sigilosos, completo: false, erro };
  }
}

async function gravarProcesso(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  processo: ProcessoDataJud,
  movimentos: MovimentoDataJud[],
) {
  const desfecho = deduzirDesfecho(movimentos);
  // Os dois eixos rodam sempre, e cada processo costuma preencher só um: o de
  // 1º grau fala "procedência", o de instância superior fala "provimento".
  // Rodar os dois é mais barato que decidir qual vale pelo `grau`, que nem
  // todo tribunal preenche.
  const recurso = deduzirDesfechoRecurso(movimentos);
  const transito = detectarTransito(movimentos);
  const valores = {
    cnj: processo.cnj,
    tribunal: processo.tribunal,
    grau: processo.grau,
    classeCodigo: processo.classeCodigo,
    classeNome: processo.classeNome,
    assuntoCodigo: processo.assuntoCodigo,
    assuntoNome: processo.assuntoNome,
    orgaoCodigo: processo.orgaoCodigo,
    orgaoNome: processo.orgaoNome,
    ajuizamentoEm: processo.ajuizamentoEm ? new Date(processo.ajuizamentoEm) : null,
    atualizadoEm: processo.atualizadoEm ? new Date(processo.atualizadoEm) : null,
    resultado: desfecho?.resultado ?? null,
    resultadoEm: desfecho ? new Date(desfecho.em) : null,
    resultadoMovimento: desfecho?.movimento ?? null,
    resultadoRecurso: recurso?.resultado ?? null,
    resultadoRecursoEm: recurso ? new Date(recurso.em) : null,
    resultadoRecursoMovimento: recurso?.movimento ?? null,
    transitadoEm: transito ? new Date(transito) : null,
    sincronizadoEm: new Date(),
  };

  await db.insert(jurisiaProcessos).values(valores).onDuplicateKeyUpdate({ set: valores });

  const [row] = await db
    .select({ id: jurisiaProcessos.id })
    .from(jurisiaProcessos)
    .where(eq(jurisiaProcessos.cnj, processo.cnj))
    .limit(1);
  if (!row) return;

  // Movimentos são substituídos, não acumulados: a API devolve a lista
  // inteira a cada sync, e append duplicaria o histórico a cada passada.
  await db.delete(jurisiaMovimentos).where(eq(jurisiaMovimentos.processoId, row.id));
  if (movimentos.length > 0) {
    await db.insert(jurisiaMovimentos).values(
      movimentos.map((m) => ({
        processoId: row.id,
        codigo: m.codigo,
        nome: m.nome,
        dataHora: new Date(m.dataHora),
      })),
    );
  }
}

/** Estado de todos os tribunais — alimenta o painel do robô. */
export async function estadoVarreduras() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(jurisiaVarredura)
    .orderBy(jurisiaVarredura.tribunal);
}

/** Recomeça um tribunal do zero — usado quando o cursor corrompe. */
export async function reiniciarTribunal(tribunal: string) {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");
  await db
    .update(jurisiaVarredura)
    .set({ cursor: null, status: "fila", ultimoErro: null })
    .where(eq(jurisiaVarredura.tribunal, tribunal.toUpperCase()));
}
