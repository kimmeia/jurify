/**
 * Como se reconhece um escritório de teste — em UM lugar só.
 *
 * O robô de jornada navega o sistema como usuário, e a parede que separa
 * ele dos dados dos clientes é o próprio `escritorioId`: ele entra num
 * escritório que só tem ele dentro. Isso funciona porque toda consulta do
 * produto já filtra por escritório — não é uma trava nova, é a mesma.
 *
 * Mas várias peças precisam saber "isto é de teste": o semeador que cria, o
 * varredor que limpa, o guarda de e-mail que impede envio real, e a regra do
 * auditor que acusa sobra. Se cada uma carregasse a própria string, bastaria
 * renomear o prefixo num lugar pra o guarda parar de guardar em silêncio —
 * e ninguém notaria até o dia em que um e-mail de teste chegasse num cliente.
 */

/** Todo escritório de teste nasce com o nome `test-runner-<runId>`. */
export const PREFIXO_ESCRITORIO_TESTE = "test-runner-";

/**
 * Domínio reservado dos usuários do robô. `.test` é reservado por RFC 2606
 * justamente pra isso: não existe, não resolve, não é de ninguém.
 */
export const DOMINIO_EMAIL_TESTE = "jurify.test";

/** Prefixo dos registros que o robô cria dentro do escritório dele. */
export const MARCA_REGISTRO_TESTE = "[E2E]";

/**
 * Depois disto, escritório de teste vivo é sobra de execução interrompida —
 * o robô apaga o dele em segundos. O varredor limpa e o auditor acusa.
 */
export const IDADE_MAXIMA_ESCRITORIO_TESTE_MS = 24 * 60 * 60 * 1000;

export function nomeEscritorioDeTeste(runId: string): string {
  return `${PREFIXO_ESCRITORIO_TESTE}${runId}`;
}

export function ehEscritorioDeTeste(nome: string | null | undefined): boolean {
  return typeof nome === "string" && nome.startsWith(PREFIXO_ESCRITORIO_TESTE);
}

/**
 * O `@` importa: sem ele, um cliente de verdade chamado
 * "contato.jurify.test@gmail.com" seria confundido com conta do robô e
 * pararia de receber e-mail — o oposto do que o guarda existe pra fazer.
 */
export function ehEmailDeTeste(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith(`@${DOMINIO_EMAIL_TESTE}`);
}
