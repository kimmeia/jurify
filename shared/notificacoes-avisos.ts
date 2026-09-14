/**
 * O que pode tocar o celular, e o que vem ligado de fábrica.
 *
 * Antes disto o push era tudo-ou-nada: `TIPOS_PUSH` era um conjunto fixo no
 * código com sete tipos, e quem não queria UM deles só podia desligar todos.
 * O resultado medido era o dono recebendo aviso de **toda mensagem de toda
 * conversa** do escritório — e o aviso que vira ruído é o aviso que faz a
 * pessoa desligar o que importava.
 *
 * Duas regras carregam o desenho:
 *
 * 1. **O que não está mapeado SEMPRE passa.** `avisoDoTipo` devolve null pro
 *    que este catálogo não conhece, e null quer dizer "envia". Assim nenhum
 *    aviso que funciona hoje para de funcionar por eu ter esquecido de
 *    declarar — e tipo novo continua chegando até alguém decidir o contrário.
 * 2. **Só o que DIVERGE do padrão é gravado.** A preferência do usuário é a
 *    exceção, não a cópia da lista; assim mudar um padrão aqui alcança quem
 *    nunca mexeu, e quem mexeu continua com a escolha dele.
 */

/** Em que pé está o aviso no sistema — a tela mostra isso sem maquiar. */
export type EstadoDoAviso = "existe" | "novo" | "nao_chega";

/** Quem pode ver e escolher o aviso. */
export type QuemVe = "todos" | "financeiro" | "dono";

export interface Aviso {
  id: string;
  grupo: GrupoDeAviso;
  titulo: string;
  explica: string;
  /** Vem ligado numa conta nova? */
  padrao: boolean;
  quemVe: QuemVe;
}

export type GrupoDeAviso = "processos" | "atendimento" | "dinheiro" | "documentos" | "saude";

export const GRUPOS: Array<{ id: GrupoDeAviso; titulo: string; descricao: string; quemVe: QuemVe }> = [
  {
    id: "processos",
    titulo: "Processos",
    descricao:
      "O robô lê as movimentações e a IA já separa decisão de rotina. É essa separação que decide o que toca o celular.",
    quemVe: "todos",
  },
  {
    id: "atendimento",
    titulo: "Atendimento",
    descricao: "Antes desta tela, o celular do dono tocava a cada mensagem de qualquer conversa.",
    quemVe: "todos",
  },
  {
    id: "dinheiro",
    titulo: "Dinheiro",
    descricao: "Aparece para quem tem acesso ao Financeiro.",
    quemVe: "financeiro",
  },
  { id: "documentos", titulo: "Documentos", descricao: "", quemVe: "todos" },
  {
    id: "saude",
    titulo: "Saúde do sistema",
    descricao: "Só o dono do escritório recebe. É o aviso que evita descobrir o problema tarde.",
    quemVe: "dono",
  },
];

export const AVISOS: readonly Aviso[] = [
  // ── Processos ────────────────────────────────────────────────────────────
  {
    id: "processos.decisao",
    grupo: "processos",
    titulo: "Decisão ou sentença no processo",
    explica: "Sentença, liminar, acórdão — o que muda o rumo do caso. Chega com o resumo em uma linha.",
    padrao: true,
    quemVe: "todos",
  },
  {
    id: "processos.providencia",
    grupo: "processos",
    titulo: "Movimentação que exige providência",
    explica: "Intimação, citação, despacho que abre prazo. É a mesma que vira prazo sugerido na Central.",
    padrao: true,
    quemVe: "todos",
  },
  {
    id: "processos.prazo",
    grupo: "processos",
    titulo: "Prazo vencendo",
    explica: "Um aviso na véspera e outro no dia, pelo fuso do escritório.",
    padrao: true,
    quemVe: "todos",
  },
  {
    id: "processos.nova-acao",
    grupo: "processos",
    titulo: "Nova ação contra um cliente vigiado",
    explica:
      "Só quando o cliente é réu ou quando não deu pra saber o polo — ação que o próprio escritório ajuizou não toca.",
    padrao: true,
    quemVe: "todos",
  },
  {
    id: "processos.rotina",
    grupo: "processos",
    titulo: "Movimentação de rotina",
    explica:
      "Juntada, conclusos, publicação, remessa. São 8 de cada 10 — desligado, o celular para de tocar à toa.",
    padrao: false,
    quemVe: "todos",
  },

  // ── Atendimento ──────────────────────────────────────────────────────────
  {
    id: "atendimento.nova-conversa",
    grupo: "atendimento",
    titulo: "Nova conversa iniciada",
    explica:
      "A primeira mensagem de quem nunca falou com o escritório, ou de quem voltou depois de um atendimento encerrado.",
    padrao: true,
    quemVe: "todos",
  },
  {
    id: "atendimento.atribuida",
    grupo: "atendimento",
    titulo: "Conversa atribuída a mim",
    explica: "Quando o rodízio ou alguém da equipe passa uma conversa pra você.",
    padrao: true,
    quemVe: "todos",
  },
  {
    id: "atendimento.toda-mensagem",
    grupo: "atendimento",
    titulo: "Toda mensagem que chega",
    explica:
      "Era o que acontecia antes, sem escolha. Fica desligado por padrão: quem atende continua recebendo as conversas dele.",
    padrao: false,
    quemVe: "todos",
  },
  {
    id: "atendimento.esperando",
    grupo: "atendimento",
    titulo: "Cliente esperando resposta há mais de 15 minutos",
    explica: "Um toque só, por conversa, quando ninguém respondeu.",
    padrao: false,
    quemVe: "todos",
  },

  // ── Dinheiro ─────────────────────────────────────────────────────────────
  {
    id: "dinheiro.pago",
    grupo: "dinheiro",
    titulo: "Pagamento recebido",
    explica: "O cliente pagou a cobrança. Chega com o valor e o nome.",
    padrao: true,
    quemVe: "financeiro",
  },
  {
    id: "dinheiro.vencida",
    grupo: "dinheiro",
    titulo: "Cobrança venceu sem pagamento",
    explica: "Um aviso por cobrança, no dia seguinte ao vencimento.",
    padrao: true,
    quemVe: "financeiro",
  },
  {
    id: "dinheiro.contrato",
    grupo: "dinheiro",
    titulo: "Contrato fechado",
    explica: "Quando alguém da equipe marca o lead como ganho.",
    padrao: true,
    quemVe: "financeiro",
  },

  // ── Documentos ───────────────────────────────────────────────────────────
  {
    id: "documentos.assinou",
    grupo: "documentos",
    titulo: "Cliente assinou o documento",
    explica: "No momento em que a assinatura entra, com o comprovante pronto.",
    padrao: true,
    quemVe: "todos",
  },

  // ── Saúde do sistema ─────────────────────────────────────────────────────
  {
    id: "saude.whatsapp",
    grupo: "saude",
    titulo: "WhatsApp com risco de bloqueio",
    explica:
      "Qualidade caindo na Meta, limite de envio rebaixado, disjuntor disparado. É a diferença entre reagir no amarelo e descobrir no bloqueio.",
    padrao: true,
    quemVe: "dono",
  },
  {
    id: "saude.credencial",
    grupo: "saude",
    titulo: "Credencial de tribunal parou de funcionar",
    explica:
      "Sem ela o robô para de vigiar os processos daquele tribunal, e ninguém percebe até faltar movimentação.",
    padrao: true,
    quemVe: "dono",
  },
];

