import { describe, expect, it } from "vitest";
import {
  MIN_COMPARACAO,
  casoBateComFiltro,
  compararComAcervo,
} from "../../shared/jurisia-estrategia";
import { montarEstatistica } from "../../shared/jurisia-recorte";
import type { ResultadoProcesso } from "../../shared/datajud-desfecho";

const est = (total: number, p: Partial<Record<ResultadoProcesso, number>>) =>
  montarEstatistica(total, {
    procedente: 0,
    parcial: 0,
    improcedente: 0,
    acordo: 0,
    extinto_sem_merito: 0,
    ...p,
  });

const linha = (c: ReturnType<typeof compararComAcervo>, r: ResultadoProcesso) =>
  c.linhas.find((l) => l.resultado === r)!;

describe("compararComAcervo", () => {
  it("põe as duas fontes lado a lado, resultado por resultado", () => {
    const c = compararComAcervo(
      est(100, { procedente: 60, improcedente: 40 }),
      est(20, { procedente: 10, improcedente: 10 }),
    );
    expect(linha(c, "procedente").acervoPct).toBe(60);
    expect(linha(c, "procedente").escritorioPct).toBe(50);
    expect(linha(c, "procedente").diferencaPp).toBe(-10);
    expect(c.acervoDecididos).toBe(100);
    expect(c.escritorioDecididos).toBe(20);
  });

  it("mantém as cinco linhas mesmo quando um lado não tem aquele resultado", () => {
    const c = compararComAcervo(est(10, { procedente: 10 }), est(10, { acordo: 10 }));
    expect(c.linhas).toHaveLength(5);
    expect(linha(c, "acordo").acervoQtd).toBe(0);
    expect(linha(c, "acordo").escritorioPct).toBe(100);
  });

  // O ponto do módulo: com 6 casos, um a mais move o percentual 17 pontos.
  // Nenhuma manchete pode sair daí.
  it("não destaca diferença quando a amostra do escritório é pequena", () => {
    const c = compararComAcervo(
      est(500, { procedente: 250, improcedente: 250 }),
      est(6, { procedente: 6 }),
    );
    expect(c.amostraPequena).toBe(true);
    expect(c.destaque).toBeNull();
    // Mas os números continuam visíveis — esconder seria pior.
    expect(linha(c, "procedente").escritorioPct).toBe(100);
  });

  it("destaca a maior diferença quando há amostra e ela é grande", () => {
    const c = compararComAcervo(
      est(500, { procedente: 100, improcedente: 400 }),
      est(20, { procedente: 16, improcedente: 4 }),
    );
    expect(c.amostraPequena).toBe(false);
    expect(c.destaque?.resultado).toBe("procedente");
    expect(c.destaque?.diferencaPp).toBe(60);
  });

  // Diferença de poucos pontos entre duas medições é a mesma coisa medida
  // duas vezes, não descoberta.
  it("não destaca diferença pequena mesmo com amostra boa", () => {
    const c = compararComAcervo(
      est(500, { procedente: 250, improcedente: 250 }),
      est(40, { procedente: 22, improcedente: 18 }),
    );
    expect(c.amostraPequena).toBe(false);
    expect(c.destaque).toBeNull();
  });

  it("o limiar de amostra é exatamente MIN_COMPARACAO", () => {
    const abaixo = compararComAcervo(
      est(100, { procedente: 100 }),
      est(MIN_COMPARACAO - 1, { improcedente: MIN_COMPARACAO - 1 }),
    );
    const noLimite = compararComAcervo(
      est(100, { procedente: 100 }),
      est(MIN_COMPARACAO, { improcedente: MIN_COMPARACAO }),
    );
    expect(abaixo.amostraPequena).toBe(true);
    expect(noLimite.amostraPequena).toBe(false);
    expect(noLimite.destaque).not.toBeNull();
  });

  it("acervo vazio não gera destaque — não há com o que comparar", () => {
    const c = compararComAcervo(est(0, {}), est(30, { procedente: 30 }));
    expect(c.destaque).toBeNull();
  });

  it("escritório sem nenhum caso decidido não inventa percentual", () => {
    const c = compararComAcervo(est(100, { procedente: 100 }), est(0, {}));
    expect(c.escritorioDecididos).toBe(0);
    expect(linha(c, "procedente").escritorioPct).toBe(0);
    expect(c.destaque).toBeNull();
  });

  it("conta os casos em andamento separados dos decididos", () => {
    const c = compararComAcervo(est(100, { procedente: 60 }), est(25, { procedente: 10 }));
    expect(c.escritorioTotal).toBe(25);
    expect(c.escritorioDecididos).toBe(10);
  });
});

describe("casoBateComFiltro", () => {
  const capa = {
    classe: "Procedimento Comum Cível",
    assuntos: [{ nome: "Contratos Bancários" }, { nome: "Juros" }],
    orgaoJulgador: "3ª Vara Cível",
  };

  it("casa por classe, ignorando acento e caixa", () => {
    expect(
      casoBateComFiltro(capa, "TJCE", {
        tribunal: null,
        classeTermo: "procedimento comum civel",
        assuntoTermo: null,
      }),
    ).toBe(true);
  });

  it("casa por assunto quando a capa traz lista de objetos", () => {
    expect(
      casoBateComFiltro(capa, "TJCE", {
        tribunal: null,
        classeTermo: null,
        assuntoTermo: "bancários",
      }),
    ).toBe(true);
  });

  it("aceita assunto como lista de strings", () => {
    expect(
      casoBateComFiltro({ classe: "Monitória", assuntos: ["Cheque"] }, "TJCE", {
        tribunal: null,
        classeTermo: null,
        assuntoTermo: "cheque",
      }),
    ).toBe(true);
  });

  it("exige TODOS os termos informados", () => {
    expect(
      casoBateComFiltro(capa, "TJCE", {
        tribunal: null,
        classeTermo: "Procedimento Comum",
        assuntoTermo: "Locação",
      }),
    ).toBe(false);
  });

  it("respeita o tribunal", () => {
    expect(
      casoBateComFiltro(capa, "TJSP", {
        tribunal: "TJCE",
        classeTermo: null,
        assuntoTermo: "bancários",
      }),
    ).toBe(false);
  });

  // Filtro que não restringe nada casaria com o escritório inteiro, e "seus
  // 400 casos" ao lado de um recorte de 12 não compara coisa nenhuma.
  it("filtro vazio não casa com nada", () => {
    expect(
      casoBateComFiltro(capa, "TJCE", { tribunal: null, classeTermo: null, assuntoTermo: null }),
    ).toBe(false);
  });

  it("caso sem capa não entra na comparação", () => {
    expect(
      casoBateComFiltro(null, "TJCE", {
        tribunal: "TJCE",
        classeTermo: null,
        assuntoTermo: null,
      }),
    ).toBe(false);
  });

  it("capa sem o campo pedido não casa por acidente", () => {
    expect(
      casoBateComFiltro({ classe: null, assuntos: null }, "TJCE", {
        tribunal: null,
        classeTermo: "execução",
        assuntoTermo: null,
      }),
    ).toBe(false);
  });
});
