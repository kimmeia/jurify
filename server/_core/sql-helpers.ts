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

/**
 * Detecta ER_DUP_ENTRY (UNIQUE/PK violation) cobrindo o caso em que o
 * Drizzle reempacota o erro do mysql2 dentro de `err.cause`.
 *
 * Sem essa proteção, o `try/catch` legado checava apenas `err.code` e
 * `err.message` — quando o Drizzle empacota, o `err.message` vira
 * "Failed query: ..." e `err.code` fica `undefined`, então o catch
 * confunde duplicata legítima (race benigna) com erro real e poluía o
 * log + estourava contadores de "erros" no painel de sync.
 *
 * Caso clássico: `asaas-extrato.ts` rodando sync manual depois de já
 * ter importado tudo via cron → 600+ duplicatas viravam "erros".
 */
export function isDuplicateEntryError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as Record<string, unknown> & { cause?: Record<string, unknown> };
  if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
  if (
    e.cause &&
    typeof e.cause === "object" &&
    (e.cause.code === "ER_DUP_ENTRY" || e.cause.errno === 1062)
  ) {
    return true;
  }
  const msg = typeof e.message === "string" ? e.message : "";
  if (/Duplicate entry/i.test(msg)) return true;
  const causeMsg =
    e.cause && typeof e.cause === "object" && typeof e.cause.message === "string"
      ? e.cause.message
      : "";
  return /Duplicate entry/i.test(causeMsg);
}

/**
 * Mensagem do erro real (do mysql2), preferindo `err.cause.message` ao
 * `err.message` quando o Drizzle empacota. Útil pra log diagnóstico —
 * sem isso, o log vira "Failed query: ..." sem o motivo.
 */
export function extractDbErrorMessage(err: unknown): string {
  if (err == null || typeof err !== "object") return String(err ?? "");
  const e = err as Record<string, unknown> & { cause?: Record<string, unknown> };
  if (
    e.cause &&
    typeof e.cause === "object" &&
    typeof e.cause.message === "string" &&
    e.cause.message.length > 0
  ) {
    return e.cause.message;
  }
  return typeof e.message === "string" ? e.message : String(err);
}
