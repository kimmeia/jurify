/**
 * Perfil temporal e procedimental de um recorte.
 *
 * A fatia de desfecho responde "dá pra ganhar?". Esta responde as duas
 * perguntas que vêm logo depois e que nenhuma estatística de resultado cobre:
 * **quanto tempo** até a sentença, e **como o processo corre** no caminho
 * (tem liminar? vai pra recurso? tem perícia?).
 *
 * Tudo aqui sai de dado que já está no banco — `jurisia_movimentos` guarda a
 * lista inteira de movimentos e até agora só o último estava sendo usado.
 *
 * Mediana, e não média: distribuição de duração processual tem cauda longa
 * (um processo parado há 12 anos existe e puxa a média pra um número que não
 * descreve nenhum caso real). A mediana é o "caso do meio", que é o que o
 * advogado quer quando pergunta quanto demora.
 */

export interface PerfilRecorte {
  /** Quantos processos decididos entraram no cálculo. */
  amostra: number;
  /** Teto aplicado à amostra — a tela precisa dizer que houve corte. */
  limiteAmostra: number;
  /** Mediana de dias entre ajuizamento e desfecho. null se não deu pra medir. */
  medianaDias: number | null;
  /** Faixa central (25%–75%) em dias — o "normalmente entre X e Y". */
  p25Dias: number | null;
  p75Dias: number | null;
  marcadores: MarcadorContado[];
}

export interface MarcadorContado {
  chave: Marcador;
  rotulo: string;
  quantidade: number;
  /** Sobre a amostra. */
  percentual: number;
}

export type Marcador = "liminar" | "recurso" | "pericia" | "audiencia";

/**
 * Marcadores procedimentais, detectados pelo NOME do movimento.
 *
 * Mesma escolha do desfecho: nome em vez de código da TPU, porque nome dá pra
 * conferir e corrigir olhando dado real, e o preenchimento do código varia
 * entre os 90+ tribunais que alimentam a base.
 */
const REGRAS: Array<{ chave: Marcador; rotulo: string; re: RegExp }> = [
  {
    chave: "liminar",
    rotulo: "Teve liminar ou tutela",
    re: /liminar|tutela\s+(de\s+)?(urg[êe]ncia|antecipada|provis[óo]ria|cautelar)|antecipa[çc][ãa]o\s+de\s+tutela/i,
  },
  {
    chave: "recurso",
    rotulo: "Foi pra recurso",
    re: /apela[çc][ãa]o|agravo|embargos\s+de\s+declara|recurso\s+(especial|extraordin[áa]rio|inominado|adesivo)/i,
  },
  {
    chave: "pericia",
    rotulo: "Teve perícia",
    re: /per[íi]cia|perito|laudo\s+pericial/i,
  },
  {
    chave: "audiencia",
    rotulo: "Teve audiência",
    re: /audi[êe]ncia/i,
  },
];

export const MARCADORES: Marcador[] = REGRAS.map((r) => r.chave);

export function rotuloMarcador(m: Marcador): string {
  return REGRAS.find((r) => r.chave === m)?.rotulo ?? m;
}

/** Quais marcadores aparecem nos movimentos de UM processo. */
export function detectarMarcadores(nomesMovimentos: string[]): Set<Marcador> {
  const achados = new Set<Marcador>();
  for (const nome of nomesMovimentos) {
    for (const r of REGRAS) {
      if (!achados.has(r.chave) && r.re.test(nome)) achados.add(r.chave);
    }
    if (achados.size === REGRAS.length) break;
  }
  return achados;
}

/** Dias entre duas datas ISO. null quando falta uma ponta ou a ordem é impossível. */
export function duracaoDias(inicio: string | null, fim: string | null): number | null {
  if (!inicio || !fim) return null;
  const a = new Date(inicio).getTime();
  const b = new Date(fim).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const dias = Math.round((b - a) / 86_400_000);
  // Sentença antes do ajuizamento é dado sujo do tribunal, não duração
  // negativa — descarta em vez de contaminar a mediana.
  return dias >= 0 ? dias : null;
}

/** Percentil pelo posto mais próximo. Lista precisa estar ordenada. */
function percentil(ordenados: number[], p: number): number | null {
  if (ordenados.length === 0) return null;
  if (ordenados.length === 1) return ordenados[0];
  const pos = (ordenados.length - 1) * p;
  const baixo = Math.floor(pos);
  const alto = Math.ceil(pos);
  if (baixo === alto) return ordenados[baixo];
  return Math.round(ordenados[baixo] + (ordenados[alto] - ordenados[baixo]) * (pos - baixo));
}

export function mediana(valores: number[]): number | null {
  return percentil([...valores].sort((a, b) => a - b), 0.5);
}

export interface EntradaPerfil {
  ajuizamentoEm: string | null;
  resultadoEm: string | null;
  movimentos: string[];
}

export function montarPerfil(entradas: EntradaPerfil[], limiteAmostra: number): PerfilRecorte {
  const duracoes: number[] = [];
  const contagem = new Map<Marcador, number>(MARCADORES.map((m) => [m, 0]));

  for (const e of entradas) {
    const d = duracaoDias(e.ajuizamentoEm, e.resultadoEm);
    if (d !== null) duracoes.push(d);
    for (const m of detectarMarcadores(e.movimentos)) {
      contagem.set(m, (contagem.get(m) ?? 0) + 1);
    }
  }

  duracoes.sort((a, b) => a - b);
  const amostra = entradas.length;

  return {
    amostra,
    limiteAmostra,
    medianaDias: percentil(duracoes, 0.5),
    p25Dias: percentil(duracoes, 0.25),
    p75Dias: percentil(duracoes, 0.75),
    marcadores: MARCADORES.map((chave) => {
      const quantidade = contagem.get(chave) ?? 0;
      return {
        chave,
        rotulo: rotuloMarcador(chave),
        quantidade,
        percentual: amostra > 0 ? Math.round((quantidade * 100) / amostra) : 0,
      };
    }),
  };
}

/**
 * Duração em linguagem de advogado.
 *
 * "580 dias" obriga quem lê a fazer a conta; "1 ano e 7 meses" é a unidade em
 * que se pensa prazo de processo.
 */
export function formatarDuracao(dias: number | null): string {
  if (dias === null) return "—";
  if (dias < 1) return "menos de 1 dia";
  if (dias < 45) return dias === 1 ? "1 dia" : `${dias} dias`;

  const meses = Math.round(dias / 30.44);
  if (meses < 12) return `${meses} meses`;

  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const parteAnos = anos === 1 ? "1 ano" : `${anos} anos`;
  if (resto === 0) return parteAnos;
  return `${parteAnos} e ${resto === 1 ? "1 mês" : `${resto} meses`}`;
}
