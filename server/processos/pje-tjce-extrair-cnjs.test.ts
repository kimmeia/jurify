import { describe, expect, test } from "vitest";
import {
  extrairCnjs,
  validarCnj,
} from "../../scripts/spike-motor-proprio/lib/parser-utils";

// Constrói um CNJ com DV correto reusando o algoritmo de validarCnj.
// Permite que o teste seja self-contained (sem hardcode de CNJs reais).
function cnjComDvValido(
  numero: string,
  ano: string,
  justica: string,
  tribunal: string,
  orgao: string,
): string {
  const concat = `${numero}${ano}${justica}${tribunal}${orgao}`;
  const resto = BigInt(concat) % 97n;
  const dv = Number(98n - ((resto * 100n) % 97n));
  return `${numero}-${String(dv).padStart(2, "0")}.${ano}.${justica}.${tribunal}.${orgao}`;
}

describe("extrairCnjs — regression: bug N+1 em consultarPorCpf (PJe TJCE)", () => {
  const CNJ_A = cnjComDvValido("0001234", "2024", "8", "06", "0001");
  const CNJ_B = cnjComDvValido("0009999", "2024", "8", "06", "0001");
  const CNJ_C = cnjComDvValido("0007777", "2025", "8", "06", "0002");

  test("fixtures: CNJs gerados têm DV válido", () => {
    expect(validarCnj(CNJ_A)).toBe(true);
    expect(validarCnj(CNJ_B)).toBe(true);
    expect(validarCnj(CNJ_C)).toBe(true);
  });

  test("HTML vazio retorna lista vazia", () => {
    expect(extrairCnjs("")).toEqual([]);
  });

  test("HTML sem CNJ retorna lista vazia", () => {
    const html =
      "<html><body><p>Nenhum processo encontrado</p></body></html>";
    expect(extrairCnjs(html)).toEqual([]);
  });

  test("extrai CNJ único", () => {
    const html = `<a>${CNJ_A}</a>`;
    expect(extrairCnjs(html)).toEqual([CNJ_A]);
  });

  test("preserva duplicatas — dedup é responsabilidade do caller", () => {
    // PJe TJCE renderiza o mesmo CNJ no link e no texto da linha;
    // consultarPorCpf aplica `new Set` em cima.
    const html = `<table><tr><td><a>${CNJ_A}</a></td><td>${CNJ_A}</td></tr></table>`;
    expect(extrairCnjs(html)).toEqual([CNJ_A, CNJ_A]);
  });

  test("rejeita strings com DV inválido", () => {
    const cnjQuebrado = CNJ_A.replace(/-\d{2}\./, "-00.");
    const html = `<p>${cnjQuebrado}</p><p>${CNJ_A}</p>`;
    expect(extrairCnjs(html)).toEqual([CNJ_A]);
  });

  test("regression do bug N+1: caller deve restringir o escopo", () => {
    // Bug original: consultarPorCpf chamava extrairCnjs com page.content()
    // inteiro, capturando 1 CNJ "fantasma" fora da tabela (exemplo no
    // header / breadcrumb / hidden input) e somando +1 ao total a cada
    // execução. Fix: restringir ao container [id*='processosTable'].
    //
    // Este teste documenta o contrato: extrairCnjs é cega ao escopo. O
    // mesmo HTML produz contagens diferentes conforme o que o caller
    // passa — por isso o caller (consultarPorCpf) precisa restringir.
    const fantasma = CNJ_C;
    const tabelaHtml = `<div id="processosTable"><a>${CNJ_A}</a><a>${CNJ_B}</a></div>`;
    const headerHtml = `<header>Exemplo de CNJ: ${fantasma}</header>`;

    expect(extrairCnjs(tabelaHtml)).toEqual([CNJ_A, CNJ_B]);

    const htmlInteiro = headerHtml + tabelaHtml;
    const resultado = extrairCnjs(htmlInteiro);
    expect(resultado).toHaveLength(3);
    expect(resultado).toContain(fantasma);
  });
});
