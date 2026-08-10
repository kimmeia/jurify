import { describe, expect, it } from "vitest";
import { escolherProximo, type CandidatoTribunal } from "../jurisia/fila-ingestao";

const c = (
  tribunal: string,
  processos: number,
  status = "fila",
): CandidatoTribunal => ({ tribunal, alias: tribunal.toLowerCase(), status, processos });

describe("escolherProximo", () => {
  it("ataca o mais atrasado", () => {
    // Alfabético daria ao TJAC a mesma atenção que ao TJSP, e é no TJSP que
    // estão os processos — mas quem está pra trás é quem precisa do ciclo.
    expect(escolherProximo([c("TJSP", 90_000), c("TJAC", 120), c("TJRJ", 40_000)])?.tribunal).toBe(
      "TJAC",
    );
  });

  it("deixa de fora tribunal completo", () => {
    expect(escolherProximo([c("TJAC", 0, "completo"), c("TJRJ", 500)])?.tribunal).toBe("TJRJ");
  });

  it("tribunal em erro cede a vez, mas não é excluído", () => {
    // Insistir num tribunal quebrado queima o ciclo que outro usaria — por isso
    // ele vai pro fim, mesmo estando mais atrasado.
    expect(escolherProximo([c("TJAC", 0, "erro"), c("TJRJ", 500)])?.tribunal).toBe("TJRJ");
  });

  it("volta ao tribunal em erro quando é o único que sobrou", () => {
    // A maioria dos erros aqui é transitória (API fora, timeout, cursor que só
    // voltou a servir depois de um deploy). Exclusão definitiva transformava um
    // minuto de instabilidade em aposentadoria silenciosa, e a fila ficava
    // parada sem nada na tela explicando por quê.
    expect(escolherProximo([c("TJAC", 120, "erro")])?.tribunal).toBe("TJAC");
    expect(
      escolherProximo([c("TJAC", 120, "erro"), c("TJRJ", 500, "completo")])?.tribunal,
    ).toBe("TJAC");
  });

  it("entre dois em erro, ainda vale o mais atrasado", () => {
    expect(
      escolherProximo([c("TJSP", 90_000, "erro"), c("TJAC", 120, "erro")])?.tribunal,
    ).toBe("TJAC");
  });

  it("desempata pela sigla, não pela ordem do banco", () => {
    // Sem desempate estável dois tribunais zerados se revezariam conforme a
    // ordem que o banco devolvesse, e nenhum avançaria de forma previsível.
    const ordemA = escolherProximo([c("TJRJ", 0), c("TJAC", 0), c("TJMG", 0)]);
    const ordemB = escolherProximo([c("TJMG", 0), c("TJRJ", 0), c("TJAC", 0)]);
    expect(ordemA?.tribunal).toBe("TJAC");
    expect(ordemB?.tribunal).toBe("TJAC");
  });

  it("leva o alias junto, que é o que a API usa", () => {
    const alvo = escolherProximo([{ tribunal: "TJDFT", alias: "tjdft", status: "fila", processos: 0 }]);
    expect(alvo).toEqual({ tribunal: "TJDFT", alias: "tjdft" });
  });

  it("devolve null quando não sobra ninguém", () => {
    expect(escolherProximo([])).toBeNull();
    expect(escolherProximo([c("TJAC", 0, "completo"), c("TJRJ", 0, "completo")])).toBeNull();
  });

  it("não trava quando todos estão rodando", () => {
    // "rodando" é estado transitório de um ciclo anterior, não motivo de
    // exclusão — senão um crash no meio do ciclo aposentaria o tribunal.
    expect(escolherProximo([c("TJAC", 10, "rodando")])?.tribunal).toBe("TJAC");
  });
});
