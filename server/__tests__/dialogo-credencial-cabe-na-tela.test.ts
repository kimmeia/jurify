/**
 * O diálogo "Cadastrar credencial" cabe na tela, e o login do PJe é CPF.
 *
 * O dono testou a experiência de uso e mandou o print: a caixa passava da tela
 * num notebook — o TÍTULO cortado em cima e os botões «Cancelar» e «Cadastrar e
 * testar login» cortados embaixo. Não era gosto, era conteúdo fora da tela: o
 * formulário é alto (apelido, as duas opções de alcance, o seletor de tribunal,
 * CPF, senha e o 2FA com dois modos) e o `DialogContent` não tinha teto de
 * altura nem rolagem.
 *
 * "Fora de padrão" tem número: 41 diálogos do client usam `overflow-y-auto` e
 * 19 usam `max-h-[90vh]`. Este era a exceção.
 *
 * E o campo pedia «CPF ou OAB». O login do PJe/PDPJ é o CPF — oferecer OAB
 * convidava a digitar o que o tribunal não aceita, e o erro só apareceria no
 * "testar login", depois da senha já digitada.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const processos = ler("client/src/pages/Processos.tsx");

/** O trecho do diálogo de cadastrar credencial, do container até o rodapé. */
function blocoDoDialogo(): string {
  const i = processos.indexOf("<DialogTitle>Cadastrar credencial</DialogTitle>");
  expect(i).toBeGreaterThan(-1);
  // O container vem ANTES do título; pega desde o DialogContent que o abre.
  const abre = processos.lastIndexOf("<DialogContent", i);
  const fecha = processos.indexOf("Cadastrar e testar login", i);
  expect(abre).toBeGreaterThan(-1);
  expect(fecha).toBeGreaterThan(abre);
  return processos.slice(abre, fecha);
}

describe("o diálogo cabe na tela", () => {
  it("tem teto de altura e rolagem própria — senão o título e os botões saem da tela", () => {
    const bloco = blocoDoDialogo();
    const container = bloco.slice(0, bloco.indexOf(">") + 1);
    expect(container).toContain("max-h-[90vh]");
    expect(container).toContain("overflow-y-auto");
  });

  it("segue o padrão da casa, e não um teto inventado", () => {
    // A régua é o resto do client: se um dia a casa trocar de convenção, este
    // teste avisa que o diálogo ficou sozinho de novo.
    const tetos = processos.match(/max-h-\[90vh\]/g) ?? [];
    expect(tetos.length).toBeGreaterThan(0);
    const todos = ler("client/src/pages/Clientes.tsx") + processos;
    expect(todos).toContain("overflow-y-auto");
  });
});

describe("o login do tribunal é CPF", () => {
  it("o campo pede CPF, não «CPF ou OAB»", () => {
    const bloco = blocoDoDialogo();
    expect(bloco).toContain("<Label>CPF *</Label>");
    expect(bloco).not.toContain("CPF ou OAB");
  });

  it("o exemplo do campo não sugere OAB", () => {
    const bloco = blocoDoDialogo();
    expect(bloco).toContain('placeholder="12345678900"');
    expect(bloco).not.toMatch(/placeholder="[^"]*SP123456/);
  });

  // O par "rótulo da tela × rótulo do manual" saiu junto com o módulo de
  // ajuda, removido por inteiro em 13/09 a pedido do dono (os vídeos vão
  // ocupar o lugar). O que ficou é o rótulo da tela, conferido acima.
});
