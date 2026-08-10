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

  it("deixa de fora tribunal em erro", () => {
    // Insistir num tribunal quebrado queima o ciclo que outro usaria, e o erro
    // se repete no log até ninguém mais ler.
    expect(escolherProximo([c("TJAC", 0, "erro"), c("TJRJ", 500)])?.tribunal).toBe("TJRJ");
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
    expect(escolherProximo([c("TJAC", 0, "completo"), c("TJRJ", 0, "erro")])).toBeNull();
  });

  it("não trava quando todos estão rodando", () => {
    // "rodando" é estado transitório de um ciclo anterior, não motivo de
    // exclusão — senão um crash no meio do ciclo aposentaria o tribunal.
    expect(escolherProximo([c("TJAC", 10, "rodando")])?.tribunal).toBe("TJAC");
  });
});
