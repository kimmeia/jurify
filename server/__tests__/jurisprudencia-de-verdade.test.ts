/**
 * "Uma IA que busca de tempos em tempos todo o material nos sites oficiais
 * para alimentarmos base de conhecimento e entendimentos regionais" — pedido
 * do dono em 13/09, aprovado no comparador `comparador-conhecimento-juridico`.
 *
 * O que estes testes guardam, em ordem de importância:
 *
 *  1. **A distinção que carrega o produto**: ementa é acórdão publicado e
 *     entra na peça; metadado do DataJud é número e não fundamenta. Apagar
 *     essa fronteira faz a IA citar estatística como se fosse precedente.
 *  2. **O robô não liga sozinho.** Fonte nasce desligada, e o cron só visita o
 *     que alguém ligou no painel depois de sondar. Subir versão não pode
 *     começar a bater no site de um tribunal.
 *  3. **Citação sem endereço não entra.** Ementa sem URL é descartada na
 *     gravação: o advogado tem que abrir o acórdão antes de assinar.
 *  4. **Nada foi removido na fusão.** As duas telas de antes continuam
 *     montadas, uma camada mais fundo.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  FONTES_OFICIAIS,
  coletaDevida,
  fonteOficialPorId,
  fontesQueTrazemEmenta,
  rotuloCadencia,
  urlDeBusca,
} from "../../shared/fontes-oficiais";
import {
  absolutizar,
  dataIso,
  extrairEmentasDeHtml,
  extrairEmentasDeJson,
  identificadorNoTexto,
} from "../jurisia/extrair-ementas";
import { consultaFullText } from "../jurisia/busca-ementas";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("ementa × metadado — a fronteira que o produto vende", () => {
  it("o DataJud está declarado como METADADO, não como jurisprudência", () => {
    const datajud = fonteOficialPorId("datajud");
    expect(datajud?.material).toBe("metadado");
    expect(datajud?.entrega).toMatch(/não traz texto de decisão/i);
  });

  it("as fontes de ementa são os portais de jurisprudência dos tribunais", () => {
    const comEmenta = fontesQueTrazemEmenta().map((f) => f.id);
    expect(comEmenta).toContain("stj-scon");
    expect(comEmenta).toContain("tjce-jurisprudencia");
    expect(comEmenta).not.toContain("datajud");
    // Toda fonte de EMENTA precisa de endereço de busca e de sigla de
    // tribunal — sem os dois ela não coleta nem entra no entendimento regional.
    // Súmula não busca por termo (conjunto fechado: pega-se a lista inteira),
    // então o que ela precisa é do endereço da lista.
    for (const f of fontesQueTrazemEmenta()) {
      if (f.material === "ementa") {
        expect(f.busca, `${f.id} sem endereço`).toMatch(/^https:\/\//);
        expect(f.tribunal, `${f.id} sem tribunal`).not.toBe("");
      } else {
        expect(f.listaCompleta, `${f.id} sem lista`).toMatch(/^https:\/\//);
      }
    }
  });

  it("o endereço da busca leva o termo escapado", () => {
    const f = fonteOficialPorId("stj-scon")!;
    expect(urlDeBusca(f, "capitalização de juros")).toContain("capitaliza%C3%A7%C3%A3o%20de%20juros");
    expect(urlDeBusca(fonteOficialPorId("datajud")!, "x")).toBeNull();
  });

  it("a cadência vira frase de gente", () => {
    expect(rotuloCadencia(12)).toBe("a cada 12h");
    expect(rotuloCadencia(24)).toBe("todo dia");
    expect(rotuloCadencia(168)).toBe("toda semana");
  });

  it("coleta vence pela cadência da fonte, não por relógio fixo", () => {
    const tjce = fonteOficialPorId("tjce-jurisprudencia")!; // 12h
    const agora = Date.parse("2026-09-14T12:00:00Z");
    expect(coletaDevida(tjce, null, agora)).toBe(true);
    expect(coletaDevida(tjce, new Date(agora - 11 * 3_600_000), agora)).toBe(false);
    expect(coletaDevida(tjce, new Date(agora - 13 * 3_600_000), agora)).toBe(true);
  });
});

describe("extrair ementa do que o portal devolve", () => {
  it("JSON: acha o registro em qualquer aninhamento", () => {
    const corpo = {
      result: {
        hits: {
          hits: [
            {
              _source: {
                titulo: "Apelação Cível 0123456-78.2025.8.06.0001",
                orgao: "1ª Câmara de Direito Privado",
                relator: "Des. Fulano de Tal",
                dataJulgamento: "12/08/2026",
                ementa:
                  "REVISIONAL. CONTRATO BANCÁRIO. CAPITALIZAÇÃO MENSAL EXPRESSAMENTE PACTUADA. LEGALIDADE. RECURSO PARCIALMENTE PROVIDO.",
                url: "https://esaj.tjce.jus.br/cjsg/acordao?id=1",
              },
            },
          ],
        },
      },
    };
    const [e] = extrairEmentasDeJson(corpo);
    expect(e.identificador).toBe("Apelação Cível 0123456-78.2025.8.06.0001");
    expect(e.orgao).toBe("1ª Câmara de Direito Privado");
    expect(e.julgadoEm).toBe("2026-08-12");
    expect(e.ementa).toMatch(/CAPITALIZAÇÃO MENSAL/);
    expect(e.url).toBe("https://esaj.tjce.jus.br/cjsg/acordao?id=1");
  });

  it("JSON: registro sem texto de decisão NÃO vira ementa", () => {
    // É o caso do DataJud: tem número, classe e movimento, e nenhuma ementa.
    const corpo = {
      hits: [{ numeroProcesso: "08012345620258060001", classe: "Procedimento Comum", movimentos: [] }],
    };
    expect(extrairEmentasDeJson(corpo)).toEqual([]);
  });

  it("JSON: texto curto demais não é ementa", () => {
    const corpo = { itens: [{ titulo: "Apelação 1", ementa: "Recurso provido." }] };
    expect(extrairEmentasDeJson(corpo)).toEqual([]);
  });

  it("JSON: ementa SEM identificação não entra — não dá pra citar o que não tem nome", () => {
    const corpo = {
      itens: [
        {
          ementa:
            "REVISIONAL. CONTRATO BANCÁRIO. CAPITALIZAÇÃO MENSAL EXPRESSAMENTE PACTUADA. LEGALIDADE. RECURSO PARCIALMENTE PROVIDO.",
          url: "https://x.jus.br/acordao/1",
        },
      ],
    };
    expect(extrairEmentasDeJson(corpo)).toEqual([]);
  });

  it("HTML: lê o bloco do resultado e pega o link do acórdão", () => {
    const html = `
      <table><tbody>
        <tr>
          <td>
            <a href="/cjsg/getArquivo.do?cdAcordao=99">Apelação Cível 1004567-12.2025.8.26.0100</a>
            <div>Órgão Julgador: 12ª Câmara de Direito Privado</div>
            <div>Relator: Des. Beltrano</div>
            <div>Data do julgamento: 29/07/2026</div>
            <div>Ementa: CONTRATO BANCÁRIO. JUROS REMUNERATÓRIOS DENTRO DA MÉDIA DE MERCADO. MANUTENÇÃO DA SENTENÇA DE IMPROCEDÊNCIA. RECURSO NÃO PROVIDO.</div>
          </td>
        </tr>
      </tbody></table>`;
    const [e] = extrairEmentasDeHtml(html, "https://esaj.tjsp.jus.br/cjsg/resultado.do");
    expect(e.identificador).toBe("1004567-12.2025.8.26.0100");
    expect(e.ementa).toMatch(/JUROS REMUNERATÓRIOS/);
    expect(e.url).toBe("https://esaj.tjsp.jus.br/cjsg/getArquivo.do?cdAcordao=99");
    expect(e.julgadoEm).toBe("2026-07-29");
  });

  it("HTML: dois resultados na mesma página viram DOIS julgados, não um bloco só", () => {
    // Sem pegar o MENOR bloco que tem ementa e número, a tabela inteira vira
    // um resultado só — com a ementa de um e o número do outro. É o erro que
    // transforma citação em invenção.
    // Os dois resultados dentro de um container (é como os portais montam a
    // lista), pra o bloco de fora ser um candidato de verdade.
    const bloco = (n: string, texto: string) => `
      <div class="resultado">
        <a href="/acordao/${n}">Apelação Cível ${n}</a>
        <span>Ementa: ${texto}</span>
      </div>`;
    const html = `<div class="lista">
      ${bloco("1004567-12.2025.8.26.0100", "CONTRATO BANCÁRIO. JUROS DENTRO DA MÉDIA DE MERCADO. SENTENÇA MANTIDA. RECURSO NÃO PROVIDO.")}
      ${bloco("1009999-55.2026.8.26.0100", "ALIENAÇÃO FIDUCIÁRIA. PURGAÇÃO DA MORA. RESTITUIÇÃO DO BEM DETERMINADA. RECURSO PROVIDO.")}
    </div>`;
    const achadas = extrairEmentasDeHtml(html, "https://esaj.tjsp.jus.br/cjsg/resultado.do");
    expect(achadas).toHaveLength(2);
    expect(achadas.map((e) => e.identificador)).toEqual([
      "1004567-12.2025.8.26.0100",
      "1009999-55.2026.8.26.0100",
    ]);
    expect(achadas[0].ementa).toMatch(/JUROS DENTRO DA MÉDIA/);
    expect(achadas[0].ementa).not.toMatch(/ALIENAÇÃO FIDUCIÁRIA/);
  });

  it("HTML: página sem a palavra EMENTA não inventa resultado", () => {
    const html = "<div><p>Nenhum registro encontrado para a pesquisa.</p></div>";
    expect(extrairEmentasDeHtml(html, "https://x.jus.br")).toEqual([]);
  });

  it("o identificador sai do número do processo, e o link relativo vira absoluto", () => {
    expect(identificadorNoTexto("blá 0812345-67.2025.8.06.0001 blá")).toBe("0812345-67.2025.8.06.0001");
    expect(identificadorNoTexto("sem número nenhum aqui")).toBeNull();
    expect(absolutizar("/a/b", "https://x.jus.br/c/d")).toBe("https://x.jus.br/a/b");
  });

  it("data em qualquer forma vira ISO", () => {
    expect(dataIso("29/07/2026")).toBe("2026-07-29");
    expect(dataIso("2026-07-29T10:00:00Z")).toBe("2026-07-29");
    expect(dataIso("sem data")).toBeNull();
  });
});

describe("a busca é por TEXTO — é o que dá precisão no termo jurídico", () => {
  it("a pergunta vira consulta booleana sem as palavras vazias", () => {
    const c = consultaFullText("O que o TJCE vem decidindo sobre capitalização de juros?");
    expect(c).toContain('"capitalização"');
    expect(c).toContain('"juros"');
    expect(c).not.toContain('"que"');
    expect(c).not.toContain('"sobre"');
  });

  it("cada palavra vai entre aspas — hífen e asterisco são operador no MySQL", () => {
    expect(consultaFullText("busca-e-apreensão")).toBe('"busca" "apreensão"');
  });

  it("pergunta só com palavra vazia devolve consulta vazia (e a busca não roda)", () => {
    expect(consultaFullText("o que é isso?")).toBe("");
  });
});

describe("o robô não começa sozinho", () => {
  const coletor = ler("server/jurisia/coletor-ementas.ts");

  it("a fonte nasce DESLIGADA no banco", () => {
    const mig = ler("drizzle/0230_jurisia_ementas.sql");
    expect(mig).toContain("`ligadaJurisFonte` BOOLEAN NOT NULL DEFAULT FALSE");
    expect(ler("drizzle/schema.ts")).toContain('ligada: boolean("ligadaJurisFonte").default(false).notNull()');
  });

  it("o cron só percorre fonte ligada, e só quando a cadência vence", () => {
    expect(coletor).toContain("eq(jurisiaFontesColeta.ligada, true)");
    expect(coletor).toContain("if (!coletaDevida(fonte, linha.ultimaColetaEm, agora)) continue;");
  });

  it("ligar NÃO coleta na hora — quem coleta é a cadência", () => {
    const admin = ler("server/routers/admin.ts");
    expect(admin).toContain("jurisiaLigarFonte:");
    // A procedure de ligar chama `ligarFonte` e mais nada: se ela chamasse
    // `coletarFonte`, clicar no interruptor viraria uma batida no tribunal.
    const bloco = admin.slice(admin.indexOf("jurisiaLigarFonte:"), admin.indexOf("jurisiaColetarFonte:"));
    expect(bloco).toContain("await ligarFonte(input.fonteId, input.ligada);");
    expect(bloco).not.toContain("coletarFonte");
  });

  it("403/401 é marcado como BLOQUEADA — é bloqueio de quem chama, não da busca", () => {
    expect(coletor).toContain("bloqueada = r.status === 403 || r.status === 401;");
  });

  it("o cron pergunta de hora em hora, mas quem manda é a cadência de cada fonte", () => {
    const crons = ler("server/_core/cron-jobs.ts");
    expect(crons).toContain("rodarColetaDevida");
    expect(crons).toContain("setInterval(rodarColetaEmentas, 60 * 60 * 1000);");
  });
});

describe("citação sem endereço não entra", () => {
  it("ementa sem URL é descartada na gravação", () => {
    const coletor = ler("server/jurisia/coletor-ementas.ts");
    expect(coletor).toContain("const url = b.url;\n    if (!url) continue;");
  });

  it("o banco exige a URL e não deixa duplicar o mesmo julgado", () => {
    const mig = ler("drizzle/0230_jurisia_ementas.sql");
    expect(mig).toContain("`urlJurisEm` VARCHAR(500) NOT NULL");
    expect(mig).toContain("UNIQUE KEY `uq_juris_ementa` (`fonteIdJurisEm`, `identificadorJurisEm`)");
    expect(mig).toContain("FULLTEXT INDEX `ft_juris_ementa` (`ementaJurisEm`)");
  });

  it("a tela do advogado só desenha o link quando ele existe", () => {
    const tela = ler("client/src/pages/JurisIa.tsx");
    expect(tela).toContain("{e.url && (");
    expect(tela).toContain("ver no tribunal");
  });
});

describe("a resposta separa o que fundamenta do que só mede", () => {
  it("a ementa entra na conversa e vai gravada na resposta", () => {
    const una = ler("server/jurisia/conversa-una.ts");
    expect(una).toContain('const { buscarEmentas } = await import("./busca-ementas");');
    expect(una).toContain("tribunalPreferido: medido?.filtro?.tribunal ?? null,");
    expect(ler("server/jurisia/router-jurisia.ts")).toContain("jurisprudencia: r.jurisprudencia,");
  });

  it("o texto que separa o que fundamenta do que só mede está na tela", () => {
    const tela = ler("client/src/pages/JurisIa.tsx");
    expect(tela).toContain("O que sustenta a resposta");
    // A fronteira é o que este teste guarda, não a redação: súmula e ementa
    // entram na peça; o painel de número, não.
    expect(tela).toMatch(/Súmula é entendimento firmado do tribunal e ementa é acórdão publicado/);
    expect(tela).toMatch(/as duas\s+entram na peça/);
    expect(tela).toMatch(/estatística: diz como costuma terminar, não\s+fundamenta/);
  });

  it("falha na busca de ementa não derruba a conversa", () => {
    const una = ler("server/jurisia/conversa-una.ts");
    const bloco = una.slice(una.indexOf("let ementas:"), una.indexOf("const [escRow]"));
    expect(bloco).toContain("} catch (err) {");
    expect(bloco).toContain("Falha ao buscar ementas do acervo");
  });
});

describe("a fusão não removeu nada", () => {
  it("as duas telas de antes continuam montadas", () => {
    const conhecimento = ler("client/src/pages/admin/ConhecimentoJuridicoTab.tsx");
    expect(conhecimento).toContain("<BaseJuridicaTab />");
    expect(conhecimento).toContain("<AdminJurisIa />");
  });

  it("o painel técnico do DataJud continua alcançável, numa dobra", () => {
    const conhecimento = ler("client/src/pages/admin/ConhecimentoJuridicoTab.tsx");
    expect(conhecimento).toContain("Tribunais e varredura do DataJud");
    expect(conhecimento).toContain("nada foi tirado");
  });

  it("entendimento regional conta por TRIBUNAL, e casa a ementa fora do SQL", () => {
    const admin = ler("server/routers/admin.ts");
    expect(admin).toContain("GROUP BY p.tribunalJurisProc");
    // A contagem de ementa vem de uma SEGUNDA consulta e é casada em JS.
    // Comparar a sigla entre as duas tabelas num JOIN depende do collation
    // delas baterem — e foi assim que esta consulta morreu na primeira
    // tentativa ("Illegal mix of collations"), o mesmo tropeço da 0196.
    expect(admin).toContain("FROM jurisia_ementas GROUP BY tribunalJurisEm");
    expect(admin).toContain("ementasPorTribunal.get(String(r.tribunal).toUpperCase())");
  });
});
