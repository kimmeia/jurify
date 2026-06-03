/**
 * Tipos compartilhados — Módulo Escritório, Colaboradores e Configurações
 * Fase 1: Fundação organizacional do CRM
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type CargoColaborador = "dono" | "gestor" | "atendente" | "estagiario" | "sdr";
export type StatusConvite = "pendente" | "aceito" | "expirado" | "cancelado";

export const CARGO_LABELS: Record<CargoColaborador, string> = {
  dono: "Dono",
  gestor: "Gestor",
  atendente: "Atendente",
  estagiario: "Estagiário",
  sdr: "SDR",
};

export const CARGO_DESCRICAO: Record<CargoColaborador, string> = {
  dono: "Acesso total ao escritório, equipe e configurações",
  gestor: "Gerencia equipe, reatribui conversas, acessa relatórios",
  atendente: "Atende clientes, gerencia seus leads e conversas",
  estagiario: "Atende clientes sob supervisão, acesso limitado",
  sdr: "Sales Development Representative — qualifica leads, gerencia pipeline próprio, acessa relatórios próprios",
};

/**
 * Custo por colaborador extra acima do limite do plano.
 * @deprecated O sistema de planos passou a usar `planos.max_usuarios` (Fase 4
 * do roadmap de Planos). Este multiplicador será removido quando a UI de
 * "cobrança de colaborador extra" for refatorada pra usar o admin.
 */
export const CUSTO_COLABORADOR_EXTRA = 9.90;

// ─── Fusos horários ───────────────────────────────────────────────────────────

/**
 * Fusos horários oficiais brasileiros (IANA). O `fusoHorario` do escritório
 * é usado nos cálculos de agendamento do SmartFlow (slots de horário dos
 * gatilhos Asaas, lembretes Cal.com). Se o SaaS for aberto a outros países
 * no futuro, basta acrescentar entradas aqui.
 *
 * Mantemos 4 zonas oficiais do Brasil — 1 `timeZone` por UTC offset:
 *   - UTC-2: Fernando de Noronha
 *   - UTC-3: Brasília e maior parte dos estados
 *   - UTC-4: Mato Grosso, Mato Grosso do Sul, Rondônia, Roraima, Amazonas
 *   - UTC-5: Acre, partes do Amazonas
 *
 * Sempre apresentado em ordem decrescente de população (Brasília primeiro).
 */
export const FUSOS_HORARIOS: Array<{ valor: string; label: string; utc: string }> = [
  { valor: "America/Sao_Paulo", label: "Brasília e maior parte do Brasil", utc: "UTC-3" },
  { valor: "America/Manaus", label: "Mato Grosso, MS, RO, RR, AM", utc: "UTC-4" },
  { valor: "America/Rio_Branco", label: "Acre e oeste do Amazonas", utc: "UTC-5" },
  { valor: "America/Noronha", label: "Fernando de Noronha", utc: "UTC-2" },
];

/** Conjunto de fusos válidos (lookup O(1)). */
export const FUSOS_HORARIOS_VALIDOS = new Set(FUSOS_HORARIOS.map((f) => f.valor));

/** Fuso padrão quando o escritório não define explicitamente. */
export const FUSO_HORARIO_PADRAO = "America/Sao_Paulo";

/**
 * Retorna a data "hoje" no formato ISO `YYYY-MM-DD` observada num fuso IANA.
 *
 * Default é o fuso brasileiro padrão (`America/Sao_Paulo`). O server em
 * produção (Railway/AWS) costuma rodar em UTC, então `new Date().toISOString()`
 * dá a data UTC — que vira "amanhã" pra um operador no BRT após 21h. Pra
 * defaults de "Marcar paga hoje" / "Hoje" em filtros, usar este helper
 * preserva a percepção do usuário.
 *
 * Recebe optional `tz` pra suportar escritórios em outros fusos brasileiros
 * (Manaus, Acre, Noronha). Sem `tz`, usa o padrão. `agora` é injetável pra
 * testes determinísticos (sem precisar mockar o relógio global).
 */
export function dataHojeBR(
  tz: string = FUSO_HORARIO_PADRAO,
  agora: Date = new Date(),
): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Rótulo de separador de data no chat/timeline, observado no fuso `tz`.
 *
 * "Hoje" / "Ontem" pros dois dias mais recentes; senão a data por extenso
 * ("Terça-feira, 3 de junho"), com o ano só quando difere do corrente. A
 * virada de dia segue o relógio do operador no fuso do escritório — uma
 * mensagem das 23h BRT não pode cair no "dia seguinte" só porque já passou
 * da meia-noite no UTC do server. `agora` é injetável pra teste determinístico.
 */
