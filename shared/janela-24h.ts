/**
 * A janela de atendimento de 24h do WhatsApp.
 *
 * A Meta só aceita mensagem LIVRE (texto, mídia, botões) enquanto faz menos de
 * 24h que o cliente escreveu. Passou disso, só template aprovado sai — texto
 * livre volta com 131047 e a tentativa ainda conta contra a reputação do
 * número.
 *
 * **A janela não é guardada em lugar nenhum, de propósito.** Ela é sempre
 * calculada a partir do carimbo da ÚLTIMA MENSAGEM RECEBIDA do cliente, que é
 * como a Meta mede. Assim ela reabre sozinha: mensagem nova do cliente empurra
 * o prazo 24h pra frente sem ninguém precisar atualizar nada. Uma cópia gravada
 * no banco seria uma segunda verdade pra manter em dia, e o caminho que
 * esquecesse de atualizar deixaria o campo travado com a janela aberta — ou,
 * pior, deixaria sair texto livre fora dela.
 *
 * Quem mede o "última entrada" é `ultimaEntradaDoContatoNoCanal`
 * (whatsapp-optout), pelo PAR cliente × número e atravessando conversas
 * encerradas — recado interno não conta como entrada.
 */

export const JANELA_24H_MS = 24 * 60 * 60 * 1000;

/**
 * A janela está aberta? Aberta = última mensagem recebida há menos de 24h.
 * Sem entrada nenhuma a janela está fechada (ninguém escreveu, nada a
 * responder livremente).
 */
export function janela24hAberta(
  ultimaEntradaAt: Date | string | null | undefined,
  agoraMs: number,
): boolean {
  return msRestantesDaJanela(ultimaEntradaAt, agoraMs) > 0;
}

/**
 * Quanto falta da janela, em milissegundos. Zero quando fechada ou quando não
 * há entrada — é o mesmo "não pode mandar livre" pros dois casos.
 */
export function msRestantesDaJanela(
  ultimaEntradaAt: Date | string | null | undefined,
  agoraMs: number,
): number {
  if (!ultimaEntradaAt) return 0;
  const t = ultimaEntradaAt instanceof Date ? ultimaEntradaAt.getTime() : new Date(ultimaEntradaAt).getTime();
  if (Number.isNaN(t)) return 0;
  const restante = t + JANELA_24H_MS - agoraMs;
  return restante > 0 ? restante : 0;
}

/**
 * O tempo que falta, escrito pra quem atende: "3h20", "48 min", "menos de
 * 1 min". Hora cheia não carrega o "00" ("5h", não "5h00") — é relógio de
 * apoio, não cronômetro.
 */
export function rotuloTempoRestante(ms: number): string {
  if (ms <= 0) return "";
  const minutos = Math.floor(ms / 60_000);
  if (minutos < 1) return "menos de 1 min";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, "0")}`;
}

/** A janela está acabando? Serve pro aviso mudar de tom antes de fechar. */
export const JANELA_ACABANDO_MS = 2 * 60 * 60 * 1000;

export function janelaAcabando(ms: number): boolean {
  return ms > 0 && ms <= JANELA_ACABANDO_MS;
}

/**
 * O que o servidor devolve quando recusa um disparo automático fora da janela.
 * Vira o erro da execução do fluxo e o texto do log.
 */
export const MENSAGEM_BLOQUEIO_JANELA =
  "Janela de 24h fechada: o cliente não escreve há mais de 24 horas e o WhatsApp recusa mensagem livre (131047). " +
  "Só template aprovado reabre a conversa — o envio foi segurado pra não queimar a reputação do número.";

/** Marcador do recado interno, pra dedup e pra tela reconhecer a nota. */
export const MARCADOR_JANELA_FECHADA = "janela_fechada";

/**
 * O recado que fica NA CONVERSA quando o robô é segurado pela janela. É
 * interno: sem ele, o silêncio do robô fica idêntico a defeito, e quem atende
 * não descobre que a bola é dele. Nunca vai pro cliente.
 */
export function recadoJanelaFechada(nomeCenario?: string | null): string {
  const nome = (nomeCenario || "").trim();
  const quem = nome ? `O robô ("${nome}")` : "O robô";
  return (
    `${quem} não enviou: passaram mais de 24 horas desde a última mensagem do cliente, ` +
    `e o WhatsApp só aceita mensagem livre dentro dessa janela. ` +
    `Para retomar a conversa, envie um template aprovado.`
  );
}
