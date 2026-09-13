/**
 * Semáforos da "Visão rápida" de Saúde do sistema.
 *
 * Cada função recebe dados JÁ carregados e devolve uma cor, um título e uma
 * frase em português — a tela só desenha. Nada aqui lê relógio: `agora`
 * chega por parâmetro, senão "rodou hoje" vira um teste que passa de manhã
 * e falha à noite.
 *
 * O ponto de partida foi a pergunta do dono: "esse robô funciona?". Os
 * números ("5", "19", "32 s") não respondem isso; a frase responde.
 */

export type CorSemaforo = "verde" | "ambar" | "vermelho" | "cinza";

export type TipoAcaoSemaforo =
  | "aba_erros"
  | "rodar_auditor"
  | "aba_auditor"
  | "rodar_jornada"
  | "aba_jornada";

export interface AcaoSemaforo {
  rotulo: string;
  tipo: TipoAcaoSemaforo;
}

export interface Semaforo {
  cor: CorSemaforo;
  titulo: string;
  frase: string;
  acao?: AcaoSemaforo;
}

/**
 * Abaixo disto por tela, o robô de jornada não esperou a tela montar. A régua
 * nasceu do caso real: 19 telas em 32 s (1,7 s por tela) enquanto a barra de
 * créditos era lida como "carregando" e a tela pulada.
 */
export const MS_POR_TELA_MINIMO = 2000;

/** O auditor roda de madrugada; 36 h cobre um dia perdido com folga. */
export const HORAS_SEM_RODAR_MAXIMO = 36;

/** Quantas varreduras seguidas com os mesmos achados viram "parado". */
export const VARREDURAS_PARA_REPETICAO = 3;

const MS_POR_HORA = 60 * 60 * 1000;

/**
 * A captura de erros do SERVIDOR só existe com a DSN na variável de ambiente
 * (`initSentry` desliga sem ela). O painel dizia "conectado" olhando o token
 * da API de leitura — que é outra coisa: com ele dá pra LER issues, mas sem a
 * DSN nenhum erro do backend chega lá pra ser lido.
 *
 * A régua é a MESMA de `initSentry` (`SENTRY_DSN_BACKEND || SENTRY_DSN`): só a
 * genérica no Railway liga a captura, e a tela dizia que não.
 */
export function capturaSentryConfigurada(env: Record<string, string | undefined>): boolean {
  return Boolean((env.SENTRY_DSN_BACKEND || env.SENTRY_DSN)?.trim());
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

export function horaCurta(iso: string, fuso?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: fuso });
}

function diaCivil(d: Date, fuso?: string): string {
  return d.toLocaleDateString("pt-BR", { timeZone: fuso });
}

function diaCurto(iso: string, fuso?: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: fuso });
}

/** "hoje às 03:00", "ontem às 03:00", "em 10/09 às 03:00". */
export function quandoRodou(iso: string, agora: Date, fuso?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "em data desconhecida";
  const dia = diaCivil(d, fuso);
  if (dia === diaCivil(agora, fuso)) return `hoje às ${horaCurta(iso, fuso)}`;
  if (dia === diaCivil(new Date(agora.getTime() - 24 * MS_POR_HORA), fuso)) {
    return `ontem às ${horaCurta(iso, fuso)}`;
  }
  return `em ${diaCurto(iso, fuso)} às ${horaCurta(iso, fuso)}`;
}

