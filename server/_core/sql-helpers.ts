/**
 * Helpers compartilhados pra queries SQL.
 */

/**
 * Escapa caracteres especiais do LIKE pra evitar "search injection".
 *
 * Sem escape, qualquer input do usuário pode usar `%` (wildcard de N
 * caracteres) ou `_` (wildcard de 1 caractere) pra:
 *  - Listar TUDO: passa `%` no campo de busca → todos os rows match
 *  - Confusão semântica: `100%off` filtra "100" + (qualquer coisa) + "off"
 *  - Exfiltração: `admin@%` retorna todos os emails que começam com admin@
 *
 * Não é SQL injection (a string vai pro driver via parameterized query)
 * mas é um wildcard injection — usuário consegue mudar o significado da
 * busca.
 *
 * Uso:
 *   .where(like(table.col, `%${escapeLikePattern(input.busca)}%`))
 *
 * Em MySQL, `\` é o escape default do LIKE. Escapamos `%` `_` e o
 * próprio `\` em ordem certa (\\ primeiro pra não duplicar escapes).
 */
export function escapeLikePattern(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
