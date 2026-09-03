/**
 * Amarra do painel admin: na ficha do cliente, aba Equipe → colaborador →
 * "Excluir conta permanentemente" e "Retirar créditos" agem sobre a PESSOA
 * NA TELA (`current`, topo da pilha de navegação), não sobre o `userId` da
 * prop (a ficha que abriu o diálogo — o dono). O diálogo dizia "Milena" e
 * excluía o Rafael.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ARQ = path.resolve(__dirname, "../../client/src/pages/admin/AdminClients.tsx");

function bloco(fonte: string, marcador: string, tamanho = 600): string {
  const i = fonte.indexOf(marcador);
  expect(i, `marcador não encontrado: ${marcador}`).toBeGreaterThan(-1);
  return fonte.slice(i, i + tamanho);
}

describe("AdminClients — quem é excluído/retirado é quem está na tela", () => {
  const fonte = readFileSync(ARQ, "utf-8");

  it("excluirMut.mutate usa `current`, não `userId` da prop", () => {
    const b = bloco(fonte, "excluirMut.mutate({");
    expect(b).toMatch(/userId:\s*current,/);
    expect(b).not.toMatch(/mutate\(\{\s*userId,/);
  });

  it("retirarMut.mutate usa `current`, não `userId` da prop", () => {
    const b = bloco(fonte, "retirarMut.mutate({");
    expect(b).toMatch(/userId:\s*current,/);
    expect(b).not.toMatch(/mutate\(\{\s*userId,/);
  });

  it("as guardas de clique também olham `current`", () => {
    expect(fonte).toMatch(/if \(!current \|\| motivoExclusao\.trim\(\)\.length < 5\) return;/);
    expect(fonte).toMatch(/if \(!retirarConfirm \|\| !current\) return;/);
    expect(fonte).not.toMatch(/if \(!userId \|\| motivoExclusao/);
    expect(fonte).not.toMatch(/if \(!retirarConfirm \|\| !userId\)/);
  });

  it("o diálogo de exclusão diz qual conta vai sair", () => {
    expect(fonte).toContain("Conta que será excluída:");
  });
});
