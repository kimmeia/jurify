/**
 * O card de nova ação mostrou "Polo ativo" como NATUREZA DA AÇÃO, sem partes,
 * sem vara e sem nada mais.
 *
 * O robô abre a busca do tribunal, clica no resultado e lê a página do
 * processo. Quando essa página não abriu, ele leu a TABELA DE RESULTADOS que
 * ficou na tela: procurando "Classe judicial" achou o TÍTULO da coluna e pegou
 * o texto ao lado, que era o título da coluna seguinte — "Polo ativo". Sem
 * partes naquela tela, o polo virou "desconhecido".
 *
 * As travas aqui:
 *   1. página que não é a do processo não vira capa (adapter confere e falha);
 *   2. rótulo de coluna nunca é valor de campo (gravação E leitura);
 *   3. capa vazia não sobrescreve capa boa de processo vigiado;
 *   4. a grade da busca vira fonte de verdade (lida pelos títulos das colunas);
 *   5. faltando as duas, o DataJud preenche a natureza — sem partes, e sem
 *      derrubar polo que já se sabia.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ehRotuloDeTabela,
  montarCapaNovaAcao,
  lerCapaNovaAcao,
  lerFalhaDeCapa,
  capaTemConteudo,
  ROTULO_FONTE_CAPA,
} from "../../shared/nova-acao-capa";
import {
  capaBrutaDaLinha,
  capaDoScraperTemConteudo,
  linhaDoCnj,
} from "../processos/capa-da-lista";
import { lerCapaDataJud, indiceDataJudDoCnj } from "../processos/capa-datajud";
import { conteudoComCapaNova } from "../processos/gravar-capa-no-card";
import { identificarPoloDoCliente } from "../processos/polo-matcher";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");

const CNJ = "0813472-55.2026.8.06.0001";

const LINHA = {
  cnj: CNJ,
  classe: "Busca e Apreensão em Alienação Fiduciária",
  orgaoJulgador: "3ª Vara Cível de Fortaleza",
  autuadoEm: "02/09/2026",
  poloAtivo: ["BANCO CREDIMOTOR S.A."],
  poloPassivo: ["MARIANA OLIVEIRA DE SOUZA - CPF: 810.665.623-34"],
};

describe("rótulo de coluna não é valor de campo", () => {
  it("reconhece os títulos que o tribunal escreve na tela", () => {
    for (const r of ["Polo ativo", "POLO PASSIVO", "Classe judicial", "Órgão julgador", "Autuado em", "Assunto:"]) {
      expect(ehRotuloDeTabela(r)).toBe(true);
    }
  });

  it("não confunde valor de verdade com rótulo", () => {
    for (const v of ["Busca e Apreensão em Alienação Fiduciária", "3ª Vara Cível de Fortaleza", "Alienação Fiduciária"]) {
      expect(ehRotuloDeTabela(v)).toBe(false);
    }
  });

  it("a gravação descarta classe, órgão e assunto que sejam rótulo", () => {
    const capa = montarCapaNovaAcao(
      { classe: "Polo ativo", orgaoJulgador: "Autuado em", assuntos: ["Assunto"], partes: [] },
      "desconhecido",
      "2026-09-11T12:00:00Z",
    );
    expect(capa.classe).toBeNull();
    expect(capa.orgaoJulgador).toBeNull();
    expect(capa.assuntos).toEqual([]);
    expect(capaTemConteudo(capa)).toBe(false);
  });

  it("a leitura limpa o que já está gravado errado — e o card volta a pedir socorro", () => {
    const json = JSON.stringify({
      cnj: CNJ,
      capa: { classe: "Polo ativo", orgaoJulgador: null, partes: [], assuntos: [] },
      capaFalhou: false,
    });
    expect(lerCapaNovaAcao(json)).toBeNull();
    // capaFalhou gravado como false, mas não sobrou capa nenhuma: pra tela isso
    // é falha de leitura, com o aviso âmbar e os botões de recuperar.
    expect(lerFalhaDeCapa(json)).toBe(true);
  });

  it("card antigo sem capa nenhuma continua sendo card antigo, não falha", () => {
    expect(lerFalhaDeCapa(JSON.stringify({ cnj: CNJ }))).toBe(false);
    expect(lerFalhaDeCapa(null)).toBe(false);
    expect(lerFalhaDeCapa("{quebrado")).toBe(false);
  });

  it("capa com conteúdo de verdade continua passando", () => {
    const capa = montarCapaNovaAcao(
      { classe: "Execução de Título Extrajudicial", orgaoJulgador: "2ª Vara Cível", partes: [] },
      "passivo",
      "2026-09-11T12:00:00Z",
      { fonte: "processo" },
    );
    expect(capaTemConteudo(capa)).toBe(true);
    const lida = lerCapaNovaAcao(JSON.stringify({ capa }));
    expect(lida?.classe).toBe("Execução de Título Extrajudicial");
    expect(lida?.fonte).toBe("processo");
    expect(lerFalhaDeCapa(JSON.stringify({ capa }))).toBe(false);
  });

  it("procedência desconhecida não vira rótulo inventado", () => {
    expect(lerCapaNovaAcao(JSON.stringify({ capa: { classe: "X", fonte: "chute" } }))?.fonte).toBeNull();
    expect(Object.keys(ROTULO_FONTE_CAPA)).toEqual(["processo", "lista", "datajud"]);
  });
});

describe("a lista do tribunal vira fonte", () => {
  it("acha a linha do CNJ pedido comparando só os dígitos", () => {
    expect(linhaDoCnj([LINHA], "08134725520268060001")?.classe).toBe(LINHA.classe);
    expect(linhaDoCnj([LINHA], "0815907-12.2026.8.06.0001")).toBeNull();
    expect(linhaDoCnj(null, CNJ)).toBeNull();
  });

  it("monta a capa com classe, vara, data e os dois polos", () => {
    const bruta = capaBrutaDaLinha(LINHA);
    expect(bruta.classe).toBe(LINHA.classe);
    expect(bruta.orgaoJulgador).toBe(LINHA.orgaoJulgador);
    expect(bruta.dataDistribuicao).toContain("2026-09-02");
    expect(bruta.partes.map((p) => p.polo)).toEqual(["ativo", "passivo"]);
    // A grade não traz assunto: o card não inventa um.
    expect(bruta.assuntos).toEqual([]);
  });

  it("o CPF escrito dentro do nome coloca a cliente no polo passivo", () => {
    const polo = identificarPoloDoCliente(
      "Mariana Oliveira de Souza",
      "81066562334",
      capaBrutaDaLinha(LINHA).partes,
    );
    expect(polo).toBe("passivo");
  });

  it("capa montada da lista carrega a procedência", () => {
    const capa = montarCapaNovaAcao(capaBrutaDaLinha(LINHA), "passivo", "2026-09-11T12:00:00Z", {
      fonte: "lista",
    });
    expect(capa.fonte).toBe("lista");
    expect(capaTemConteudo(capa)).toBe(true);
  });
});

describe("capa vazia não apaga capa boa", () => {
  it("rótulo e vazio não contam como conteúdo do scraper", () => {
    expect(capaDoScraperTemConteudo(null)).toBe(false);
    expect(capaDoScraperTemConteudo({ classe: "Polo ativo", orgaoJulgador: null, partes: [] })).toBe(false);
    expect(capaDoScraperTemConteudo({ classe: null, orgaoJulgador: null, partes: [] })).toBe(false);
    expect(capaDoScraperTemConteudo({ classe: "Execução", orgaoJulgador: null, partes: [] })).toBe(true);
    expect(capaDoScraperTemConteudo({ classe: null, orgaoJulgador: null, partes: [{ nome: "X" }] })).toBe(true);
  });

  it("o cron só inclui capaJson/partesJson no UPDATE quando há o que gravar", () => {
    const cron = ler("server/processos/cron-monitoramento.ts");
    expect(cron).toContain("capaDoScraperTemConteudo(resultado.capa) ? resultado.capa : null");
    expect(cron).toContain("const camposDaCapa = capaUtil");
    // Nenhum UPDATE pode voltar a escrever os campos crus.
    expect(cron).not.toMatch(/\n\s+capaJson,\n/);
    expect(cron).not.toMatch(/\n\s+partesJson,\n/);
    expect((cron.match(/\.\.\.camposDaCapa,/g) ?? []).length).toBe(4);
  });
});

describe("DataJud como reserva", () => {
  it("o índice sai do próprio CNJ", () => {
    expect(indiceDataJudDoCnj(CNJ)).toBe("api_publica_tjce");
    expect(indiceDataJudDoCnj("0800000-00.2026.4.01.3300")).toBe("api_publica_trf1");
    expect(indiceDataJudDoCnj("nada")).toBeNull();
  });

  it("traduz o que o CNJ devolve", () => {
    const capa = lerCapaDataJud({
      classe: { codigo: 1, nome: "Execução de Título Extrajudicial" },
      assuntos: [{ nome: "Contratos Bancários" }],
      orgaoJulgador: { nome: "2ª Vara Cível de Caucaia" },
      dataAjuizamento: "2026-09-01T00:00:00.000Z",
    });
    expect(capa?.classe).toBe("Execução de Título Extrajudicial");
    expect(capa?.assuntos).toEqual(["Contratos Bancários"]);
    expect(capa?.orgaoJulgador).toBe("2ª Vara Cível de Caucaia");
    expect(capa?.dataAjuizamento).toContain("2026-09-01");
  });

  it("resposta sem nada vira null em vez de capa vazia", () => {
    expect(lerCapaDataJud(null)).toBeNull();
    expect(lerCapaDataJud({})).toBeNull();
    expect(lerCapaDataJud({ movimentos: [{ nome: "x" }] })).toBeNull();
  });

  it("a consulta nunca é feita sem chave nem sem índice", () => {
    const mod = ler("server/processos/capa-datajud.ts");
    expect(mod).toContain("await chaveDataJud()");
    expect(mod).toContain("query: { match: { numeroProcesso: numero } }");
    // Reserva que derruba o caminho principal não é reserva.
    expect(mod).toContain("return null;");
    expect(mod).toContain("catch (err)");
  });
});

describe("gravar no card o que veio depois", () => {
  const capaNova = montarCapaNovaAcao(
    { classe: "Execução de Título Extrajudicial", orgaoJulgador: "2ª Vara", partes: [] },
    "desconhecido",
    "2026-09-11T12:00:00Z",
    { fonte: "datajud" },
  );

  it("marcação feita à mão manda sobre leitura automática", () => {
    const antes = JSON.stringify({
      cnj: CNJ,
      poloDoCliente: "passivo",
      poloManual: { userId: 7, em: "2026-09-10T10:00:00Z" },
    });
    const { json, polo } = conteudoComCapaNova(antes, {
      ...capaNova,
      poloDoCliente: "ativo",
    });
    expect(polo).toBe("passivo");
    expect(JSON.parse(json).capa.poloDoCliente).toBe("passivo");
  });

  it("leitura sem partes não apaga o polo que já se sabia", () => {
    const antes = JSON.stringify({ cnj: CNJ, poloDoCliente: "passivo" });
    const { polo } = conteudoComCapaNova(antes, capaNova);
    expect(polo).toBe("passivo");
  });

  it("leitura que achou o polo atualiza o card", () => {
    const antes = JSON.stringify({ cnj: CNJ, poloDoCliente: "desconhecido" });
    const { json, polo } = conteudoComCapaNova(antes, { ...capaNova, poloDoCliente: "passivo" });
    expect(polo).toBe("passivo");
    const lido = JSON.parse(json);
    expect(lido.capaFalhou).toBe(false);
    expect(lido.capa.classe).toBe("Execução de Título Extrajudicial");
    expect(lido.cnj).toBe(CNJ);
  });

  it("JSON quebrado não impede a gravação", () => {
    const { json } = conteudoComCapaNova("{quebrado", capaNova);
    expect(JSON.parse(json).capa.classe).toBe("Execução de Título Extrajudicial");
  });

  it("a gravação é escopada por escritório e confere o tipo do evento", () => {
    const mod = ler("server/processos/gravar-capa-no-card.ts");
    // Duas vezes: a leitura do card e o UPDATE. Escapar em uma só já deixaria
    // um escritório mexer no card do outro.
    expect((mod.match(/eq\(eventosProcesso\.escritorioId, escritorioId\)/g) ?? []).length).toBe(2);
    expect((mod.match(/eq\(eventosProcesso\.tipo, "nova_acao"\)/g) ?? []).length).toBe(2);
    expect(mod).toContain("eq(motorMonitoramentos.escritorioId, escritorioId)");
  });
});

describe("o adapter não lê a página errada", () => {
  const adapter = ler("scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts");

  it("confere se está na página do processo antes de extrair", () => {
    expect(adapter).toContain("estaNaPaginaDoProcesso");
    expect(adapter).toContain("temDetalhe || !temGrade");
    expect(adapter).toContain('categoriaErro: "detalhe_nao_abriu"');
  });

  it("tenta abrir o processo mais de uma vez antes de desistir", () => {
    expect(adapter).toMatch(/tentativa <= 2 && !abriuDetalhe/);
  });

  it("o XPath de fallback só aceita célula de valor, nunca outro cabeçalho", () => {
    expect(adapter).toContain("following-sibling::dd[1] | following-sibling::td[1]");
    expect(adapter).not.toContain("`following-sibling::*[1] |");
  });

  it("o valor lido é recusado quando é rótulo de coluna", () => {
    expect(adapter).toContain("const ehRotulo = ");
    expect((adapter.match(/if \(v && !ehRotulo\(v\)\) return v;/g) ?? []).length).toBe(2);
  });

  it("a grade é lida pelos títulos das colunas, e a busca por CPF devolve as linhas", () => {
    expect(adapter).toContain("extrairLinhasDaBusca");
    expect(adapter).toContain('cnj: ["numero do processo", "processo", "numero"]');
    expect(adapter).toContain("const linhas = await this.extrairLinhasDaBusca(page);");
    expect(adapter).toContain("linhas,");
  });
});

describe("a tela diz de onde veio", () => {
  const tela = ler("client/src/pages/Processos.tsx");

  it("mostra a procedência da capa", () => {
    expect(tela).toContain("ROTULO_FONTE_CAPA[capa.fonte]");
    expect(tela).toContain("fonte: a.capa.fonte ?? null");
  });

  it("oferece o DataJud de graça quando a capa faltou", () => {
    expect(tela).toContain("Buscar a natureza no DataJud");
    expect(tela).toContain("completarCapaPeloDataJud");
    expect(tela).toContain("grátis");
  });

  it("o que a consulta paga trouxe fica gravado", () => {
    expect(tela).toContain("Detalhes carregados e guardados no card");
    expect(tela).toMatch(/carregarDetalhesMut\.mutate\(\{ cnj, credencialId: credIdMon \?\? undefined, acaoId \}\)/);
  });

  it("o rótulo do botão fala em consulta, não em crédito", () => {
    expect(tela).toContain("1 consulta");
  });
});

describe("as procedures", () => {
  const router = ler("server/routers/processos.ts");

  it("consultarCNJSincrono aceita o card e grava a capa nele", () => {
    expect(router).toContain("acaoId: z.number().int().positive().optional()");
    expect(router).toMatch(/if \(input\.acaoId && resultado\.capa\) \{[\s\S]{0,200}gravarCapaNoCard/);
    expect(router).toContain('fonte: "processo",');
  });

  it("completarCapaPeloDataJud é escopada e não custa consulta", () => {
    expect(router).toContain("completarCapaPeloDataJud: protectedProcedure");
    expect(router).toContain("capaPorCnjNoDataJud(evento.cnj)");
    expect(router).toContain('fonte: "datajud",');
    // Nenhuma cobrança no caminho do DataJud.
    const trecho = router.slice(
      router.indexOf("completarCapaPeloDataJud: protectedProcedure"),
      router.indexOf("A pessoa diz de que lado o cliente está"),
    );
    expect(trecho).not.toContain("contarUso(");
    expect(trecho).toContain("eq(eventosProcesso.escritorioId, esc.escritorio.id)");
  });
});

describe("o cron escolhe a fonte na ordem certa", () => {
  const cron = ler("server/processos/cron-monitoramento.ts");

  it("processo primeiro, depois a lista, depois o DataJud", () => {
    const iProcesso = cron.indexOf('escolhida = montar(detalhe.capa, "processo")');
    const iLista = cron.indexOf('escolhida = montar(capaBrutaDaLinha(linha), "lista")');
    const iDataJud = cron.indexOf("await capaPorCnjNoDataJud(cnj)");
    expect(iProcesso).toBeGreaterThan(0);
    expect(iLista).toBeGreaterThan(iProcesso);
    expect(iDataJud).toBeGreaterThan(iLista);
    expect(cron).toContain("if (!escolhida && linha)");
    expect(cron).toContain("if (!escolhida) {");
  });

  it("a linha da grade viaja da busca por CPF até o CNJ novo", () => {
    expect(cron).toContain("linhas: resultado.linhas ?? []");
    expect(cron).toContain("linha: linhaDoCnj(c.linhas, cnj)");
  });

  it("capa sem conteúdo não é escolhida", () => {
    expect(cron).toContain("if (!capaTemConteudo(capa)) return null;");
  });
});
