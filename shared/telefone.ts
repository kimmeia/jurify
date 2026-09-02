/**
 * Comparação de telefone brasileiro entre fontes que digitam diferente.
 *
 * O mesmo número aparece no sistema de várias formas: o compromisso da agenda
 * costuma trazer o que a secretária digitou ("8597965706"), o contato do CRM
 * veio do WhatsApp com código do país e o nono dígito ("5585997965706"), e a
 * ficha pode ter máscara ("(85) 99796-5706"). Comparar string com string
 * erraria em todos esses pares, e o clique no telefone abriria "nova conversa"
 * pra alguém que já tem conversa aberta.
 *
 * A chave normalizada é DDD + os 8 dígitos finais: é o que sobrevive às três
 * variações. O nono dígito é descartado de propósito — ele foi acrescentado a
 * celulares antigos e um mesmo número existe gravado das duas formas.
 */

function digitos(v: string): string {
  return v.replace(/\D/g, "");
}

/**
 * "DDD + 8 dígitos" quando dá pra reconhecer o formato; `null` quando não dá
 * (fixo de 8 dígitos sem DDD, número estrangeiro, campo com lixo).
 *
 * Devolver `null` em vez de chutar é o que impede dois números diferentes de
 * casarem por acidente — no caso de dúvida, é melhor abrir uma conversa nova
 * do que jogar o atendente na conversa de outra pessoa.
 */
export function chaveTelefoneBR(valor: string | null | undefined): string | null {
  if (!valor) return null;
  let d = digitos(valor);

  // Código do país. Só corta quando o resto continua tendo tamanho de número
  // nacional — "55" também é DDD (RS), e cortar cegamente quebraria o Sul.
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);

  if (d.length !== 10 && d.length !== 11) return null;

  const ddd = d.slice(0, 2);
  let resto = d.slice(2);
  if (resto.length === 9) {
    // Nono dígito: só existe em celular e sempre é 9. Se não for, o número
    // não está no formato que esta função entende.
    if (resto[0] !== "9") return null;
    resto = resto.slice(1);
  }
  return `${ddd}${resto}`;
}

/** Os dois valores apontam pro mesmo telefone? */
export function mesmoTelefone(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = chaveTelefoneBR(a);
  const kb = chaveTelefoneBR(b);
  if (ka && kb) return ka === kb;
  // Sem formato reconhecível dos dois lados, só igualdade literal dos dígitos
  // conta — e nunca com string vazia, que casaria com qualquer outro vazio.
  const da = a ? digitos(a) : "";
  const db = b ? digitos(b) : "";
  return da.length > 0 && da === db;
}
