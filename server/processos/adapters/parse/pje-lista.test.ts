/**
 * Parsers puros do PJe contra fixtures SINTÉTICAS (o ambiente não alcança
 * portal nenhum). Três cenários por parser: feliz, "nenhum encontrado" e
 * layout mudado — e neste último a regra é devolver VAZIO, nunca o campo
 * errado. É a primeira vez que a extração do motor roda contra HTML de
 * verdade num teste.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "./dom";
import { lerCapaPje, lerLinhasDaBusca, lerMovimentacoesPje } from "./pje-lista";

const fixture = (nome: string) => parseHtml(readFileSync(join(__dirname, "..", "__fixtures__", nome), "utf8"));

describe("parseHtml", () => {
  it("devolve um Document com querySelector e textContent", () => {
    const doc = parseHtml("<table><tr><th>Classe</th><td>Ação</td></tr></table>");
    expect(doc.querySelector("td")?.textContent).toBe("Ação");
    expect(doc.querySelectorAll("th, td").length).toBe(2);
  });
});

describe("lerLinhasDaBusca — grade de resultados pelo TÍTULO da coluna", () => {
  it("feliz: lê as duas linhas mesmo com as colunas fora da ordem usual", () => {
    const linhas = lerLinhasDaBusca(fixture("pje-lista-feliz.html"));
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toEqual({
      cnj: "3024938-55.2026.8.06.0001",
      classe: "Busca e Apreensão em Alienação Fiduciária",
      orgaoJulgador: "3ª Vara Cível de Fortaleza",
      autuadoEm: "11 ago 2025",
      poloAtivo: ["AURORA TELECOM NORDESTE S.A. (AUTOR)"],
      poloPassivo: [
        "MARCOS AURÉLIO RIBEIRO LIMA - CPF: 048.512.377-15 (REU)",
        "LIMA E FILHOS LTDA - CNPJ: 21.884.309/0001-46 (REU)",
      ],
    });
    expect(linhas[1]).toMatchObject({
      cnj: "0001234-12.2024.8.06.0001",
      classe: "Procedimento do Juizado Especial Cível",
      autuadoEm: "07/05/2026",
      poloAtivo: ["BANCO NORTE S.A. (REQUERENTE)"],
      poloPassivo: ["JOANA PEREIRA DA SILVA (REQUERIDO)"],
    });
  });

  it("feliz: a tabela de paginação (sem Classe/Polo) e o rodapé não viram linha", () => {
    const linhas = lerLinhasDaBusca(fixture("pje-lista-feliz.html"));
    expect(linhas.map((l) => l.cnj)).not.toContain("0001111-22.2020.8.06.0001");
    expect(linhas.every((l) => /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(l.cnj))).toBe(true);
  });

  it("nenhum encontrado: grade só com cabeçalho → vazio (o CNJ do rodapé não conta)", () => {
    expect(lerLinhasDaBusca(fixture("pje-lista-nenhum.html"))).toEqual([]);
  });

  it("layout mudado (títulos trocados): vazio, nunca campo trocado", () => {
    expect(lerLinhasDaBusca(fixture("pje-lista-layout-mudado.html"))).toEqual([]);
  });

  it("um título de coluna que É rótulo nunca vira valor: célula vazia fica null", () => {
    const doc = parseHtml(
      "<table id='x:processosTable'><tr><th>Número do Processo</th><th>Classe Judicial</th><th>Polo Ativo</th></tr>" +
        "<tr><td>0001234-12.2024.8.06.0001</td><td></td><td></td></tr></table>",
    );
    expect(lerLinhasDaBusca(doc)).toEqual([
      { cnj: "0001234-12.2024.8.06.0001", classe: null, orgaoJulgador: null, autuadoEm: null, poloAtivo: [], poloPassivo: [] },
    ]);
  });
});

describe("lerCapaPje — dl/dt/dd e th/td, recusando rótulo de tabela", () => {
  it("feliz: cada campo pelo rótulo exato; 'Valor do bem' não é valor da causa", () => {
    const { dataDistribuicaoIso, ...capa } = lerCapaPje(fixture("pje-capa-feliz.html"));
    expect(capa).toEqual({
      classe: "Busca e Apreensão em Alienação Fiduciária",
      orgaoJulgador: "3ª Vara Cível de Fortaleza",
      assuntos: ["Alienação Fiduciária", "Dano Moral"],
      valorCausa: "R$ 18.400,00",
      valorCausaCentavos: 1840000,
      dataDistribuicao: "11 ago 2025",
    });
    // `parseDataBR` (helper do spike) devolve instante no fuso do processo;
    // o que importa é o dia civil.
    const d = new Date(dataDistribuicaoIso!);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2025, 8, 11]);
  });

  it("nenhum encontrado (grade de cabeçalhos na tela): tudo null — 'Polo ativo' NÃO vira classe", () => {
    const capa = lerCapaPje(fixture("pje-capa-nenhum.html"));
    expect(capa.classe).toBeNull();
    expect(capa.orgaoJulgador).toBeNull();
    expect(capa.valorCausa).toBeNull();
    expect(capa.dataDistribuicao).toBeNull();
    expect(capa.assuntos).toEqual([]);
  });

  it("layout mudado (rótulos renomeados; rótulo conhecido sem célula): null em vez do vizinho", () => {
    const capa = lerCapaPje(fixture("pje-capa-layout-mudado.html"));
    expect(capa.classe).toBeNull();
    expect(capa.orgaoJulgador).toBeNull();
    expect(capa.valorCausa).toBeNull();
    expect(capa.valorCausaCentavos).toBeNull();
    expect(capa.assuntos).toEqual(["Dano Moral"]);
  });

  it("th/td na mesma linha também serve, e o valor que é rótulo é recusado", () => {
    const doc = parseHtml(
      "<table><tr><th>Classe judicial</th><td>Polo ativo</td></tr><tr><th>Órgão julgador</th><td>2ª Vara</td></tr></table>",
    );
    const capa = lerCapaPje(doc);
    expect(capa.classe).toBeNull();
    expect(capa.orgaoJulgador).toBe("2ª Vara");
  });
});

describe("lerMovimentacoesPje — #divTimeLine ou tabela de movimentações", () => {
  it("feliz: separadores de dia + hora do item; sub-documento não duplica; link do documento absoluto", () => {
    const movs = lerMovimentacoesPje(fixture("pje-movs-feliz.html"));
    expect(movs.map((m) => [m.data, m.texto])).toEqual([
      ["2026-05-07T14:23:00", "Juntada de Petição de habilitação nos autos Petição.pdf"],
      ["2026-05-07T09:05:00", "Conclusos para despacho"],
      ["2026-05-02T11:00:00", "Distribuído por sorteio abrir"],
    ]);
    expect(movs[0].documento).toBe("Petição.pdf");
    expect(movs[0].documentoUrl).toBe(
      "https://pje.tjce.jus.br/pje1grau/Processo/ConsultaDocumento/listView.seam?idDocumento=98765",
    );
    // Link JSF (javascript:void) não é documento baixável.
    expect(movs[2].documentoUrl).toBeNull();
    expect(movs[1].documentoUrl).toBeNull();
  });

  it("feliz: o script dentro do item não vira texto, e as datas do menu/rodapé ficam de fora", () => {
    const movs = lerMovimentacoesPje(fixture("pje-movs-feliz.html"));
    expect(movs.some((m) => m.texto.includes("__x"))).toBe(false);
    expect(movs.some((m) => m.data.startsWith("2026-09-12") || m.data.startsWith("2026-01-01"))).toBe(false);
  });

  it("nenhuma movimentação: timeline vazia → vazio, sem ler o rodapé", () => {
    expect(lerMovimentacoesPje(fixture("pje-movs-nenhum.html"))).toEqual([]);
  });

  it("layout mudado (sem timeline e sem tabela): vazio — nunca o body inteiro", () => {
    expect(lerMovimentacoesPje(fixture("pje-movs-layout-mudado.html"))).toEqual([]);
  });

  it("variante em tabela (consulta pública): linha = data + movimento; linha sem data não entra", () => {
    const movs = lerMovimentacoesPje(fixture("pje-movs-tabela.html"));
    expect(movs.map((m) => [m.data, m.texto])).toEqual([
      ["2026-05-07T14:23:00", "Juntada de Petição baixar"],
      ["2026-05-02", "Distribuído por sorteio"],
    ]);
    expect(movs[0].documento).toBe("Petição.pdf");
    expect(movs[0].documentoUrl).toBe("/consultaprocessual/detalhe-documento.seam?id=1");
  });
});
