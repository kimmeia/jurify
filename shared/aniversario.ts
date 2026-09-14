/**
 * Aniversário do cliente — as regras, sem banco e sem relógio.
 *
 * Tudo aqui trabalha com data de CALENDÁRIO no formato `YYYY-MM-DD`, a mesma
 * régua de `data-calendario.ts`: um aniversário é um DIA, não um instante.
 * Ler "1985-03-12" como instante e formatar no fuso do navegador mostra 11 de
 * março para metade do Brasil — foi esse o defeito corrigido em 03/09 nas
 * outras datas do sistema, e ele não volta aqui.
 *
 * Duas decisões que o resto depende:
 *
 * 1. **29 de fevereiro cai em 28 de fevereiro** nos anos que não têm o dia 29.
 *    A alternativa (1º de março) atrasa o cumprimento e, pior, muda de mês.
 * 2. **Idade só aparece quando o ano é conhecido.** Quem cadastra só o dia e o
 *    mês (acontece: o cliente diz "faço em 12 de março") não deve ver uma
 *    idade inventada — o rótulo simplesmente não fala em anos.
 */

const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Ano mais antigo aceito. Antes disso é erro de digitação, não centenário. */
export const ANO_MINIMO = 1900;

export interface PartesData {
  ano: number;
  mes: number;
  dia: number;
}

/** Quebra `YYYY-MM-DD` em partes, ou null quando não é uma data de verdade. */
export function partesDaData(iso: string | null | undefined): PartesData | null {
  if (!iso) return null;
  const m = SO_DATA.exec(iso.slice(0, 10));
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  // Rejeita 31 de fevereiro e companhia: o Date normaliza em silêncio para o
  // mês seguinte, e uma data que "existe" errada é pior do que uma recusada.
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return { ano, mes, dia };
}

export type MotivoDataInvalida = "formato" | "antiga" | "futuro";

/**
 * A data serve como nascimento? `hoje` entra por parâmetro — nascimento no
 * futuro é erro de digitação e precisa de um "hoje" para ser detectado.
 */
export function validarNascimento(
  iso: string | null | undefined,
  hoje: string,
): { ok: true } | { ok: false; motivo: MotivoDataInvalida } {
  const p = partesDaData(iso);
  if (!p) return { ok: false, motivo: "formato" };
  if (p.ano < ANO_MINIMO) return { ok: false, motivo: "antiga" };
  if (iso!.slice(0, 10) > hoje) return { ok: false, motivo: "futuro" };
  return { ok: true };
}

export const MENSAGEM_DATA_INVALIDA: Record<MotivoDataInvalida, string> = {
  formato: "Data de nascimento inválida.",
  antiga: `Data de nascimento anterior a ${ANO_MINIMO} — confira o ano.`,
  futuro: "Data de nascimento no futuro — confira o ano.",
};

/** Dias de cada mês num ano — fevereiro depende do ano. */
function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Em que dia o aniversário é COMEMORADO naquele ano.
 *
 * Só muda alguma coisa para quem nasceu em 29 de fevereiro: nos outros anos
 * cai em 28 de fevereiro.
 */