export function rotuloDataConversa(
  iso: string | Date,
  tz: string = FUSO_HORARIO_PADRAO,
  agora: Date = new Date(),
): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diaMsg = dataHojeBR(tz, d);
  const hoje = dataHojeBR(tz, agora);
  const ontem = dataHojeBR(tz, new Date(agora.getTime() - 86_400_000));
  if (diaMsg === hoje) return "Hoje";
  if (diaMsg === ontem) return "Ontem";
  const txt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(diaMsg.slice(0, 4) === hoje.slice(0, 4) ? {} : { year: "numeric" }),
  }).format(d);
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/**
 * Retorna o offset (em ms) do fuso `tz` no instante `instante`.
 * Ex: para America/Sao_Paulo (BRT, sem horário de verão desde 2019),
 *     offset = -3h × 3600 × 1000 = -10800000 (UTC-3).
 *
 * Usa duas formatações em paralelo (`tz` e UTC) e diff em ms — robusto
 * pra fusos com DST mesmo que o Brasil hoje não use (suporta expansão
 * futura pra outros países).
 *
 * `sv-SE` locale garante formato 24h sem ambiguidade ("00" pra meia-noite,
 * não "24"). `Intl.DateTimeFormat` é stdlib do Node 18+ — sem dependência.
 */
function obterOffsetFusoMs(instante: Date, tz: string): number {
  const partesNoFuso = (zone: string) =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(instante);

  const partsToMs = (parts: Intl.DateTimeFormatPart[]) => {
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
    return Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
  };

  return partsToMs(partesNoFuso(tz)) - partsToMs(partesNoFuso("UTC"));
}

/**
 * Início do dia `yyyy-mm-dd` no fuso `tz`, como `Date` UTC.
 *
 * Ex: `inicioDoDiaNoFuso("2026-05-17", "America/Sao_Paulo")`
 *     → `Date(2026-05-17T03:00:00.000Z)` — 03h UTC = 00h BRT.
 *
 * Usado em filtros `gte(coluna, inicio)` em queries que comparam com
 * colunas DATETIME (MySQL armazena em UTC). Antes do fix do bug #7, o
 * código usava `new Date("2026-05-17")` que vira `2026-05-17T00:00:00Z`,
 * que em SP é `2026-05-16T21:00:00 BRT` — perdendo eventos das 22h do
 * dia anterior. Pior: usuário filtrando "hoje" não via os compromissos
 * do dia.
 */
export function inicioDoDiaNoFuso(
  yyyymmdd: string,
  tz: string = FUSO_HORARIO_PADRAO,
): Date {
  const [year, month, day] = yyyymmdd.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`yyyymmdd inválido: ${yyyymmdd}`);
  }
  const tentativaUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offset = obterOffsetFusoMs(new Date(tentativaUtc), tz);
  return new Date(tentativaUtc - offset);
}

/**
 * Fim do dia `yyyy-mm-dd` no fuso `tz` (23:59:59.999), como `Date` UTC.
 *
 * Usado em filtros `lte(coluna, fim)` pra incluir compromissos do dia
 * inteiro. Antes do fix, `new Date("2026-05-17")` virava 00h UTC do
 * mesmo dia — perdia tudo que estava entre 00h e 23h59 BR.
 */
export function fimDoDiaNoFuso(
  yyyymmdd: string,
  tz: string = FUSO_HORARIO_PADRAO,
): Date {
  const [year, month, day] = yyyymmdd.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`yyyymmdd inválido: ${yyyymmdd}`);
  }
  const tentativaUtc = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  const offset = obterOffsetFusoMs(new Date(tentativaUtc), tz);
  return new Date(tentativaUtc - offset);
}

/** Primeiro dia do mês de um `YYYY-MM-DD`. Ex: "2026-05-23" → "2026-05-01". */
export function primeiroDiaDoMesISO(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 7)}-01`;
}

/**
 * Subtrai 1 mês civil de `YYYY-MM-DD` preservando o dia, com clamp pro último
 * dia do mês anterior (31 mar → 28/29 fev, nunca 3 mar). Opera só sobre
 * componentes de data — sem Date/fuso — pra comparações MTD vs LMTD estáveis
 * (substitui o antigo `subtrairUmMesClamped`, que mexia em Date e quebrava
 * quando o range vinha no fuso, com o "fim do dia" caindo no dia UTC seguinte).
 */
export function subtrairUmMesISO(yyyymmdd: string): string {
  const [ano, mes, dia] = yyyymmdd.split("-").map(Number);
  if (!ano || !mes || !dia) throw new Error(`yyyymmdd inválido: ${yyyymmdd}`);
  const anoAnt = mes === 1 ? ano - 1 : ano;
  const mesAnt = mes === 1 ? 12 : mes - 1;
  const ultimoDiaMesAnt = new Date(Date.UTC(anoAnt, mesAnt, 0)).getUTCDate();
  const diaClamp = Math.min(dia, ultimoDiaMesAnt);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${anoAnt}-${p(mesAnt)}-${p(diaClamp)}`;
}

