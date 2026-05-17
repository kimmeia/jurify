/**
 * Testes do helper `escapeLikePattern`.
 *
 * Bug original: queries Drizzle com `like(table.col, `%${input}%`)`
 * deixavam `%` e `_` do user serem interpretados como wildcards SQL.
 *  - User passa `%` → query vira `%%%` → match TUDO
 *  - User passa `100%off` → `%100%off%` → matcha "100" + qualquer-coisa + "off"
 *  - User passa `admin@%` → exfiltra emails que começam com "admin@"
 *
 * Não é SQL injection (o driver parametriza), mas é wildcard injection —
 * permite mudar o significado da busca.
 */

import { describe, it, expect } from "vitest";
import { escapeLikePattern } from "../_core/sql-helpers";

describe("escapeLikePattern", () => {
  it("escapa % (wildcard de N chars)", () => {
    expect(escapeLikePattern("50%off")).toBe("50\\%off");
  });

  it("escapa _ (wildcard de 1 char)", () => {
    expect(escapeLikePattern("user_name")).toBe("user\\_name");
  });

  it("escapa \\ (escape char do LIKE)", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("escapa % + _ + \\ na ordem correta (\\ primeiro)", () => {
    // Se escapássemos \ DEPOIS de %, teríamos duplo-escape em \\\\% pra %.
    // A ordem correta é \\ primeiro, depois % e _.
    expect(escapeLikePattern("a\\b%c_d")).toBe("a\\\\b\\%c\\_d");
  });

  it("strings sem caracteres especiais ficam intactas", () => {
    expect(escapeLikePattern("nome.qualquer@exemplo.com")).toBe(
      "nome.qualquer@exemplo.com",
    );
  });

  it("string vazia retorna string vazia", () => {
    expect(escapeLikePattern("")).toBe("");
  });

  it("apenas wildcards: cada caractere é escapado", () => {
    expect(escapeLikePattern("%%")).toBe("\\%\\%");
    expect(escapeLikePattern("__")).toBe("\\_\\_");
  });

  it("caso real: telefone com underscore não vira wildcard", () => {
    // User digita '_' achando que é literal — sem escape, retornaria
    // qualquer telefone de 1 caractere.
    expect(escapeLikePattern("_")).toBe("\\_");
  });

  it("caso real: busca por email com %domain.com não exfiltra outros domínios", () => {
    expect(escapeLikePattern("%@domain.com")).toBe("\\%@domain.com");
  });

  it("idempotência parcial: aplicar 2x produz double-escape (expectativa documentada)", () => {
    // Quem chama deve aplicar APENAS UMA VEZ. Aplicar 2x gera escapes
    // duplos. Garante que callers não fiquem "escapando defensivamente".
    const once = escapeLikePattern("a%");
    expect(once).toBe("a\\%");
    expect(escapeLikePattern(once)).toBe("a\\\\\\%");
  });
});
