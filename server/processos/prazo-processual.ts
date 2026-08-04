/**
 * Contagem de prazo processual pelas regras do CPC.
 *
 * O painel só ganha autoridade se, ao dizer "vence 17/08", mostrar de onde
 * tirou a data. Antes o sistema somava 5 dias úteis com `addBusinessDays` do
 * date-fns direto no client — o que ignora as três regras que mais mudam o
 * resultado na prática:
 *
 *   art. 224, §1º — intimação em dia não útil conta como feita no primeiro
 *                   dia útil seguinte; vencimento em dia não útil prorroga.
 *   art. 224, caput — a contagem começa no dia útil SEGUINTE à intimação
 *                   (o dia do começo não entra).
 *   art. 219      — prazo processual em dias úteis (o material, não).
 *   art. 220      — recesso: os dias entre 20/12 e 20/01, inclusive, não
 *                   correm.
 *
 * Feriado local (do tribunal, do município) não está aqui — o CPC deixa isso
 * pro regimento de cada tribunal e não existe fonte confiável embutida. Por
 * isso `feriadosExtras` é parâmetro e o resultado sempre carrega as
 * observações que o advogado precisa conferir: a conta é uma sugestão
 * fundamentada, não um substituto do olho dele.
 */

import { feriadosNacionaisBR } from "../_core/feriados-br";

export type ResultadoPrazo = {
  /** Primeiro dia que efetivamente conta. */
  inicio: Date;
  /** Último dia para praticar o ato. */
  vencimento: Date;
  /** Regras que influenciaram esta conta — vão pra UI. */
  observacoes: string[];
  /** Artigos citados, na ordem em que se aplicaram. */
  fundamentos: string[];
};

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Normaliza pra meia-noite UTC — a contagem é por dia de calendário, e
 *  manter hora local aqui faria a virada de dia depender do fuso do servidor. */
function diaUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function somarDias(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Recesso do art. 220: 20/12 a 20/01, inclusive nas duas pontas. */
export function emRecessoForense(d: Date): boolean {
  const mes = d.getUTCMonth() + 1;
  const dia = d.getUTCDate();
  return (mes === 12 && dia >= 20) || (mes === 1 && dia <= 20);
}

/**
 * Cache de feriados por ano. `feriadosNacionaisBR` roda o Computus a cada
 * chamada, e uma contagem de 30 dias consulta o mesmo ano dezenas de vezes.
 */
const cacheFeriados = new Map<number, Set<string>>();

function feriadosDoAno(ano: number): Set<string> {
  let s = cacheFeriados.get(ano);
  if (!s) {
    s = new Set(feriadosNacionaisBR(ano).map((f) => f.data));
    cacheFeriados.set(ano, s);
  }
  return s;
}

export function ehDiaUtil(d: Date, feriadosExtras?: Set<string>): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const chave = iso(d);
  if (feriadosDoAno(d.getUTCFullYear()).has(chave)) return false;
  if (feriadosExtras?.has(chave)) return false;
  return true;
}

/** Primeiro dia útil em que o prazo pode correr (pula fim de semana,
 *  feriado e recesso). */
function proximoDiaCorrente(d: Date, feriadosExtras?: Set<string>): Date {
  let cur = d;
  // 40 dias cobre com folga o pior caso (recesso inteiro + feriado colado).
  for (let i = 0; i < 40; i++) {
    if (ehDiaUtil(cur, feriadosExtras) && !emRecessoForense(cur)) return cur;
    cur = somarDias(cur, 1);
  }
  return cur;
}

/**
 * Calcula o vencimento de um prazo.
 *
 * @param dataIntimacao  quando a parte foi intimada (data do evento)
 * @param dias           quantidade do prazo
 * @param uteis          true = dias úteis (art. 219), false = corridos
 * @param feriadosExtras datas YYYY-MM-DD de feriado local do tribunal
 */
export function contarPrazoProcessual(
  dataIntimacao: Date,
  dias: number,
  uteis: boolean,
  feriadosExtras?: string[],
): ResultadoPrazo {
  const extras = feriadosExtras?.length ? new Set(feriadosExtras) : undefined;
  const observacoes: string[] = [];
  const fundamentos: string[] = [];

  const intimacao = diaUtc(dataIntimacao);

  // §1º: intimação em dia não útil → considera-se feita no 1º dia útil seguinte.
  let intimacaoEficaz = intimacao;
  if (!ehDiaUtil(intimacao, extras) || emRecessoForense(intimacao)) {
    intimacaoEficaz = proximoDiaCorrente(intimacao, extras);
    observacoes.push(
      `Intimação em ${iso(intimacao)} caiu em dia sem expediente — considerada feita em ${iso(intimacaoEficaz)}.`,
    );
    fundamentos.push("art. 224, §1º, do CPC");
  }

  // Caput: o dia do começo não entra; conta do dia útil seguinte.
  const inicio = proximoDiaCorrente(somarDias(intimacaoEficaz, 1), extras);
  fundamentos.push("art. 224 do CPC (exclui o dia do começo)");

  let vencimento = inicio;
  let contados = 1; // `inicio` já é o dia 1
  let cur = inicio;
  let passouRecesso = false;

  const limite = dias * 6 + 60; // teto de segurança contra loop infinito
  let passos = 0;

  while (contados < dias && passos < limite) {
    cur = somarDias(cur, 1);
    passos++;
    if (emRecessoForense(cur)) {
      passouRecesso = true;
      continue;
    }
    if (uteis && !ehDiaUtil(cur, extras)) continue;
    contados++;
  }
  vencimento = cur;

  if (uteis) fundamentos.push("art. 219 do CPC (dias úteis)");
  if (passouRecesso) {
    observacoes.push("O prazo atravessou o recesso forense (20/12 a 20/01) e ficou suspenso nesse período.");
    fundamentos.push("art. 220 do CPC");
  }

  // §1º de novo: vencimento em dia sem expediente prorroga pro seguinte.
  if (!ehDiaUtil(vencimento, extras) || emRecessoForense(vencimento)) {
    const prorrogado = proximoDiaCorrente(vencimento, extras);
    observacoes.push(
      `Vencimento cairia em ${iso(vencimento)}, sem expediente — prorrogado para ${iso(prorrogado)}.`,
    );
    if (!fundamentos.includes("art. 224, §1º, do CPC")) fundamentos.push("art. 224, §1º, do CPC");
    vencimento = prorrogado;
  }

  observacoes.push(
    "Feriado local do tribunal e suspensão específica do processo não entram nesta conta — confira antes de peticionar.",
  );

  return { inicio, vencimento, observacoes, fundamentos };
}

/** Dias úteis restantes entre hoje e o vencimento (negativo = já venceu). */
export function diasUteisAte(vencimento: Date, hoje: Date, feriadosExtras?: string[]): number {
  const extras = feriadosExtras?.length ? new Set(feriadosExtras) : undefined;
  const alvo = diaUtc(vencimento);
  const base = diaUtc(hoje);
  if (alvo.getTime() === base.getTime()) return 0;

  const sentido = alvo > base ? 1 : -1;
  let cur = base;
  let n = 0;
  for (let i = 0; i < 4000 && cur.getTime() !== alvo.getTime(); i++) {
    cur = somarDias(cur, sentido);
    if (ehDiaUtil(cur, extras) && !emRecessoForense(cur)) n++;
  }
  return n * sentido;
}
