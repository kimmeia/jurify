/**
 * Amostra de uma página do DataJud — sem gravar nada.
 *
 * Existe pra responder duas perguntas antes de comprometer o banco:
 *
 * 1. A barreira de sigilo está pegando? (quantos ficaram de fora e por quê)
 * 2. A classificação de desfecho cobre o vocabulário DESTE tribunal?
 *
 * A segunda é a que vale mais. Escolhi classificar desfecho por nome de
 * movimento em vez de código da TPU justamente pra poder corrigir olhando
 * dado real — e `naoClassificados` é esse dado: os nomes do último movimento
 * dos processos que ficaram sem resultado. Se a sentença do TJCE se chama
 * algo que minhas regras não cobrem, o nome aparece aqui no topo.
 */

import { normalizarHit } from "./datajud-normalizar";
import { deduzirDesfecho, type ResultadoProcesso } from "./datajud-desfecho";
import {
  deduzirDesfechoRecurso,
  ORDEM_RECURSO,
  type ResultadoRecurso,
} from "./datajud-recurso";

export interface ResumoAmostra {
  lidos: number;
  aceitos: number;
  sigilosos: number;
  invalidos: number;
  /** Quantos processos aceitos caíram em cada resultado. */
  porResultado: Record<ResultadoProcesso, number>;
  /**
   * O outro eixo. Num tribunal superior é este que enche e `porResultado` que
   * fica zerado — se os dois vierem vazios, a calibragem falhou pra este
   * tribunal e a varredura ingeriria processo sem desfecho nenhum.
   */
  porRecurso: Record<ResultadoRecurso, number>;
  semResultado: number;
  /**
   * Último movimento dos processos SEM resultado, por frequência. É o insumo
   * pra calibrar as regras: o nome da sentença deste tribunal está aqui.
   */
  naoClassificados: Array<{ nome: string; vezes: number }>;
  /** Alguns processos aceitos, pra conferir o resto dos campos a olho. */
  exemplos: Array<{
    cnj: string;
    classe: string | null;
    assunto: string | null;
    orgao: string | null;
    movimentos: number;
    resultado: ResultadoProcesso | null;
    recurso: ResultadoRecurso | null;
    movimentoDecisivo: string | null;
  }>;
}

const ZERO: Record<ResultadoProcesso, number> = {
  procedente: 0,
  parcial: 0,
  improcedente: 0,
  acordo: 0,
  extinto_sem_merito: 0,
};

const ZERO_RECURSO = Object.fromEntries(ORDEM_RECURSO.map((r) => [r, 0])) as Record<
  ResultadoRecurso,
  number
>;

export function resumirAmostra(hits: unknown[], maxExemplos = 5): ResumoAmostra {
  const porResultado = { ...ZERO };
  const porRecurso = { ...ZERO_RECURSO };
  const naoClassificados = new Map<string, number>();
  const exemplos: ResumoAmostra["exemplos"] = [];

  let aceitos = 0;
  let sigilosos = 0;
  let invalidos = 0;
  let semResultado = 0;

  for (const hit of hits) {
    const n = normalizarHit(hit);
    if (!n.ok) {
      if (n.motivo === "sigiloso") sigilosos++;
      else invalidos++;
      continue;
    }
    aceitos++;

    const d = deduzirDesfecho(n.movimentos);
    const rec = deduzirDesfechoRecurso(n.movimentos);
    if (rec) porRecurso[rec.resultado]++;

    // "Sem resultado" agora quer dizer sem NENHUM dos dois eixos. Um acórdão
    // do STJ não tem "procedência" e nem por isso está sem classificação.
    if (d) {
      porResultado[d.resultado]++;
    } else if (rec) {
      // classificado pelo outro eixo
    } else {
      semResultado++;
      // Só o ÚLTIMO movimento: é onde a sentença estaria. Contar todos
      // afogaria o sinal em "juntada de petição".
      const ultimo = n.movimentos[n.movimentos.length - 1];
      if (ultimo) {
        naoClassificados.set(ultimo.nome, (naoClassificados.get(ultimo.nome) ?? 0) + 1);
      }
    }

    if (exemplos.length < maxExemplos) {
      exemplos.push({
        cnj: n.processo.cnj,
        classe: n.processo.classeNome,
        assunto: n.processo.assuntoNome,
        orgao: n.processo.orgaoNome,
        movimentos: n.movimentos.length,
        resultado: d?.resultado ?? null,
        recurso: rec?.resultado ?? null,
        movimentoDecisivo: d?.movimento ?? rec?.movimento ?? null,
      });
    }
  }

  return {
    lidos: hits.length,
    aceitos,
    sigilosos,
    invalidos,
    porResultado,
    porRecurso,
    semResultado,
    naoClassificados: [...naoClassificados.entries()]
      .map(([nome, vezes]) => ({ nome, vezes }))
      .sort((a, b) => b.vezes - a.vezes || a.nome.localeCompare(b.nome))
      .slice(0, 20),
    exemplos,
  };
}
