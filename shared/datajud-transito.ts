/**
 * Quando o processo virou definitivo.
 *
 * Existe porque a estatística estava contando resultado provisório como se
 * fosse final: sentença procedente de 2024 com apelação pendente entra em
 * "procedente" e pode virar improcedente no ano seguinte. O número fica certo
 * hoje e mentiroso amanhã, sem nada na tela avisando.
 *
 * Trânsito NÃO é filtro de entrada do acervo — é qualificador do número.
 * Acórdão é citável quando publicado, e exigir trânsito descartaria o
 * precedente recente do STJ, que é o mais valioso. O advogado cita o
 * entendimento do tribunal; o fim do processo daquela parte é outra coisa.
 *
 * Só "trânsito em julgado" conta. "Baixa definitiva" e "definitivo" são
 * movimentação de cartório — o processo desceu, foi arquivado — e acontecem
 * também em caso que não transitou.
 */

export interface MovimentoTransito {
  nome: string;
  /** ISO. */
  dataHora: string;
}

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const TRANSITO = /transito em julgado/;

/**
 * Devolve a data do ÚLTIMO trânsito, ou null.
 *
 * Último e não primeiro: processo que teve trânsito, foi desarquivado por
 * ação rescisória e transitou de novo tem duas marcas, e a que vale é a
 * recente.
 */
export function detectarTransito(movimentos: MovimentoTransito[]): string | null {
  let achado: string | null = null;
  for (const m of movimentos) {
    if (typeof m?.nome !== "string" || typeof m?.dataHora !== "string") continue;
    if (!TRANSITO.test(normalizar(m.nome))) continue;
    if (achado === null || m.dataHora.localeCompare(achado) > 0) achado = m.dataHora;
  }
  return achado;
}
