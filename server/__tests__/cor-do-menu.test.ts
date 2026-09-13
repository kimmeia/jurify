/**
 * Trava a cor do menu lateral.
 *
 * `#07060f` não é uma escolha estética solta: é o valor do header do Devular
 * (`bg-[#07060f]/80` em `crm-saas` client/src/pages/Home.tsx), e o dono pediu
 * a mesma cor nos dois produtos. Se alguém trocar por "um cinza mais bonito",
 * os dois deixam de ser a mesma marca — e isso não aparece em teste nenhum,
 * porque cor não quebra build.
 *
 * A armadilha que este teste também guarda: repetir a TRANSPARÊNCIA do
 * Devular aqui NÃO dá a mesma cor. Lá o header flutua sobre um hero escuro e
 * 80% de quase-preto sobre quase-preto continua quase-preto; aqui o menu tem
 * a página clara atrás, e os mesmos 80% renderizam #37363e — grafite. Medido
 * no navegador antes de decidir.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A cor do header do Devular. Mudou lá? Muda aqui junto, de propósito. */
const COR_DA_MARCA = "#07060f";

const css = readFileSync(join(__dirname, "..", "..", "client", "src", "index.css"), "utf8");

/** Recorta um bloco `seletor { … }` do CSS. */
function bloco(seletor: string) {
  const i = css.indexOf(`${seletor} {`);
  expect(i, `bloco ${seletor} não encontrado`).toBeGreaterThan(-1);
  const j = css.indexOf("\n}", i);
  expect(j, `fim do bloco ${seletor} não encontrado`).toBeGreaterThan(-1);
  return css.slice(i, j);
}

describe("a cor do menu", () => {
  it("é a mesma do header do Devular, no tema claro", () => {
    const m = bloco(":root").match(/--sidebar:\s*([^;]+);/);
    expect(m, "--sidebar sumiu do tema claro").toBeTruthy();
    expect(m![1].trim().toLowerCase()).toBe(COR_DA_MARCA);
  });

  it("é a MESMA no tema escuro — o menu é o mesmo objeto nos dois temas", () => {
    const m = bloco(".dark").match(/--sidebar:\s*([^;]+);/);
    expect(m, "--sidebar sumiu do tema escuro").toBeTruthy();
    expect(m![1].trim().toLowerCase()).toBe(COR_DA_MARCA);
  });

  it("não volta a ser transparente: 80% sobre a página clara vira grafite", () => {
    // `rgba(7,6,15,.8)` sobre o fundo do app (#f4f6f8) rende #37363e — medido
    // no navegador. Quem copiar a linha do Devular aqui acha que está pondo
    // quase-preto e põe cinza.
    for (const seletor of [":root", ".dark"]) {
      const valor = bloco(seletor).match(/--sidebar:\s*([^;]+);/)![1];
      expect(valor, `${seletor}: menu com transparência não dá a cor do Devular`)
        .not.toMatch(/rgba|\/\s*\d+%|oklch/i);
    }
  });

  it("o item ativo continua legível sobre o quase-preto", () => {
    // Foi a diferença entre as variantes B e C do mockup: neutralizar o azul
    // do item ativo quase apaga onde o usuário está.
    const claro = bloco(":root").match(/--sidebar-accent:\s*([^;]+);/);
    expect(claro, "--sidebar-accent sumiu").toBeTruthy();
    expect(claro![1].trim(), "item ativo não pode ser igual ao fundo do menu")
      .not.toBe(COR_DA_MARCA);
  });

  it("o texto do menu é claro — senão some no fundo quase-preto", () => {
    for (const seletor of [":root", ".dark"]) {
      const fg = bloco(seletor).match(/--sidebar-foreground:\s*oklch\(([\d.]+)/);
      expect(fg, `${seletor}: --sidebar-foreground sumiu`).toBeTruthy();
      expect(Number(fg![1]), `${seletor}: texto do menu escuro demais`).toBeGreaterThan(0.6);
    }
  });
});