export function tempoRelativoSemaforo(iso: string, agora: Date): string {
  const ms = agora.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h}h`;
  return `há ${Math.round(h / 24)}d`;
}

// ---------------------------------------------------------------------------
// 1. Erros no sistema
// ---------------------------------------------------------------------------

export interface EntradaErros {
  capturaConfigurada: boolean;
  abertos: number;
  ultimoErroEm: string | null;
  /**
   * `motivo` de `adminErros.listar` quando a LEITURA não aconteceu (sem token,
   * timeout, HTTP). Sem isto, "0 abertos" ficaria verde com o Sentry fora do ar.
   */
  leituraFalhou?: string | null;
  /**
   * `adminErros.listar` devolve UMA página: `abertos` é o tamanho dela, não o
   * total do Sentry. Página cheia = "25+", senão a frase afirma uma contagem
   * que não mediu.
   */
  totalMinimo?: boolean;
}

export function motivoLeituraLegivel(motivo: string): string {
  if (motivo === "sentry_nao_configurado") return "o token da API não está cadastrado em Integrações";
  if (motivo === "timeout") return "o Sentry demorou demais pra responder";
  if (motivo === "erro_rede") return "erro de rede ao consultar o Sentry";
  if (motivo.startsWith("sentry_http_")) return `o Sentry respondeu HTTP ${motivo.slice("sentry_http_".length)}`;
  return motivo;
}

export function semaforoErros(e: EntradaErros, agora: Date): Semaforo {
  if (e.abertos > 0) {
    const ultimo = e.ultimoErroEm ? `, o último visto ${tempoRelativoSemaforo(e.ultimoErroEm, agora)}` : "";
    const abertos = e.totalMinimo
      ? `${e.abertos}+ erros abertos`
      : plural(e.abertos, "erro aberto", "erros abertos");
    const naoResolvidos = e.totalMinimo
      ? `Pelo menos ${e.abertos} erros não resolvidos`
      : plural(e.abertos, "erro não resolvido", "erros não resolvidos");
    return {
      cor: "vermelho",
      titulo: `Erros no sistema — ${abertos}`,
      frase: `${naoResolvidos} no Sentry${ultimo}.`,
      acao: { rotulo: "Ver os erros", tipo: "aba_erros" },
    };
  }
  if (e.leituraFalhou) {
    return {
      cor: "ambar",
      titulo: "Erros no sistema — não dá pra afirmar",
      frase: `Não deu pra ler o Sentry agora: ${motivoLeituraLegivel(e.leituraFalhou)}. Até ler, "zero" não prova nada.`,
      acao: { rotulo: "Ver a aba Erros", tipo: "aba_erros" },
    };
  }
  if (!e.capturaConfigurada) {
    return {
      cor: "ambar",
      titulo: "Erros no sistema — não dá pra afirmar",
      frase:
        "Nenhum erro chegou, mas a captura do servidor (Sentry) não está confirmada: nem SENTRY_DSN_BACKEND nem SENTRY_DSN estão no Railway. Enquanto isso, \"zero\" não prova nada.",
      acao: { rotulo: "Como confirmar", tipo: "aba_erros" },
    };
  }
  return {
    cor: "verde",
    titulo: "Erros no sistema — nenhum erro aberto",
    frase: "A captura do servidor está ligada e não há erro não resolvido no Sentry.",
    acao: { rotulo: "Ver os erros", tipo: "aba_erros" },
  };
}

// ---------------------------------------------------------------------------
// 2. Robô auditor
// ---------------------------------------------------------------------------

export interface RegraAuditorSemaforo {
  id: string;
  total: number;
  erro?: string;
}

/** O que o semáforo precisa de cada linha de `adminRoboAuditor.historico`. */
export interface VarreduraAuditorSemaforo {
  iniciadoEm: string;
  achados: number;
  regrasComErro: number;
  regras?: RegraAuditorSemaforo[];
}

export interface Repeticao {
  repetido: boolean;
  /** Por onde a comparação foi feita — a frase diz qual. */
  criterio: "regras" | "numero" | null;
  achados: number;
  /** Início da varredura mais antiga do trio — "parado desde". */
  desde: string | null;
}

function idsVioladas(v: VarreduraAuditorSemaforo): string[] | null {
  if (!v.regras || v.regras.length === 0) return null;
  return v.regras
    .filter((r) => r.total > 0 && !r.erro)
    .map((r) => r.id)
    .sort();
}

/**
 * Achado que se repete é o que ninguém está olhando. Compara pelas regras
 * violadas quando o histórico as traz (é o que diz "os MESMOS 5"); sem
 * isso, cai pro número — e a frase avisa qual dos dois usou.
 */
export function achadosRepetidos(
  varreduras: VarreduraAuditorSemaforo[],
  minimo = VARREDURAS_PARA_REPETICAO,
): Repeticao {
  const nada: Repeticao = { repetido: false, criterio: null, achados: 0, desde: null };
  const trio = varreduras.slice(0, minimo);
  if (trio.length < minimo) return nada;
  if (trio.some((v) => v.achados <= 0)) return nada;

  const ids = trio.map(idsVioladas);
  if (ids.every((l): l is string[] => l !== null)) {
    const chave = ids[0].join("|");
    if (ids.every((l) => l.join("|") === chave)) {
      return { repetido: true, criterio: "regras", achados: trio[0].achados, desde: trio[trio.length - 1].iniciadoEm };
    }
    return nada;
  }

  const naoCaiu = trio.every((v, i) => i === 0 || trio[i - 1].achados >= v.achados);
  if (!naoCaiu) return nada;
  return { repetido: true, criterio: "numero", achados: trio[0].achados, desde: trio[trio.length - 1].iniciadoEm };
}

/**
 * "de ontem e de anteontem" só quando é verdade — o auditor roda de madrugada,
 * mas também sob demanda, e três cliques no mesmo dia não são três dias.
 */
function rotuloAnteriores(varreduras: VarreduraAuditorSemaforo[], agora: Date, fuso?: string): string {
  const ontem = diaCivil(new Date(agora.getTime() - 24 * MS_POR_HORA), fuso);
  const anteontem = diaCivil(new Date(agora.getTime() - 48 * MS_POR_HORA), fuso);
  const [, segunda, terceira] = varreduras;
  if (
    segunda &&
    terceira &&
    diaCivil(new Date(segunda.iniciadoEm), fuso) === ontem &&
    diaCivil(new Date(terceira.iniciadoEm), fuso) === anteontem
  ) {
    return "de ontem e de anteontem";
  }
  return `das 2 varreduras anteriores${terceira ? ` (desde ${diaCurto(terceira.iniciadoEm, fuso)})` : ""}`;
}

export function semaforoAuditor(
  varreduras: VarreduraAuditorSemaforo[],
  agora: Date,
  fuso?: string,
): Semaforo {
  const ultima = varreduras[0];
  if (!ultima) {
    return {
      cor: "cinza",
      titulo: "Robô auditor — ainda não rodou",
      frase: "Nenhuma varredura registrada. A primeira leva menos de um minuto.",
      acao: { rotulo: "Rodar varredura", tipo: "rodar_auditor" },
    };
  }

  const horasParado = (agora.getTime() - new Date(ultima.iniciadoEm).getTime()) / MS_POR_HORA;
  if (horasParado > HORAS_SEM_RODAR_MAXIMO) {
    return {
      cor: "vermelho",
      titulo: `Robô auditor — não roda desde ${diaCurto(ultima.iniciadoEm, fuso)}`,
      frase: `A última varredura foi ${quandoRodou(ultima.iniciadoEm, agora, fuso)} (${tempoRelativoSemaforo(ultima.iniciadoEm, agora)}). Ele deveria rodar todo dia de madrugada.`,
      acao: { rotulo: "Rodar varredura", tipo: "rodar_auditor" },
    };
  }

  if (ultima.regrasComErro > 0) {
    return {
      cor: "vermelho",
      titulo: `Robô auditor — ${plural(ultima.regrasComErro, "regra falhou", "regras falharam")}`,
      frase: `Rodou ${quandoRodou(ultima.iniciadoEm, agora, fuso)} e ${plural(ultima.regrasComErro, "regra não conseguiu", "regras não conseguiram")} conferir o banco. O resultado está incompleto.`,
      acao: { rotulo: "Ver o que falhou", tipo: "aba_auditor" },
    };
  }

  if (ultima.achados <= 0) {
    return {
      cor: "verde",
      titulo: `Robô auditor — rodou ${quandoRodou(ultima.iniciadoEm, agora, fuso)}, nada encontrado`,
      frase: "Todas as regras passaram. O banco está coerente.",
      acao: { rotulo: "Ver a varredura", tipo: "aba_auditor" },
    };
  }

  const rep = achadosRepetidos(varreduras);
  const base = `Rodou ${quandoRodou(ultima.iniciadoEm, agora, fuso)} e achou ${plural(ultima.achados, "ponto", "pontos")} no banco.`;
  const repeticao = rep.repetido
    ? ` São os mesmos ${ultima.achados} ${rotuloAnteriores(varreduras, agora, fuso)}${
        rep.criterio === "regras" ? " (as mesmas regras violadas)" : " (mesmo número de achados)"
      } — ninguém resolveu.`
    : "";
  return {
    cor: "ambar",
    titulo: rep.repetido
      ? "Robô auditor — funciona, mas ninguém olha"
      : `Robô auditor — achou ${plural(ultima.achados, "ponto", "pontos")}`,
    frase: base + repeticao,
    acao: { rotulo: `Ver os ${ultima.achados} e resolver`, tipo: "aba_auditor" },
  };
}

// ---------------------------------------------------------------------------
// 3. Robô de jornada
// ---------------------------------------------------------------------------

/** O que o semáforo precisa de cada linha de `adminJornada.historico`. */
export interface VarreduraJornadaSemaforo {
  status: string;
  iniciadoEm: string;
  duracaoMs: number | null;
  rotasVisitadas: number;
  rotasComAchado: number;
  erro?: string | null;
}

/**
 * Menos de 2 s por tela e o robô não viu tela nenhuma — só passou. É o caso
 * do print do dono (19 telas em 32 s) e por isso é VERMELHO, não "0 achados".
 */
export function jornadaNaoConfiavel(v: Pick<VarreduraJornadaSemaforo, "duracaoMs" | "rotasVisitadas">): boolean {
  if (v.rotasVisitadas <= 0 || v.duracaoMs == null) return false;
  return v.duracaoMs / v.rotasVisitadas < MS_POR_TELA_MINIMO;
}

export function semaforoJornada(
  varreduras: VarreduraJornadaSemaforo[],
  agora: Date,
  fuso?: string,
): Semaforo {
  const rodando = varreduras.find((v) => v.status === "rodando");
  const ultima = varreduras.find((v) => v.status !== "rodando");

  if (!ultima) {
    if (rodando) {
      return {
        cor: "cinza",
        titulo: "Robô de jornada — rodando agora",
        frase: "A primeira varredura está em andamento. Leva alguns minutos.",
      };
    }
    return {
      cor: "cinza",
      titulo: "Robô de jornada — ainda não rodou",
      frase: "Nenhuma varredura registrada. A primeira leva alguns minutos.",
      acao: { rotulo: "Rodar agora", tipo: "rodar_jornada" },
    };
  }

  if (ultima.status === "falhou") {
    return {
      cor: "vermelho",
      titulo: "Robô de jornada — a última varredura falhou",
      frase: `${quandoRodou(ultima.iniciadoEm, agora, fuso).replace(/^\w/, (c) => c.toUpperCase())} o robô não completou a volta${
        ultima.erro ? `: ${ultima.erro}` : "."
      }`,
      acao: { rotulo: "Rodar de novo", tipo: "rodar_jornada" },
    };
  }

  if (jornadaNaoConfiavel(ultima)) {
    const segundos = Math.round((ultima.duracaoMs ?? 0) / 1000);
    return {
      cor: "vermelho",
      titulo: "Robô de jornada — resultado não confiável",
      frase: `Passou por ${plural(ultima.rotasVisitadas, "tela", "telas")} em ${plural(segundos, "segundo", "segundos")} — rápido demais pra ter olhado de verdade.`,
      acao: { rotulo: "Rodar de novo", tipo: "rodar_jornada" },
    };
  }

  if (ultima.rotasComAchado > 0) {
    return {
      cor: "ambar",
      titulo: `Robô de jornada — ${plural(ultima.rotasComAchado, "tela com problema", "telas com problema")}`,
      frase: `Rodou ${quandoRodou(ultima.iniciadoEm, agora, fuso)}, passou por ${plural(ultima.rotasVisitadas, "tela", "telas")} e ${
        ultima.rotasComAchado === 1 ? "uma não abriu direito" : `${ultima.rotasComAchado} não abriram direito`
      }.`,
      acao: { rotulo: "Ver o que quebrou", tipo: "aba_jornada" },
    };
  }

  return {
    cor: "verde",
    titulo: `Robô de jornada — rodou ${quandoRodou(ultima.iniciadoEm, agora, fuso)}, nada quebrou`,
    frase: `Passou por ${plural(ultima.rotasVisitadas, "tela", "telas")} em ${Math.round((ultima.duracaoMs ?? 0) / 1000)} s e todas abriram.`,
    acao: { rotulo: "Ver a varredura", tipo: "aba_jornada" },
  };
}

// ---------------------------------------------------------------------------
// 4. A montagem da Visão rápida: do que as procedures devolvem às três regras
// ---------------------------------------------------------------------------

/** O que a Visão rápida lê de `adminErros.listar` (a página de 25 unresolved). */
export interface LeituraErrosVisaoRapida {
  capturaConfigurada: boolean;
  total: number;
  totalMinimo?: boolean;
  motivo?: string;
  issues: ReadonlyArray<{ ultimoVisto?: string | null }>;
}

export interface EntradaVisaoRapida {
  /** `isError` cobre a falha de REDE do tRPC — aí `data` nem chega. */
  erros: { data?: LeituraErrosVisaoRapida; isError: boolean };
  /** `adminRoboAuditor.historico`. */
  auditor: { data?: { varreduras: VarreduraAuditorSemaforo[] } };
  /** `adminJornada.historico`. */
  jornada: { data?: { varreduras: VarreduraJornadaSemaforo[] } };
  agora: Date;
  fuso?: string;
}

export interface SemaforosVisaoRapida {
  erros: Semaforo;
  auditor: Semaforo;
  jornada: Semaforo;
}

/** O `lastSeen` mais recente da página — "o último visto há 2h". */
export function ultimoErroVisto(issues: ReadonlyArray<{ ultimoVisto?: string | null }>): string | null {
  return (
    issues
      .map((i) => i.ultimoVisto)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null
  );
}

/**
 * O cabo entre as três procedures e as três regras. Mora aqui, e não na tela,
 * porque foi aqui que três mutações sobreviveram à suíte inteira: `abertos: 0`
 * deixava a linha verde com issues abertas, `leituraFalhou: null` deixava
 * verde com o Sentry fora do ar, e `[]` no lugar do histórico dizia "ainda não
 * rodou" pra sempre. A tela só chama.
 */
export function montarSemaforosDaVisaoRapida(entrada: EntradaVisaoRapida): SemaforosVisaoRapida {
  const { erros, auditor, jornada, agora, fuso } = entrada;
  const lidos = erros.data;
  return {
    erros: semaforoErros(
      {
        capturaConfigurada: lidos?.capturaConfigurada === true,
        abertos: lidos?.total ?? 0,
        totalMinimo: lidos?.totalMinimo === true,
        ultimoErroEm: ultimoErroVisto(lidos?.issues ?? []),
        leituraFalhou: lidos?.motivo ?? (erros.isError ? "erro_rede" : null),
      },
      agora,
    ),
    auditor: semaforoAuditor(auditor.data?.varreduras ?? [], agora, fuso),
    jornada: semaforoJornada(jornada.data?.varreduras ?? [], agora, fuso),
  };
}
