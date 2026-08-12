/**
 * A ponte entre o caso do cliente e o acervo público.
 *
 * Duas invariantes carregam a fusão inteira:
 *
 *  1. o recorte sai do processo do escritório, e processo sem tribunal nem
 *     classe não produz recorte — recorte largo demais mediria o tribunal
 *     inteiro e venderia isso como "casos como o seu";
 *
 *  2. o modelo recebe o número pra raciocinar e é PROIBIDO de reescrevê-lo.
 *     É a mesma regra que a Pesquisa aplica com `contemNumeroInventado`: o
 *     único percentual na tela é o que saiu da contagem em SQL. Sem a
 *     proibição no prompt, o modelo escreve "em 81% dos casos" no corpo da
 *     peça e passa a existir um número que ninguém contou.
 */

import { describe, expect, it } from "vitest";
import {
  formatarProvaParaPrompt,
  recorteDoCaso,
  MINIMO_PARA_PROVA,
  type ProvaAcervo,
} from "../juridico/prova-acervo";

function prova(over: Partial<ProvaAcervo> = {}): ProvaAcervo {
  return {
    filtro: { tribunal: "tjce", classeTermo: "Busca e Apreensão", assuntoTermo: null, orgaoTermo: null, desdeAno: null },
    rotulo: "TJCE · Busca e Apreensão",
    total: 1284,
    comResultado: 1107,
    fatias: [
      { resultado: "procedente", rotulo: "Procedente", quantidade: 565, percentual: 51 },
      { resultado: "extinto_sem_merito", rotulo: "Extinto sem mérito", quantidade: 266, percentual: 24 },
      { resultado: "acordo", rotulo: "Acordo", quantidade: 0, percentual: 0 },
    ],
    jurisprudencia: 1284,
    soEstatistica: 0,
    amostraPequena: false,
    ...over,
  };
}

describe("recorteDoCaso", () => {
  it("deriva tribunal e classe do processo do escritório", () => {
    const f = recorteDoCaso({ tribunal: "TJCE", classe: "Busca e Apreensão" });
    expect(f).toEqual({
      tribunal: "tjce",
      classeTermo: "Busca e Apreensão",
      assuntoTermo: null,
      orgaoTermo: null,
      desdeAno: null,
    });
  });

  it("processo sem tribunal nem classe não vira recorte", () => {
    expect(recorteDoCaso({})).toBeNull();
    expect(recorteDoCaso({ tribunal: "  ", classe: "" })).toBeNull();
  });

  it("aceita processo com só um dos dois", () => {
    expect(recorteDoCaso({ tribunal: "TJSP" })?.tribunal).toBe("tjsp");
    expect(recorteDoCaso({ classe: "Execução Fiscal" })?.classeTermo).toBe("Execução Fiscal");
  });
});

describe("formatarProvaParaPrompt", () => {
  const txt = formatarProvaParaPrompt(prova());

  it("entrega a distribuição em contagem absoluta, não em percentual", () => {
    expect(txt).toContain("Procedente: 565 de 1107");
    expect(txt).toContain("Extinto sem mérito: 266 de 1107");
    // 51% e 24% existem no objeto e NÃO podem chegar ao modelo — é o número
    // que ele reescreveria no texto da peça.
    expect(txt).not.toMatch(/\d+\s*%/);
  });

  it("proíbe o modelo de escrever percentual", () => {
    expect(txt).toContain("NUNCA escreva percentual");
  });

  it("proíbe citar processo do acervo como precedente", () => {
    expect(txt).toContain("não é jurisprudência citável".replace("não é", "estatística, não"));
  });

  it("omite fatia zerada — 'Acordo: 0 de 1107' é ruído", () => {
    expect(txt).not.toContain("Acordo:");
  });

  it("avisa quando a amostra é pequena", () => {
    const pequeno = formatarProvaParaPrompt(prova({ comResultado: 12, amostraPequena: true }));
    expect(pequeno).toContain("amostra é pequena");
    expect(pequeno).toContain("indício");
    expect(formatarProvaParaPrompt(prova())).not.toContain("amostra é pequena");
  });

  it("o piso de amostra é explícito", () => {
    expect(MINIMO_PARA_PROVA).toBeGreaterThan(0);
  });
});