export function diaComemoradoNoAno(nasc: PartesData, ano: number): string {
  const dia = Math.min(nasc.dia, diasNoMes(ano, nasc.mes));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ano}-${pad(nasc.mes)}-${pad(dia)}`;
}

/** Diferença em dias entre duas datas de calendário (b − a). */
export function diasEntre(a: string, b: string): number {
  const pa = partesDaData(a);
  const pb = partesDaData(b);
  if (!pa || !pb) return 0;
  const ma = Date.UTC(pa.ano, pa.mes - 1, pa.dia);
  const mb = Date.UTC(pb.ano, pb.mes - 1, pb.dia);
  return Math.round((mb - ma) / 86_400_000);
}

export interface Aniversario {
  /** O dia em que cai neste ciclo, `YYYY-MM-DD`. */
  proximo: string;
  /** 0 = é hoje. Nunca negativo: passou, já é o do ano que vem. */
  diasAte: number;
  ehHoje: boolean;
  /** Idade que completa no `proximo`. null quando o ano não é conhecido. */
  faraIdade: number | null;
  /** Idade hoje. null quando o ano não é conhecido. */
  idadeHoje: number | null;
  mes: number;
  dia: number;
}

/**
 * Quando é o próximo aniversário, a partir de `hoje`.
 *
 * O aniversário DE HOJE é o próximo: quem faz hoje não pode ser empurrado
 * para o ano que vem, que é o jeito errado de errar aqui.
 */
export function proximoAniversario(
  nascimentoIso: string | null | undefined,
  hoje: string,
): Aniversario | null {
  const nasc = partesDaData(nascimentoIso);
  const h = partesDaData(hoje);
  if (!nasc || !h) return null;

  let proximo = diaComemoradoNoAno(nasc, h.ano);
  if (proximo < hoje) proximo = diaComemoradoNoAno(nasc, h.ano + 1);

  const anoConhecido = nasc.ano >= ANO_MINIMO && nasc.ano <= h.ano;
  const anoDoProximo = Number(proximo.slice(0, 4));
  const faraIdade = anoConhecido ? anoDoProximo - nasc.ano : null;
  const jaFezEsteAno = diaComemoradoNoAno(nasc, h.ano) <= hoje;
  const idadeHoje = anoConhecido ? h.ano - nasc.ano - (jaFezEsteAno ? 0 : 1) : null;

  return {
    proximo,
    diasAte: diasEntre(hoje, proximo),
    ehHoje: proximo === hoje,
    faraIdade,
    idadeHoje,
    mes: nasc.mes,
    dia: nasc.dia,
  };
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "12 de março" — o dia do aniversário, sem ano. */
export function diaEMes(a: Aniversario): string {
  return `${a.dia} de ${MESES[a.mes - 1]}`;
}

/**
 * A frase que o cartão mostra.
 *
 * Perto, ela conta os dias; longe, ela só diz a data e a idade. É a mesma
 * função nos dois casos para o texto não divergir entre a ficha e a lista.
 */
export function rotuloAniversario(a: Aniversario): string {
  const anos = a.faraIdade != null ? ` ${a.faraIdade} anos` : "";
  if (a.ehHoje) return a.faraIdade != null ? `Faz ${a.faraIdade} anos hoje` : "Aniversário é hoje";
  if (a.diasAte === 1) return anos ? `Faz${anos} amanhã` : "Aniversário é amanhã";
  if (a.diasAte <= JANELA_PROXIMO_DIAS) {
    return anos ? `Faz${anos} em ${a.diasAte} dias` : `Aniversário em ${a.diasAte} dias`;
  }
  const idade = a.idadeHoje != null ? ` · ${a.idadeHoje} anos` : "";
  return `${diaEMes(a)}${idade}`;
}

/** Até quantos dias antes o cartão troca a data pela contagem regressiva. */
export const JANELA_PROXIMO_DIAS = 7;

/** O aniversário está perto o bastante para merecer destaque? */
export function estaProximo(a: Aniversario | null): boolean {
  return !!a && a.diasAte <= JANELA_PROXIMO_DIAS;
}

export type FiltroAniversario = "hoje" | "semana" | "mes";

export const FILTRO_ANIVERSARIO_ROTULO: Record<FiltroAniversario, string> = {
  hoje: "Aniversário hoje",
  semana: "Nos próximos 7 dias",
  mes: "Neste mês",
};

/** O cadastro entra no filtro escolhido? Regra pura — a tela e o servidor usam a MESMA. */
export function passaNoFiltro(
  nascimentoIso: string | null | undefined,
  filtro: FiltroAniversario,
  hoje: string,
): boolean {
  const a = proximoAniversario(nascimentoIso, hoje);
  if (!a) return false;
  if (filtro === "hoje") return a.ehHoje;
  if (filtro === "semana") return a.diasAte <= JANELA_PROXIMO_DIAS;
  const h = partesDaData(hoje);
  return !!h && a.mes === h.mes;
}

/**
 * Prefixo fixo do título do lembrete.
 *
 * É por ele que o cron sabe que já mandou hoje: a memória do processo morre
 * num redeploy, e um redeploy às 8h da manhã mandaria o aviso duas vezes. O
 * título gravado no sino é o registro que sobrevive, então ele precisa ser
 * reconhecível — os dois títulos abaixo começam com esta palavra.
 */
export const PREFIXO_TITULO_ANIVERSARIO = "Aniversário";

/**
 * O texto do lembrete do dia.
 *
 * Um aviso só por dia, com todo mundo dentro: cinco aniversários não podem
 * virar cinco toques no celular — é assim que a pessoa desliga o aviso inteiro
 * e perde junto o que importava.
 */
export function resumoDoDia(nomes: string[]): { titulo: string; mensagem: string } | null {
  if (nomes.length === 0) return null;
  if (nomes.length === 1) {
    return { titulo: `${PREFIXO_TITULO_ANIVERSARIO} hoje`, mensagem: `${nomes[0]} faz aniversário hoje.` };
  }
  const primeiros = nomes.slice(0, 3);
  const resto = nomes.length - primeiros.length;
  // Com todo mundo na lista, o último nome vem com "e" — a vírgula seca lê
  // como se a frase tivesse sido cortada. Quando sobra gente, quem fecha a
  // enumeração é o "e mais N".
  const lista =
    resto > 0
      ? `${primeiros.join(", ")} e mais ${resto}`
      : `${primeiros.slice(0, -1).join(", ")} e ${primeiros[primeiros.length - 1]}`;
  return {
    titulo: `${PREFIXO_TITULO_ANIVERSARIO}s hoje`,
    mensagem: `${lista} fazem aniversário hoje.`,
  };
}

/**
 * O texto sugerido dos parabéns.
 *
 * Sai como sugestão editável num link `wa.me`, aberto no WhatsApp de QUEM
 * clicou. Não é disparo da plataforma: mensagem proativa pelo número do
 * escritório é outro assunto, e é o padrão que gerou os avisos da Meta.
 */
export function mensagemParabens(nome: string, escritorio?: string | null): string {
  const primeiro = (nome || "").trim().split(/\s+/)[0] || "";
  const assinatura = escritorio ? ` Um abraço de todos nós do ${escritorio}!` : "";
  return `Feliz aniversário, ${primeiro}! Que seu dia seja ótimo.${assinatura}`;
}
