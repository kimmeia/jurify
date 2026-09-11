/**
 * Texto seguro para as fontes padrão do PDF.
 *
 * As 14 fontes padrão (Helvetica e companhia) só sabem escrever WinAnsi, que
 * é o Latin-1 mais um punhado de símbolos. Português inteiro cabe lá (ç, ã, é,
 * ô), mas letra turca, polonesa ou tcheca não: escrever "Şahin" derruba a
 * geração com "WinAnsi cannot encode" e o cliente fica sem o comprovante da
 * assinatura que ele já fez.
 *
 * Aqui a letra impossível vira a mais próxima que existe (Ş → S, ğ → g, ı → i)
 * em vez de derrubar o documento. O nome como a pessoa digitou continua
 * guardado no banco e aparece na tela de dados da assinatura — o que muda é só
 * o que cabe dentro do PDF.
 *
 * Escrita que não tem equivalente em letra latina (cirílico, árabe, CJK) vira
 * "?" — é o limite da fonte padrão, e `precisaFonteUnicode` avisa quando isso
 * acontece para quem quiser tratar.
 */

/** Os 27 caracteres que o WinAnsi tem além do Latin-1 (faixa 0x80-0x9F). */
const EXTRAS_WINANSI = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

function encodavelEmWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0);
  if (c === undefined) return false;
  // Controles baixos (quebra de linha inclusive) não são "texto" pro drawText.
  if (c >= 0x20 && c <= 0x7e) return true;
  if (c >= 0xa0 && c <= 0xff) return true;
  return EXTRAS_WINANSI.includes(ch);
}

/**
 * Letras que NÃO se resolvem tirando o acento: o Unicode não as decompõe,
 * então a conversão precisa ser dita à mão.
 */
const SUBSTITUTOS: Record<string, string> = {
  "ı": "i",
  "ŀ": "l",
  "ł": "l",
  "Ł": "L",
  "đ": "d",
  "Đ": "D",
  "ħ": "h",
  "Ħ": "H",
  "ŧ": "t",
  "Ŧ": "T",
  "ŋ": "n",
  "Ŋ": "N",
  "ĸ": "k",
  "ə": "e",
  "Ə": "E",
  "ʼ": "'",
  "­": "", // hífen invisível: some, não vira "?"
  "​": "",
  " ": " ",
  " ": " ",
  "‑": "-",
};

export function textoParaPdfWinAnsi(valor: string | null | undefined): string {
  if (!valor) return "";
  let saida = "";
  for (const ch of valor) {
    if (encodavelEmWinAnsi(ch)) {
      saida += ch;
      continue;
    }
    const mapeado = SUBSTITUTOS[ch];
    if (mapeado !== undefined) {
      saida += mapeado;
      continue;
    }
    // Ş, ğ, ř, ā e companhia: o Unicode separa a letra do acento, e a letra
    // sozinha cabe no WinAnsi.
    const semAcento = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (semAcento !== ch && semAcento.length > 0 && [...semAcento].every(encodavelEmWinAnsi)) {
      saida += semAcento;
      continue;
    }
    saida += "?";
  }
  return saida;
}

/** O texto perdeu alguma letra na conversão? (vira "?" no PDF) */
export function precisaFonteUnicode(valor: string | null | undefined): boolean {
  if (!valor) return false;
  return textoParaPdfWinAnsi(valor).includes("?") && !valor.includes("?");
}
