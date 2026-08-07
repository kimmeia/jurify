/**
 * Deduz como o processo terminou a partir dos movimentos do DataJud.
 *
 * Duas decisões que valem explicação:
 *
 * **Classifica pelo NOME do movimento, não pelo código da TPU.** Os códigos
 * existem e seriam mais robustos, mas só depois de conferidos contra a
 * resposta real da API — número de tabela decorado errado silenciosamente
 * classifica errado o acervo inteiro, e ninguém percebe. O nome vem no mesmo
 * payload e é verificável a olho.
 *
 * **O resultado é neutro de polo.** Aqui não existe "favorável": este acervo é
 * de processos de terceiros e não sabemos de que lado alguém está. Favorável
 * ou não é conta que só o acervo do próprio escritório permite fazer.
 */

export type ResultadoProcesso =
  | "procedente"
  | "parcial"
  | "improcedente"
  | "acordo"
  | "extinto_sem_merito";

export interface MovimentoClassificavel {
  nome: string;
  /** ISO. */
  dataHora: string;
}

export interface DesfechoDeduzido {
  resultado: ResultadoProcesso;
  /** ISO do movimento que decidiu. */
  em: string;
  /** O nome que gerou a classificação — é o que se confere quando dá errado. */
  movimento: string;
}

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Ordem importa: "procedência em parte" contém "procedência", então o padrão
 * mais específico precisa ser testado antes.
 */
const REGRAS: Array<{ re: RegExp; resultado: ResultadoProcesso }> = [
  { re: /proced(encia|ente)\s+(em\s+)?parte|parcialmente\s+proced/i, resultado: "parcial" },
  { re: /improced/i, resultado: "improcedente" },
  { re: /homologa[çc]ao\s+de\s+(transa[çc]ao|acordo)|acordo\s+homologado/i, resultado: "acordo" },
  {
    re: /extin[çc]ao\s+.*sem\s+resolu[çc]ao\s+do\s+m[ée]rito|sem\s+resolu[çc]ao\s+de\s+m[ée]rito/i,
    resultado: "extinto_sem_merito",
  },
  { re: /proced/i, resultado: "procedente" },
];

/**
 * Usa o ÚLTIMO movimento decisivo, não o primeiro: sentença procedente que o
 * tribunal reformou depois termina improcedente, e é o desfecho final que
 * responde "quanto costuma dar".
 */
export function deduzirDesfecho(movimentos: MovimentoClassificavel[]): DesfechoDeduzido | null {
  const ordenados = [...movimentos]
    .filter((m) => typeof m?.nome === "string" && typeof m?.dataHora === "string")
    .sort((a, b) => a.dataHora.localeCompare(b.dataHora));

  let achado: DesfechoDeduzido | null = null;
  for (const m of ordenados) {
    const nome = semAcento(m.nome);
    for (const r of REGRAS) {
      if (r.re.test(nome) || r.re.test(m.nome)) {
        achado = { resultado: r.resultado, em: m.dataHora, movimento: m.nome };
        break;
      }
    }
  }
  return achado;
}
