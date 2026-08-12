/**
 * Conduta e faltas — o que aconteceu com cada pessoa, além das horas.
 *
 * O espelho de ponto conta o tempo. Ele não sabe dizer se o dia em branco foi
 * atestado, férias ou ninguém aparecendo sem avisar — e essas três coisas
 * pesam de formas opostas na mesma folha. Sem o motivo registrado ao lado, o
 * gestor lê a mesma linha vazia nos três casos e decide no que lembra.
 *
 * Daí o desenho:
 *
 *  - a falta tem MOTIVO, e o motivo é o que decide se ela desconta ou não;
 *  - atestado é o único motivo que não abona sozinho. O documento precisa
 *    estar anexado e revisado. Até lá a falta fica AGUARDANDO — não é abonada
 *    (ninguém viu o papel) nem descontada (a pessoa disse que tem). Fingir uma
 *    das duas seria decidir por omissão o que alguém tem que decidir olhando;
 *  - conduta (advertência, elogio, observação) não mexe em hora nenhuma. É
 *    memória: na hora da avaliação, "achei que ele melhorou" vale menos que
 *    três registros com data.
 *
 * Tudo aqui é escrita do gestor. O colaborador lê a própria ficha — esconder
 * dele o que a empresa anotou a respeito dele seria o avesso de um registro
 * de conduta — mas não escreve nela, e principalmente não anexa o próprio
 * atestado nem se abona.
 */

export type TipoOcorrencia = "falta" | "advertencia" | "elogio" | "observacao";

export type MotivoFalta =
  | "atestado"
  | "justificada"
  | "injustificada"
  | "folga"
  | "ferias"
  | "licenca";

export const TIPOS_OCORRENCIA: TipoOcorrencia[] = [
  "falta",
  "advertencia",
  "elogio",
  "observacao",
];

export const MOTIVOS_FALTA: MotivoFalta[] = [
  "atestado",
  "justificada",
  "injustificada",
  "folga",
  "ferias",
  "licenca",
];

export const ROTULO_TIPO: Record<TipoOcorrencia, string> = {
  falta: "Falta",
  advertencia: "Advertência",
  elogio: "Elogio",
  observacao: "Observação",
};

export const ROTULO_MOTIVO: Record<MotivoFalta, string> = {
  atestado: "Atestado médico",
  justificada: "Justificada",
  injustificada: "Injustificada",
  folga: "Folga",
  ferias: "Férias",
  licenca: "Licença",
};

/** Uma ocorrência como a tela a recebe. */
export interface OcorrenciaGravada {
  id: number;
  colaboradorId: number;
  dia: string;
  tipo: TipoOcorrencia;
  motivo: MotivoFalta | null;
  descricao: string | null;
  atestadoUrl: string | null;
  atestadoNome: string | null;
  aprovadoEm: string | null;
}

/** Só falta tem motivo. Elogio com motivo "férias" não quer dizer nada. */
export function exigeMotivo(tipo: TipoOcorrencia): boolean {
  return tipo === "falta";
}

/** O motivo cujo abono depende de documento revisado. */
export function dependeDeAprovacao(motivo: MotivoFalta): boolean {
  return motivo === "atestado";
}

export type SituacaoFalta =
  /** Não desconta: o motivo justifica a ausência. */
  | "abonada"
  /** Desconta a jornada prevista do dia. */
  | "descontada"
  /** Atestado alegado e ainda não revisado. Não desconta nem abona. */
  | "aguardando";

/** O mínimo que o cálculo precisa saber de uma ocorrência. */
export interface OcorrenciaParaCalculo {
  tipo: TipoOcorrencia;
  motivo?: MotivoFalta | null;
  aprovadoEm?: Date | string | null;
}

/** A situação de UMA falta. null quando a ocorrência não é falta. */
export function situacaoDaFalta(o: OcorrenciaParaCalculo): SituacaoFalta | null {
  if (o.tipo !== "falta") return null;
  const motivo = o.motivo ?? null;
  if (!motivo) return "aguardando";
  if (motivo === "injustificada") return "descontada";
  if (dependeDeAprovacao(motivo)) return o.aprovadoEm ? "abonada" : "aguardando";
  return "abonada";
}

/**
 * A situação da falta DO DIA, quando há mais de uma ocorrência nele.
 *
 * A ordem de prevalência é a do estrago: descontada ganha de aguardando, que
 * ganha de abonada. Um dia que tem uma falta injustificada e uma folga
 * lançadas juntas é um dia com problema, e resolver o empate pelo caso mais
 * leve esconderia justamente a linha que precisa de conversa.
 */
export function situacaoDoDia(ocorrencias: OcorrenciaParaCalculo[]): SituacaoFalta | null {
  let achou: SituacaoFalta | null = null;
  for (const o of ocorrencias) {
    const s = situacaoDaFalta(o);
    if (!s) continue;
    if (s === "descontada") return "descontada";
    if (s === "aguardando") achou = "aguardando";
    else if (achou == null) achou = "abonada";
  }
  return achou;
}

export interface ContagemFaltas {
  total: number;
  abonadas: number;
  descontadas: number;
  aguardando: number;
}

/** Conta faltas por DIA, não por linha: duas lançadas no mesmo dia são um dia
 *  de ausência, e somar as linhas inflaria o número que vai pro RH. */
export function contarFaltas(
  ocorrencias: Array<OcorrenciaParaCalculo & { dia: string }>,
): ContagemFaltas {
  const porDia = new Map<string, OcorrenciaParaCalculo[]>();
  for (const o of ocorrencias) {
    if (o.tipo !== "falta") continue;
    const lista = porDia.get(o.dia) ?? [];
    lista.push(o);
    porDia.set(o.dia, lista);
  }

  const c: ContagemFaltas = { total: 0, abonadas: 0, descontadas: 0, aguardando: 0 };
  for (const lista of porDia.values()) {
    const s = situacaoDoDia(lista);
    if (!s) continue;
    c.total++;
    if (s === "abonada") c.abonadas++;
    else if (s === "descontada") c.descontadas++;
    else c.aguardando++;
  }
  return c;
}