/**
 * Resolve um período (range de datas) no fuso do escritório.
 *
 * Default (sem input) = mês civil corrente: dia 1 → hoje, observado no fuso.
 * Com `input.dataInicio`+`dataFim`, usa o range explícito. Em ambos os casos
 * devolve as strings civis `YYYY-MM-DD` (pra colunas DATE como vencimento/
 * dataPagamento) E os `Date` de início/fim do dia no fuso (pra colunas
 * DATETIME como createdAt/concluidaAt) — coerentes entre si.
 *
 * Centraliza o cálculo usado por Dashboard e Relatórios pra que as duas telas
 * mostrem o MESMO período (paridade) e nenhuma "pule o dia 1" nem vire o mês
 * cedo demais por causa do relógio UTC do server.
 */
export function resolverPeriodoNoFuso(
  agora: Date,
  tz: string,
  input?: { dataInicio?: string; dataFim?: string },
): { dataInicio: Date; dataFim: Date; dataInicioStr: string; dataFimStr: string } {
  let dataInicioStr: string;
  let dataFimStr: string;
  if (input?.dataInicio && input?.dataFim) {
    dataInicioStr = input.dataInicio;
    dataFimStr = input.dataFim;
  } else {
    const hojeStr = dataHojeBR(tz, agora);
    dataInicioStr = primeiroDiaDoMesISO(hojeStr);
    dataFimStr = hojeStr;
  }
  return {
    dataInicio: inicioDoDiaNoFuso(dataInicioStr, tz),
    dataFim: fimDoDiaNoFuso(dataFimStr, tz),
    dataInicioStr,
    dataFimStr,
  };
}

/**
 * Chaves `YYYY-MM` dos últimos `meses` meses terminando no mês corrente
 * observado no fuso `tz` (inclusive). Ex: meses=3, hoje=mai/2026 →
 * ["2026-03","2026-04","2026-05"].
 *
 * Ancora no fuso (não no relógio UTC do server) pra não listar o mês seguinte
 * na virada de mês à noite BRT. `Date.UTC` normaliza meses negativos (vira o
 * ano) e `getUTC*` mantém a leitura consistente em qualquer fuso de runner.
 */
export function chavesMesesAteHojeNoFuso(
  meses: number,
  tz: string,
  agora: Date = new Date(),
): string[] {
  const [ano, mes] = dataHojeBR(tz, agora).split("-").map(Number);
  const chaves: string[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ano!, mes! - 1 - i, 1));
    chaves.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return chaves;
}

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface EscritorioInfo {
  id: number;
  nome: string;
  cnpj?: string;
  telefone?: string;
  email?: string;
  endereco?: string;
  logoUrl?: string;
  fusoHorario: string;
  horarioAbertura: string;
  horarioFechamento: string;
  diasFuncionamento: string[];
  mensagemAusencia?: string;
  mensagemBoasVindas?: string;
  ownerId: number;
  createdAt: string;
}

export interface ColaboradorInfo {
  id: number;
  escritorioId: number;
  userId: number;
  userName?: string;
  userEmail?: string;
  cargo: CargoColaborador;
  departamento?: string;
  ativo: boolean;
  maxAtendimentosSimultaneos: number;
  recebeLeadsAutomaticos: boolean;
  createdAt: string;
}

export interface ConviteInfo {
  id: number;
  escritorioId: number;
  email: string;
  cargo: CargoColaborador;
  departamento?: string;
  status: StatusConvite;
  convidadoPorNome?: string;
  expiresAt: string;
  createdAt: string;
}

// ─── Permissões por Cargo ────────────────────────────────────────────────────

export type Permissao =
  | "ver_todas_conversas"
  | "reatribuir_conversa"
  | "ver_metricas_todos"
  | "gerenciar_canais"
  | "gerenciar_colaboradores"
  | "excluir_contatos"
  | "exportar_relatorios"
  | "enviar_mensagens"
  | "ver_pipeline"
  | "gerenciar_escritorio";

export const PERMISSOES_POR_CARGO: Record<CargoColaborador, Permissao[]> = {
  dono: [
    "ver_todas_conversas", "reatribuir_conversa", "ver_metricas_todos",
    "gerenciar_canais", "gerenciar_colaboradores", "excluir_contatos",
    "exportar_relatorios", "enviar_mensagens", "ver_pipeline", "gerenciar_escritorio",
  ],
  gestor: [
    "ver_todas_conversas", "reatribuir_conversa", "ver_metricas_todos",
    "gerenciar_canais", "excluir_contatos", "exportar_relatorios",
    "enviar_mensagens", "ver_pipeline",
  ],
  atendente: [
    "enviar_mensagens", "ver_pipeline",
  ],
  estagiario: [
    "enviar_mensagens",
  ],
  // SDR = atendente + acesso a relatórios próprios + foco em qualificação
  // de leads. Mesma matriz que atendente nas permissões compartilhadas;
  // diferença real está em check-permission.ts (relatórios.verProprios=true).
  sdr: [
    "enviar_mensagens", "ver_pipeline", "exportar_relatorios",
  ],
};

export function temPermissao(cargo: CargoColaborador, permissao: Permissao): boolean {
  return PERMISSOES_POR_CARGO[cargo].includes(permissao);
}
