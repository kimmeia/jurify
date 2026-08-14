/**
 * Atendimento como EPISÓDIO.
 *
 * A conversa é o fio com a pessoa — no WhatsApp ela é criada no primeiro
 * contato e reaproveitada pra sempre (resolvida reabre, arquivada é reusada).
 * Isso torna duas perguntas do escritório impossíveis de responder:
 *
 *  - "quem iniciou atendimento no período": o segundo atendimento da mesma
 *    pessoa não cria linha nova, então herda a data do primeiro. Um cliente
 *    que voltou em agosto continua contando como março;
 *  - "quanto cada um atendeu": `conversas.atendenteId` é UM campo, e a
 *    transferência sobrescreve. O histórico inteiro migra pro último
 *    atendente — o SDR que trabalhou o lead em março perde o registro no dia
 *    em que outra pessoa encosta na conversa.
 *
 * O episódio separa os dois conceitos. A conversa continua contínua; o
 * atendimento é o recorte de trabalho, com início, fim e dono PRÓPRIOS. E o
 * dono é dois campos, não um: quem ABRIU (congelado, é o que responde "quem
 * iniciou") e quem está com ele AGORA (muda na transferência).
 *
 * Nada aqui toca banco — é a régua, e é ela que precisa ser a mesma em todo
 * lugar que decidir onde um episódio acaba e o outro começa.
 */

/**
 * Dias de silêncio que encerram um atendimento sozinho.
 *
 * O botão "resolver" fecha na hora e é o caminho preciso. Isto é a rede pra
 * quem esquece de clicar — e esquecer é o normal, não a exceção: foi por isso
 * que a entrada e a saída do ponto também viraram automáticas.
 *
 * 15 dias porque os dois erros custam coisas diferentes. Curto demais quebra
 * uma negociação lenta em vários atendimentos e infla a contagem; longo demais
 * gruda demandas distintas e devolve o problema que este arquivo veio
 * resolver. Duas semanas passam por cima do vai-e-vem normal de um caso — o
 * cliente que some numa sexta e volta na outra segunda continua no mesmo — e
 * ainda separam com folga o cliente que reaparece meses depois.
 *
 * É um palpite calibrável: depois de um ciclo de uso real, a distribuição dos
 * intervalos entre mensagens diz o número certo melhor que qualquer intuição.
 */
export const SILENCIO_DIAS = 15;

export const SILENCIO_MS = SILENCIO_DIAS * 24 * 60 * 60 * 1000;

export type MotivoFechamento =
  /** Alguém clicou em resolver. */
  | "resolvido"
  /** Passou `SILENCIO_DIAS` sem mensagem nova. */
  | "silencio"
  /** Gestor encerrou na mão, corrigindo um registro. */
  | "manual";

export const ROTULO_FECHAMENTO: Record<MotivoFechamento, string> = {
  resolvido: "resolvido pelo atendente",
  silencio: `sem mensagem por ${SILENCIO_DIAS} dias`,
  manual: "encerrado pelo gestor",
};

/** O mínimo que a regra precisa saber do último episódio da conversa. */
export interface EpisodioParaRegra {
  id: number;
  abertoEm: Date | string;
  fechadoEm: Date | string | null;
  /** Última mensagem que entrou neste episódio. */
  ultimaMensagemEm: Date | string | null;
}