/** Chaves que não são aviso: são como o aviso chega. */
export const AJUSTE_SILENCIO = "ajuste.silencio-noturno";
export const AJUSTE_ALCANCE = "ajuste.tudo-do-escritorio";

/** Silêncio ligado de fábrica; alcance do escritório, não. */
export const AJUSTES_PADRAO: Record<string, boolean> = {
  [AJUSTE_SILENCIO]: true,
  [AJUSTE_ALCANCE]: false,
};

const PORE_ID = new Map(AVISOS.map((a) => [a.id, a]));

export function avisoPorId(id: string): Aviso | undefined {
  return PORE_ID.get(id);
}

/** O padrão de fábrica de qualquer chave — aviso ou ajuste. */
export function padraoDaChave(chave: string): boolean {
  const aviso = PORE_ID.get(chave);
  if (aviso) return aviso.padrao;
  return AJUSTES_PADRAO[chave] ?? true;
}

/** Chave conhecida? Preferência de chave inventada não é gravada. */
export function chaveConhecida(chave: string): boolean {
  return PORE_ID.has(chave) || chave in AJUSTES_PADRAO;
}

/**
 * Como a IA classificou a movimentação → qual aviso ela é.
 *
 * O vocabulário é o de `classificarGrupo`, que a Central já usa pra separar o
 * feed: reaproveitar é o que garante que "exige providência" na tela e no
 * celular querem dizer a mesma coisa.
 */
export function avisoDaMovimentacao(grupo: string | null | undefined): string {
  if (grupo === "exigem_acao") return "processos.providencia";
  if (grupo === "rotina") return "processos.rotina";
  return "processos.decisao";
}

/**
 * O tipo interno da notificação → o aviso que o usuário escolhe.
 *
 * **null quer dizer "manda assim mesmo"**: é o que impede que um tipo que eu
 * não mapeei pare de chegar. `dados` carrega o que o emissor souber a mais —
 * a classe da movimentação e se a conversa é nova.
 */
export function avisoDoTipo(
  tipo: string,
  dados?: Record<string, unknown> | null,
): string | null {
  switch (tipo) {
    case "movimentacao_processo":
      return avisoDaMovimentacao(typeof dados?.classe === "string" ? dados.classe : null);
    case "nova_acao":
      return "processos.nova-acao";
    case "prazo_vencendo":
      return "processos.prazo";
    case "nova_mensagem":
      // A primeira mensagem de uma conversa é notícia; a segunda é ruído. Sem
      // essa distinção o dono recebe o dia inteiro e desliga tudo.
      return dados?.conversaNova === true ? "atendimento.nova-conversa" : "atendimento.toda-mensagem";
    case "conversa_atribuida":
      return "atendimento.atribuida";
    case "cliente_esperando":
      return "atendimento.esperando";
    case "pagamento_recebido":
      return "dinheiro.pago";
    case "cobranca_vencida":
      return "dinheiro.vencida";
    case "contrato_fechado":
      return "dinheiro.contrato";
    case "assinatura_concluida":
      return "documentos.assinou";
    case "whatsapp_saude":
      return "saude.whatsapp";
    case "credencial_erro":
    case "credencial_recuperada":
      return "saude.credencial";
    default:
      return null;
  }
}

/** Início e fim do silêncio noturno, em hora local do escritório. */
export const SILENCIO_DE = 21;
export const SILENCIO_ATE = 7;

/**
 * A hora local está dentro do silêncio?
 *
 * A janela cruza a meia-noite, então é OU e não E — escrever como intervalo
 * simples deixaria a madrugada inteira de fora, que é justamente o que o
 * silêncio existe pra cobrir.
 */
export function dentroDoSilencio(horaLocal: number): boolean {
  return horaLocal >= SILENCIO_DE || horaLocal < SILENCIO_ATE;
}
