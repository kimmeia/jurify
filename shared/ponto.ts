/**
 * Ponto digital — o cálculo da jornada de um dia.
 *
 * A ideia de origem era "pegar o horário que ele loga e desloga". A entrada
 * funciona: ninguém trabalha sem entrar no sistema. A saída não — quase
 * ninguém clica em "sair". Fecha o navegador, a sessão expira, o computador
 * dorme. Marcar a saída pelo logout registraria nada pra quem fechou o
 * notebook e 23 horas pra quem deixou a aba aberta. Folha de ponto errada é
 * pior que folha de ponto nenhuma: a errada é assinada.
 *
 * Então a saída tem três procedências, e o espelho mostra qual foi:
 *
 *  - `registrada` — a pessoa clicou em sair. É o único caso de fato batido;
 *  - `atividade`  — o último sinal de vida no sistema naquele dia. É
 *                   aproximação, e vai marcada como tal;
 *  - `manual`     — o gestor corrigiu. Vira fato, com nome e motivo ao lado.
 *
 * E duas recusas explícitas, que são o coração do arquivo:
 *
 *  1. dia com entrada e NENHUM sinal posterior não vira jornada. Não há de
 *     onde tirar a saída, e inventar uma seria assinar hora que ninguém
 *     conferiu. O dia fica aberto e aparece pro gestor resolver;
 *  2. jornada derivada de atividade que passe do teto não é aceita em
 *     silêncio nem truncada em silêncio — ela é marcada pra revisão. É o caso
 *     da aba esquecida aberta, e quem decide o que fazer com ela é o gestor.
 */

export type OrigemEntrada = "login" | "manual";
export type OrigemSaida = "registrada" | "atividade" | "manual";

/**
 * Acima disto, uma jornada derivada da última atividade quase certamente é
 * aba esquecida aberta, não expediente. Doze horas passam de qualquer jornada
 * legal com hora extra, então o falso positivo é raro e o falso negativo
 * (aceitar 23h calado) é o que não pode acontecer.
 */
export const HORAS_PARA_REVISAR = 12;

export interface DiaPontoBruto {
  dia: string;
  entradaEm: Date | string | null;
  entradaOrigem?: OrigemEntrada | null;
  pausaInicioEm: Date | string | null;
  pausaFimEm: Date | string | null;
  saidaEm: Date | string | null;
  saidaOrigem?: OrigemSaida | null;
  ultimaAtividadeEm: Date | string | null;
}

export type StatusDia =
  /** Entrou e saiu (ou deu pra inferir a saída). Conta pro total do mês. */
  | "fechado"
  /** Entrou hoje e ainda está trabalhando. */
  | "em_andamento"
  /** Entrou, nunca saiu, e não há atividade que sirva de saída. */
  | "sem_saida"
  /** Saída antes da entrada — só acontece por ajuste errado. */
  | "inconsistente"
  /** Jornada derivada longa demais pra ser expediente. */
  | "revisar"
  /** Nenhum registro no dia. */
  | "sem_registro";

export interface Jornada {
  dia: string;
  entrada: Date | null;
  entradaOrigem: OrigemEntrada | null;
  saida: Date | null;
  saidaOrigem: OrigemSaida | null;
  /** Minutos entre entrada e saída, já descontada a pausa fechada. null
   *  quando não dá pra afirmar. */
  minutos: number | null;
  minutosPausa: number;
  /** Saiu pro almoço e ainda não voltou a marcar. */
  pausaAberta: boolean;
  status: StatusDia;
  /** O que o gestor precisa saber sobre este dia, em português. */
  avisos: string[];
}

