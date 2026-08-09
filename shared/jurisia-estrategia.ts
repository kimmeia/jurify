/**
 * Cruzar o acervo público com o histórico do próprio escritório.
 *
 * É o diferencial do produto — e também o lugar onde é mais fácil mentir sem
 * perceber. Duas armadilhas que este módulo existe pra desarmar:
 *
 * **A unidade tem que ser a mesma.** `eventos_processo.desfecho` é relativo ao
 * polo ("favorável" = bom pro cliente DAQUELE escritório); o acervo é neutro
 * ("procedente"). Comparar os dois diretamente é somar laranja com maçã e
 * publicar o resultado como se fosse fruta. Por isso o histórico do escritório
 * é reclassificado com `deduzirDesfecho`, o MESMO classificador do acervo.
 *
 * **Amostra pequena não vira manchete.** Um escritório com 6 casos vai ter
 * percentual que oscila 17 pontos com um caso a mais. `destaque` só existe
 * quando há base pra afirmar diferença; abaixo disso a tela mostra os números
 * e cala a boca.
 */

import type { ResultadoProcesso } from "./datajud-desfecho";
import { ORDEM_RESULTADO, type EstatisticaRecorte } from "./jurisia-recorte";

/** Abaixo disso, nenhuma diferença é afirmada — só exibida. */
export const MIN_COMPARACAO = 8;

/** Diferença menor que isto é ruído mesmo com amostra boa. */
export const MIN_DIFERENCA_PP = 10;

export interface LinhaComparacao {
  resultado: ResultadoProcesso;
  acervoPct: number;
  acervoQtd: number;
  escritorioPct: number;
  escritorioQtd: number;
  /** Pontos percentuais: escritório menos acervo. */
  diferencaPp: number;
}

export interface Comparacao {
  linhas: LinhaComparacao[];
  acervoDecididos: number;
  escritorioDecididos: number;
  /** Casos do escritório encontrados, mesmo os que ainda não terminaram. */
  escritorioTotal: number;
  amostraPequena: boolean;
  /**
   * A diferença que vale contar — ou null quando não há base. Null é um
   * resultado legítimo e frequente, não uma falha.
   */
  destaque: LinhaComparacao | null;
}

export function compararComAcervo(
  acervo: EstatisticaRecorte,
  escritorio: EstatisticaRecorte,
): Comparacao {
  const acervoPor = new Map(acervo.fatias.map((f) => [f.resultado, f]));
  const escPor = new Map(escritorio.fatias.map((f) => [f.resultado, f]));

  const linhas: LinhaComparacao[] = ORDEM_RESULTADO.map((resultado) => {
    const a = acervoPor.get(resultado);
    const e = escPor.get(resultado);
    const acervoPct = a?.percentual ?? 0;
    const escritorioPct = e?.percentual ?? 0;
    return {
      resultado,
      acervoPct,
      acervoQtd: a?.quantidade ?? 0,
      escritorioPct,
      escritorioQtd: e?.quantidade ?? 0,
      diferencaPp: escritorioPct - acervoPct,
    };
  });

  const amostraPequena = escritorio.comResultado < MIN_COMPARACAO;

  // Sem amostra, sem manchete. E mesmo com amostra, diferença de 3 pontos não
  // é notícia — é a mesma coisa medida duas vezes.
  let destaque: LinhaComparacao | null = null;
  if (!amostraPequena && acervo.comResultado > 0) {
    const candidata = [...linhas]
      .filter((l) => Math.abs(l.diferencaPp) >= MIN_DIFERENCA_PP)
      .sort((a, b) => Math.abs(b.diferencaPp) - Math.abs(a.diferencaPp))[0];
    destaque = candidata ?? null;
  }

  return {
    linhas,
    acervoDecididos: acervo.comResultado,
    escritorioDecididos: escritorio.comResultado,
    escritorioTotal: escritorio.total,
    amostraPequena,
    destaque,
  };
}

/** Os dados de capa que permitem dizer se um caso do escritório é "do mesmo
 *  tipo" que o recorte pesquisado. */
export interface CapaCaso {
  classe?: string | null;
  assuntos?: Array<string | { nome?: string | null }> | null;
  orgaoJulgador?: string | null;
}

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const contem = (alvo: string | null | undefined, termo: string) =>
  typeof alvo === "string" && semAcento(alvo).includes(semAcento(termo));

function assuntosDaCapa(capa: CapaCaso): string[] {
  if (!Array.isArray(capa.assuntos)) return [];
  return capa.assuntos
    .map((a) => (typeof a === "string" ? a : a?.nome ?? ""))
    .filter((a): a is string => typeof a === "string" && a.length > 0);
}

/**
 * O caso do escritório é do mesmo tipo do recorte?
 *
 * Sem acento e sem caixa: a capa vem do tribunal e o termo vem da pergunta do
 * advogado — exigir grafia idêntica faria o histórico do escritório parecer
 * vazio justamente quando ele existe.
 */
export function casoBateComFiltro(
  capa: CapaCaso | null,
  tribunalDoCaso: string | null,
  filtro: { tribunal: string | null; classeTermo: string | null; assuntoTermo: string | null },
): boolean {
  if (!capa) return false;

  if (filtro.tribunal) {
    const t = tribunalDoCaso ?? "";
    if (semAcento(t) !== semAcento(filtro.tribunal)) return false;
  }
  if (filtro.classeTermo && !contem(capa.classe, filtro.classeTermo)) return false;
  if (filtro.assuntoTermo) {
    const bate = assuntosDaCapa(capa).some((a) => contem(a, filtro.assuntoTermo!));
    if (!bate) return false;
  }
  // Filtro que não restringe nada casaria com o escritório inteiro — e um
  // "seus 400 casos" ao lado de um recorte de 12 não compara nada.
  return Boolean(filtro.tribunal || filtro.classeTermo || filtro.assuntoTermo);
}
