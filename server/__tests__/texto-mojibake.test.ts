import { describe, expect, it } from "vitest";
import { pareceMojibake, repararMojibake } from "../../shared/texto-mojibake";

/**
 * Produz o defeito do jeito que ele nasce: UTF-8 relido como Latin-1.
 *
 * Os casos são montados assim, e não colados como literal, porque o texto
 * quebrado contém byte de controle — invisível no editor e perdido no primeiro
 * copiar-colar. Foi esse detalhe que fez a primeira versão do módulo nascer
 * sem casar nada.
 */
const estragar = (s: string): string =>
  Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join("");

describe("repararMojibake", () => {
  it("recupera o acento de nome de órgão", () => {
    const quebrado = estragar("VICE-PRESIDÊNCIA");
    expect(quebrado).not.toBe("VICE-PRESIDÊNCIA");
    expect(repararMojibake(quebrado)).toBe("VICE-PRESIDÊNCIA");
  });

  it("reproduz o caso exato que veio do índice api_publica_stj", () => {
    const doDataJud = "VICE-PRESID" + String.fromCharCode(0xc3, 0x8a) + "NCIA";
    expect(repararMojibake(doDataJud)).toBe("VICE-PRESIDÊNCIA");
  });

  it("recupera nome de ministro", () => {
    expect(repararMojibake(estragar("GABINETE DO MINISTRO SÉRGIO LUIZ KUKINA"))).toBe(
      "GABINETE DO MINISTRO SÉRGIO LUIZ KUKINA",
    );
  });

  it("deixa texto correto exatamente como está", () => {
    // O mesmo registro do DataJud traz os dois. Estragar o que veio certo
    // seria trocar um defeito por outro.
    for (const bom of [
      "Eletrônico",
      "Recurso Especial",
      "Ação Civil Pública",
      "3ª Vara Cível de Fortaleza",
      "VICE-PRESIDÊNCIA",
      "Execução Fiscal",
      "SÃO PAULO",
    ]) {
      expect(repararMojibake(bom)).toBe(bom);
    }
  });

  it("não mexe em texto sem acento nenhum", () => {
    expect(repararMojibake("GABINETE DO MINISTRO")).toBe("GABINETE DO MINISTRO");
    expect(repararMojibake("")).toBe("");
  });

  it("aguenta dupla conversão", () => {
    expect(repararMojibake(estragar(estragar("Cível")))).toBe("Cível");
  });

  it("devolve a entrada quando reinterpretar produziria lixo", () => {
    // Cirílico não passou por UTF-8→Latin-1; se o reparo tentasse, destruiria.
    const russo = "Привет";
    expect(repararMojibake(russo)).toBe(russo);
  });

  it("não sai higienizando controle de texto que não é mojibake", () => {
    // Fora do escopo: a função desfaz conversão errada, não limpa sujeira
    // qualquer. Ampliar isso a faria mexer onde não foi chamada.
    const comNul = "PRESIDENCIA" + String.fromCharCode(0);
    expect(repararMojibake(comNul)).toBe(comNul);
  });
});

describe("pareceMojibake", () => {
  it("acusa o defeito", () => {
    expect(pareceMojibake(estragar("Justiça"))).toBe(true);
    expect(pareceMojibake(estragar("Órgão"))).toBe(true);
  });

  it("não acusa texto são", () => {
    expect(pareceMojibake("Justiça")).toBe(false);
    expect(pareceMojibake("Eletrônico")).toBe(false);
    expect(pareceMojibake("Recurso Especial")).toBe(false);
    expect(pareceMojibake("SÃO PAULO")).toBe(false);
  });
});
