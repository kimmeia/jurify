/**
 * A frase que fica gravada no histórico da conversa.
 *
 * A antiga era "Conversa transferida para outro atendente" — sem de quem, sem
 * pra quem, sem quem mandou. Estes testes travam o que cada variante precisa
 * dizer, porque é o texto que alguém vai ler meses depois pra entender por que
 * o cliente ficou sem resposta.
 */

import { describe, it, expect } from "vitest";
import { mensagemTransferencia, nomeCurto } from "./transferencia-conversa";

describe("nomeCurto", () => {
  it("mantém primeiro e último, descartando o meio", () => {
    expect(nomeCurto("Isaac Luca Cavalcante Abreu")).toBe("Isaac Abreu");
  });

  it("nome de uma palavra passa inteiro", () => {
    expect(nomeCurto("Milena")).toBe("Milena");
  });

  it("sem nome não vira string vazia no meio da frase", () => {
    // "transferiu a conversa de  para " seria pior que um genérico.
    expect(nomeCurto(null)).toBe("alguém");
    expect(nomeCurto("   ")).toBe("alguém");
  });
});

describe("mensagemTransferencia", () => {
  it("entregar pra outro nomeia os três papéis", () => {
    expect(
      mensagemTransferencia({
        autor: "Bruno Boyadjian",
        de: "Milena Mello Mansur",
        para: "Isaac Luca Cavalcante Abreu",
      }),
    ).toBe("[Sistema] Bruno Boyadjian transferiu a conversa de Milena Mansur para Isaac Abreu.");
  });

  it("pegar pra si não vira 'Fulano transferiu para Fulano'", () => {
    expect(
      mensagemTransferencia({ autor: "Pablo Sousa Silva", de: "Milena Mansur", para: "Pablo Sousa Silva" }),
    ).toBe("[Sistema] Pablo Silva assumiu a conversa, antes com Milena Mansur.");
  });

  it("assumir conversa sem dono não inventa um antecessor", () => {
    expect(mensagemTransferencia({ autor: "Pablo Silva", de: null, para: "Pablo Silva" })).toBe(
      "[Sistema] Pablo Silva assumiu a conversa.",
    );
  });

  it("atribuir conversa sem dono é 'atribuiu', não 'transferiu de'", () => {
    expect(mensagemTransferencia({ autor: "Bruno Boyadjian", de: null, para: "Dayane Rios" })).toBe(
      "[Sistema] Bruno Boyadjian atribuiu a conversa a Dayane Rios.",
    );
  });

  it("comparação de autor e destino usa o nome curto, não o completo", () => {
    // O autor vem do colaborador logado e o destino da lista; se um chegar
    // com o nome do meio e o outro não, ainda é a mesma pessoa assumindo.
    expect(
      mensagemTransferencia({ autor: "Pablo Sousa Silva", de: null, para: "Pablo Silva" }),
    ).toBe("[Sistema] Pablo Silva assumiu a conversa.");
  });
});