function emMs(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Uma mensagem que chega agora entra no episódio aberto, ou abre um novo?
 *
 * Três casos, e o do meio é o que carrega a regra:
 *
 *  - não há episódio: abre;
 *  - o último está FECHADO: abre. Resolver é uma decisão explícita de que
 *    aquele trabalho acabou, e reabrir por cima dela apagaria a decisão;
 *  - o último está aberto: entra nele, a menos que o silêncio já tenha
 *    passado do limite. Nesse caso o episódio anterior morreu de inanição e
 *    esta mensagem é uma demanda nova.
 *
 * O silêncio é medido a partir da ÚLTIMA MENSAGEM, não da abertura: um
 * atendimento que se arrasta por um mês em conversa ativa não deve ser
 * partido no meio só por ser longo.
 */
export function abreNovoEpisodio(
  ultimo: EpisodioParaRegra | null | undefined,
  chegandoEm: Date,
): boolean {
  if (!ultimo) return true;
  if (ultimo.fechadoEm) return true;

  const referencia = emMs(ultimo.ultimaMensagemEm) ?? emMs(ultimo.abertoEm);
  if (referencia == null) return false;

  const agora = chegandoEm.getTime();
  if (Number.isNaN(agora)) return false;
  // Mensagem com data anterior à referência (reprocessamento, fuso torto) não
  // abre episódio: só o tempo PARA FRENTE encerra alguma coisa.
  return agora - referencia > SILENCIO_MS;
}

/**
 * Um episódio aberto já passou do silêncio e deveria estar fechado?
 *
 * É a pergunta que a rotina de varredura faz. Ela existe separada de
 * `abreNovoEpisodio` porque o fechamento tem que acontecer mesmo que ninguém
 * mande mensagem nunca mais — senão o episódio fica eternamente "em aberto" e
 * some da contagem de atendimentos encerrados.
 */
export function venceuPorSilencio(
  ep: EpisodioParaRegra,
  agora: Date,
): boolean {
  if (ep.fechadoEm) return false;
  const referencia = emMs(ep.ultimaMensagemEm) ?? emMs(ep.abertoEm);
  if (referencia == null) return false;
  return agora.getTime() - referencia > SILENCIO_MS;
}

/**
 * Em que instante o episódio deve constar como encerrado, quando quem fecha é
 * o silêncio.
 *
 * Usa a última mensagem, e não o momento em que a varredura rodou. O trabalho
 * acabou quando a conversa parou; carimbar a hora do cron faria a duração do
 * atendimento depender de quando a máquina passou por ali, e um episódio de
 * março apareceria encerrado em agosto se a rotina tivesse ficado parada.
 */
export function fechamentoPorSilencio(ep: EpisodioParaRegra): Date | null {
  const referencia = emMs(ep.ultimaMensagemEm) ?? emMs(ep.abertoEm);
  return referencia == null ? null : new Date(referencia);
}

/**
 * Transferir NÃO abre episódio novo.
 *
 * É a mesma demanda trocando de mão: o cliente não pediu outra coisa, o
 * escritório é que decidiu quem cuida. Abrir episódio a cada transferência
 * contaria uma demanda como dois atendimentos e inflaria o número de quem
 * recebe repasse.
 *
 * Quem quiser saber "por quantas mãos passou" lê a mensagem de sistema que a
 * transferência grava no corpo da conversa; quem quiser saber "quem iniciou"
 * lê `atendenteAbriuId`, que a transferência não toca.
 */
export const TRANSFERENCIA_ABRE_EPISODIO = false;

/** Uma mensagem, no mínimo que o corte do histórico precisa. */
export interface MensagemParaCorte {
  em: Date | string;
  /** Saída = mensagem do escritório. */
  daEquipe: boolean;
  /** Colaborador que enviou, quando é saída. */
  remetenteId?: number | null;
}

export interface EpisodioReconstruido {
  abertoEm: Date;
  ultimaMensagemEm: Date;
  primeiraRespostaEm: Date | null;
  /** Quem respondeu primeiro neste episódio — a atribuição real do passado. */
  atendenteAbriu: number | null;
}

/**
 * Reconstrói os episódios de uma conversa a partir das mensagens dela.
 *
 * Usa exatamente o mesmo limite do caminho ao vivo, e é por isso que mora
 * aqui: régua duplicada entre o que roda agora e o que reconstrói o passado
 * daria dois relatórios diferentes do mesmo mês.
 *
 * `atendenteAbriu` sai do REMETENTE da primeira resposta do episódio, não de
 * `conversas.atendenteId`. O campo da conversa guarda só quem está com ela
 * hoje — usá-lo no backfill carimbaria o histórico inteiro no nome do último
 * atendente, que é justamente o defeito que o episódio veio corrigir. Quem
 * respondeu está gravado em cada mensagem e não foi sobrescrito por ninguém.
 */
export function dividirEmEpisodios(mensagens: MensagemParaCorte[]): EpisodioReconstruido[] {
  const ordenadas = mensagens
    .map((m) => ({ ...m, ms: new Date(m.em).getTime() }))
    .filter((m) => Number.isFinite(m.ms))
    .sort((a, b) => a.ms - b.ms);
  if (ordenadas.length === 0) return [];

  const episodios: EpisodioReconstruido[] = [];
  let atual: EpisodioReconstruido | null = null;
  let anteriorMs = 0;

  for (const m of ordenadas) {
    if (!atual || m.ms - anteriorMs > SILENCIO_MS) {
      atual = {
        abertoEm: new Date(m.ms),
        ultimaMensagemEm: new Date(m.ms),
        primeiraRespostaEm: null,
        atendenteAbriu: null,
      };
      episodios.push(atual);
    }
    atual.ultimaMensagemEm = new Date(m.ms);
    if (m.daEquipe && atual.primeiraRespostaEm == null) {
      atual.primeiraRespostaEm = new Date(m.ms);
      atual.atendenteAbriu = m.remetenteId ?? null;
    }
    anteriorMs = m.ms;
  }
  return episodios;
}