function data(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Calcula a jornada de um dia.
 *
 * `agora` entra por parâmetro (e não de `new Date()` lá dentro) porque o mesmo
 * dia rende resultados diferentes conforme o instante da leitura — "ainda está
 * trabalhando" só existe hoje — e função que lê o relógio sozinha não é
 * testável.
 */
export function calcularJornada(bruto: DiaPontoBruto, agora: Date): Jornada {
  const entrada = data(bruto.entradaEm);
  const pausaInicio = data(bruto.pausaInicioEm);
  const pausaFim = data(bruto.pausaFimEm);
  const saidaRegistrada = data(bruto.saidaEm);
  const atividade = data(bruto.ultimaAtividadeEm);
  const avisos: string[] = [];

  const vazio: Jornada = {
    dia: bruto.dia,
    entrada: null,
    entradaOrigem: null,
    saida: null,
    saidaOrigem: null,
    minutos: null,
    minutosPausa: 0,
    pausaAberta: false,
    status: "sem_registro",
    avisos: [],
  };
  if (!entrada) return vazio;

  // Pausa só desconta quando fechou. Pausa aberta não some com o resto do dia:
  // quem saiu pro almoço e não voltou a marcar tem uma pausa a corrigir, não
  // uma tarde inteira apagada.
  let minutosPausa = 0;
  if (pausaInicio && pausaFim && pausaFim > pausaInicio) {
    minutosPausa = Math.round((pausaFim.getTime() - pausaInicio.getTime()) / 60000);
  } else if (pausaInicio && !pausaFim) {
    avisos.push("Pausa iniciada e não encerrada — o intervalo não foi descontado.");
  } else if (pausaInicio && pausaFim && pausaFim <= pausaInicio) {
    avisos.push("Retorno da pausa anterior ao início — intervalo ignorado.");
  }

  const base = {
    dia: bruto.dia,
    entrada,
    entradaOrigem: bruto.entradaOrigem ?? null,
    minutosPausa,
    pausaAberta: !!pausaInicio && !pausaFim,
  };

  // Saída batida ou corrigida pelo gestor: é fato.
  if (saidaRegistrada) {
    if (saidaRegistrada < entrada) {
      return {
        ...base,
        saida: saidaRegistrada,
        saidaOrigem: bruto.saidaOrigem ?? "registrada",
        minutos: null,
        status: "inconsistente",
        avisos: [...avisos, "Saída anterior à entrada — corrija o registro."],
      };
    }
    const minutos = Math.max(
      Math.round((saidaRegistrada.getTime() - entrada.getTime()) / 60000) - minutosPausa,
      0,
    );
    return {
      ...base,
      saida: saidaRegistrada,
      saidaOrigem: bruto.saidaOrigem ?? "registrada",
      minutos,
      status: "fechado",
      avisos,
    };
  }

  // Sem saída batida. Só há duas respostas honestas: "ainda trabalhando" ou
  // "a última atividade foi às tantas". Nunca "trabalhou até agora".
  // "Ainda trabalhando" é sinal de vida recente, não o dia do calendário: quem
  // vira a madrugada num prazo continua em expediente depois da meia-noite.
  const AINDA_ONLINE_MIN = 15;
  if (atividade && agora.getTime() - atividade.getTime() < AINDA_ONLINE_MIN * 60000) {
    return {
      ...base,
      saida: null,
      saidaOrigem: null,
      minutos: null,
      status: "em_andamento",
      avisos,
    };
  }

  if (!atividade || atividade <= entrada) {
    return {
      ...base,
      saida: null,
      saidaOrigem: null,
      minutos: null,
      status: "sem_saida",
      avisos: [
        ...avisos,
        "Sem saída registrada e sem atividade posterior à entrada — o gestor precisa lançar a saída.",
      ],
    };
  }

  const minutos = Math.max(
    Math.round((atividade.getTime() - entrada.getTime()) / 60000) - minutosPausa,
    0,
  );
  const derivada: Jornada = {
    ...base,
    saida: atividade,
    saidaOrigem: "atividade",
    minutos,
    status: "fechado",
    avisos: [...avisos, "Saída não registrada — considerada a última atividade no sistema."],
  };

  if (minutos > HORAS_PARA_REVISAR * 60) {
    return {
      ...derivada,
      status: "revisar",
      avisos: [
        ...avisos,
        `Jornada de ${formatarDuracao(minutos)} deduzida da última atividade — provavelmente o sistema ficou aberto. Confirme ou corrija.`,
      ],
    };
  }

  return derivada;
}

/** "8h12" / "45min". A unidade que se lê num espelho de ponto. */
export function formatarDuracao(minutos: number | null): string {
  if (minutos == null) return "—";
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/**
 * O dia civil de um instante, no deslocamento do escritório.
 *
 * O "dia" do ponto é o dia de quem trabalha, não o dia UTC: às 21h em
 * Fortaleza já é o dia seguinte em UTC, e o expediente de terça viraria
 * quarta na tabela.
 */
export function diaLocalISO(instante: Date, offsetMinutos: number): string {
  const deslocado = new Date(instante.getTime() + offsetMinutos * 60000);
  return deslocado.toISOString().slice(0, 10);
}

/** Dia que o gestor precisa resolver antes de a folha valer. */
export function ehPendente(status: StatusDia): boolean {
  return status === "sem_saida" || status === "inconsistente" || status === "revisar";
}

/** Soma os minutos dos dias que fecharam. Dia aberto não entra: somar o que
 *  não se sabe produz um total que ninguém consegue conferir. */
export function totalDoPeriodo(jornadas: Jornada[]): {
  minutos: number;
  diasFechados: number;
  diasPendentes: number;
} {
  let minutos = 0;
  let diasFechados = 0;
  let diasPendentes = 0;
  for (const j of jornadas) {
    if (j.status === "fechado" && j.minutos != null) {
      minutos += j.minutos;
      diasFechados++;
    } else if (ehPendente(j.status)) {
      diasPendentes++;
    }
  }
  return { minutos, diasFechados, diasPendentes };
}
