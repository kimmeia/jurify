/**
 * Conserta texto que chegou como UTF-8 lido a Latin-1.
 *
 * O DataJud entrega os dois no MESMO registro: `formato.nome` vem
 * "Eletrônico", certinho, e o nome do órgão vem com "Ê" virado em "Ã" mais um
 * caractere de controle. A diferença é a origem — vocabulário controlado do
 * CNJ está limpo, o que o tribunal digitou passou por uma conversão errada
 * antes de chegar lá. Não é charset da nossa leitura: se fosse, tudo viria
 * quebrado.
 *
 * Isso não é cosmético. `orgaoTermo` casa por LIKE, então "Vice-Presidência"
 * nunca encontraria o nome corrompido, e o recorte devolveria zero num órgão
 * que tem milhares de processos.
 *
 * O reparo é conservador: só mexe quando a assinatura do defeito está presente
 * E o resultado melhora. Texto correto passa intacto, porque "reparar" o que
 * não está quebrado é como se estraga acervo bom.
 *
 * A detecção é por CODE POINT, não por regex com escape. Byte de continuação
 * escrito num literal de regex é invisível no editor e não sobrevive a
 * copiar-colar — foi assim que a primeira versão deste arquivo nasceu sem
 * casar nada, e o teste pegou.
 */

const A_TIL = 0x00c3; // Ã
const A_CIRC = 0x00c2; // Â

const ehContinuacaoUtf8 = (c: number) => c >= 0x80 && c <= 0xbf;

/** Controle C0/C1 e o marcador de substituição — nada disso é nome de órgão. */
const ehLixo = (c: number) =>
  c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0xfffd;

/**
 * A marca do defeito: "Ã" ou "Â" seguido de byte de continuação. Em português
 * correto essa dupla não acontece — "Ã" só aparece antes de vogal ou espaço.
 */
function contarAssinatura(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const c = s.charCodeAt(i);
    if ((c === A_TIL || c === A_CIRC) && ehContinuacaoUtf8(s.charCodeAt(i + 1))) n++;
  }
  return n;
}

export function pareceMojibake(s: string): boolean {
  return contarAssinatura(s) > 0;
}

/**
 * Acentos do português SEM Ã e Â.
 *
 * Eles ficam de fora porque são a própria marca do defeito: contá-los como
 * ganho empata o placar na última passada — "CÃ­vel" tem um "acento" e
 * "Cível" tem um, e o reparo parava a um passo do fim.
 */
const ACENTOS = /[áàéêíóôõúüçÁÀÉÊÍÓÔÕÚÜÇ]/g;
const contarAcentos = (s: string) => (s.match(ACENTOS) ?? []).length;

function contarLixo(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (ehLixo(s.charCodeAt(i))) n++;
  return n;
}

function tirarLixo(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (!ehLixo(s.charCodeAt(i))) out += s[i];
  }
  return out.trim();
}

/**
 * Desfaz UMA passada de UTF-8→Latin-1. Devolve null quando não dá pra
 * reinterpretar — string com caractere fora de Latin-1 não passou por essa
 * conversão, então não é esse o defeito.
 */
function reinterpretar(s: string): string | null {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) return null;
    bytes[i] = c;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Aplica o reparo se — e só se — ele melhorar o texto.
 *
 * "Melhorar" é objetivo: mais acento de português, ou menos caractere de
 * controle. Sem esse teste, uma string legítima que por acaso case com a
 * assinatura sairia pior do que entrou.
 */
export function repararMojibake(s: string): string {
  if (!pareceMojibake(s)) return s;

  let atual = s;
  // Duas passadas cobrem a dupla conversão, que acontece quando o dado
  // atravessa dois sistemas mal configurados. Cada passada extra é uma chance
  // a mais de estragar texto bom, então para aqui.
  for (let i = 0; i < 2; i++) {
    const tentativa = reinterpretar(atual);
    if (tentativa === null) break;

    const melhorou =
      contarAssinatura(tentativa) < contarAssinatura(atual) ||
      contarAcentos(tentativa) > contarAcentos(atual) ||
      contarLixo(tentativa) < contarLixo(atual);
    if (!melhorou) break;

    atual = tentativa;
    if (!pareceMojibake(atual)) break;
  }

  // Sobra de controle depois do reparo é byte que se perdeu na origem e não
  // volta. Tirar é melhor que guardar caractere invisível dentro do nome.
  return tirarLixo(atual);
}
