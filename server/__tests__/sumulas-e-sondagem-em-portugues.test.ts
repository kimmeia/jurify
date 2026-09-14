/**
 * "deveria ter súmulas stj/stf, acórdãos, resp né? isso serve de base para o
 * jurisia e lá o adv vai conseguir fazer a pesquisa e a peça dele. Ideia é
 * essa. para isso precisamos primeiro fazer essa base de conhecimento" +
 * "e buscar isso automático já que é público as informações" — dono, 14/09,
 * depois de olhar o resultado da sondagem e responder "entendi nada,
 * sinceramente".
 *
 * O que estes testes guardam:
 *
 *  1. **Súmula é material de primeira classe.** Ela se busca de um jeito
 *     diferente de ementa (conjunto FECHADO: pega-se a lista inteira, sem termo)
 *     e por isso tem extrator próprio — o de ementa exige número de processo, e
 *     súmula não tem processo nenhum. Rodar o extrator errado devolve zero, e o
 *     zero pareceria "a fonte não serve".
 *  2. **Súmula cancelada não entra.** Quem cita súmula cancelada perde a causa;
 *     o sistema não pode ser o lugar de onde ela saiu.
 *  3. **A tela fala português.** Nenhum `403`, `tls`, `dns` ou "é o IP" como
 *     recado principal: cada linha diz o que aconteceu e de quem é o conserto.
 *     O número técnico continua na tela, uma camada ao lado — ele não foi
 *     removido, foi posto no lugar certo.
 *  4. **O que a sondagem mediu está gravado na lista de fontes.** "É público"
 *     e "o nosso servidor consegue ler" são coisas diferentes; a chave de ligar
 *     continua clicável (medida velha não decide para sempre), mas a tela avisa
 *     onde o clique tem chance.
 *  5. **A sondagem bate na porta que o ROBÔ usa.** Medir a página do formulário
 *     e ligar a coleta na página de resultado é o erro que faz "esse tribunal
 *     traz ementa" parecer provado quando o que se viu foi o rótulo do campo de
 *     busca.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  FONTES_OFICIAIS,
  enderecoDaFonte,
  fonteCitavel,
  fonteOficialPorId,
  ligarTemChance,
  rotuloSituacao,
  urlDeBusca,
} from "../../shared/fontes-oficiais";
import {
  ORDEM_DO_TOM,
  recadoDaSonda,
  resumoDaSondagem,
  type SondaParaLer,
} from "../../shared/sondagem-em-portugues";
import {
  colherSumulas,
  extrairSumulasDeHtml,
  extrairSumulasDeJson,
  extrairSumulasDeTexto,
  identificadorDaSumula,
} from "../jurisia/extrair-sumulas";
import { contarCitacoes, rotuloCitacoes } from "../../shared/jurisia-una";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/** Uma sonda "respondeu bem" que cada teste estraga no campo que quer medir. */
const sonda = (p: Partial<SondaParaLer> = {}): SondaParaLer => ({
  status: 200,
  veredito: "responde-html",
  temEmenta: true,
  sumulasNoCorpo: 0,
  causa: null,
  retryNavegador: null,
  ...p,
});

describe("súmula é material de primeira classe, com extrator próprio", () => {
  it("as súmulas do STJ e do STF estão declaradas como fonte", () => {
    const ids = FONTES_OFICIAIS.filter((f) => f.material === "sumula").map((f) => f.id);
    expect(ids).toContain("stj-sumulas");
    expect(ids).toContain("stf-sumulas");
    expect(ids).toContain("stf-sumulas-vinculantes");
  });

  it("súmula entra no acervo de citação, metadado não", () => {
    expect(fonteCitavel(fonteOficialPorId("stj-sumulas")!)).toBe(true);
    expect(fonteCitavel(fonteOficialPorId("stj-scon")!)).toBe(true);
    expect(fonteCitavel(fonteOficialPorId("datajud")!)).toBe(false);
  });

  it("súmula se pega pela lista inteira — o termo de busca é ignorado", () => {
    const sumula = fonteOficialPorId("stj-sumulas")!;
    // O conjunto é fechado: buscar por palavra traria um pedaço do que caberia
    // completo, e depois ninguém saberia qual pedaço falta.
    expect(enderecoDaFonte(sumula, "dano moral")).toBe(sumula.listaCompleta);
    expect(enderecoDaFonte(sumula, "")).toBe(sumula.listaCompleta);
    expect(urlDeBusca(sumula, "dano moral")).toBeNull();

    const ementa = fonteOficialPorId("tjsp-cjsg")!;
    expect(enderecoDaFonte(ementa, "dano moral")).toContain("dano%20moral");
  });

  it("separa uma por uma pelo número, com o identificador que se cita na peça", () => {
    const { sumulas } = extrairSumulasDeTexto(
      "SÚMULA N. 297 O Código de Defesa do Consumidor é aplicável às instituições financeiras. " +
        "SÚMULA N. 382 A estipulação de juros remuneratórios superiores a doze por cento ao ano, por si só, não indica abusividade.",
      "STJ",
    );
    expect(sumulas).toHaveLength(2);
    expect(sumulas[0].identificador).toBe("Súmula 297/STJ");
    expect(sumulas[0].texto).toMatch(/^O Código de Defesa do Consumidor/);
    expect(sumulas[0].texto).not.toMatch(/SÚMULA/);
    expect(sumulas[1].numero).toBe(382);
  });

  it("súmula vinculante é reconhecida e citada como tal", () => {
    const { sumulas } = extrairSumulasDeTexto(
      "Súmula Vinculante 11 Só é lícito o uso de algemas em casos de resistência e de fundado receio de fuga ou de perigo à integridade física própria ou alheia.",
      "STF",
    );
    expect(sumulas).toHaveLength(1);
    expect(sumulas[0].vinculante).toBe(true);
    expect(sumulas[0].identificador).toBe("Súmula Vinculante 11/STF");
    expect(identificadorDaSumula(11, false, "STF")).toBe("Súmula 11/STF");
  });

  it("súmula cancelada fica de fora, e a conta das que ficaram volta", () => {
    const { sumulas, canceladas } = extrairSumulasDeTexto(
      "Súmula 100 (Cancelada) Este enunciado deixou de valer e não pode ser citado em peça nenhuma. " +
        "Súmula 101 Enunciado que continua em vigor e pode ser citado sem medo pelo advogado.",
      "STJ",
    );
    expect(canceladas).toBe(1);
    expect(sumulas.map((s) => s.numero)).toEqual([101]);
  });

  it("súmula cancelada fica de fora também quando vem de API", () => {
    // A trava tem que existir nos DOIS leitores: a lista do STF chega em JSON e
    // traz as canceladas junto, marcadas no próprio texto.
    const { sumulas, canceladas } = extrairSumulasDeJson(
      {
        itens: [
          {
            numero: 100,
            texto: "(Cancelada) Este enunciado deixou de valer e não pode ser citado em peça nenhuma.",
          },
          {
            numero: 101,
            texto: "Enunciado que continua em vigor e pode ser citado sem medo pelo advogado.",
          },
        ],
      },
      "STF",
    );
    expect(canceladas).toBe(1);
    expect(sumulas.map((s) => s.numero)).toEqual([101]);
  });

  it("índice que só lista número não vira enunciado picado", () => {
    // A página de sumário tem "Súmula 1 ..... 12" e nada de enunciado — e o
    // sumário costuma vir ANTES da lista de verdade, no mesmo arquivo. Deixar o
    // número da página entrar como texto encheria o acervo de citação vazia.
    const { sumulas } = extrairSumulasDeTexto(
      "Sumário Súmula 1 ....... 12 Súmula 2 ....... 13 Súmula 3 ....... 14",
      "STJ",
    );
    expect(sumulas).toHaveLength(0);
  });

  it("a mesma súmula repetida na página entra uma vez", () => {
    const enunciado = "O Código de Defesa do Consumidor é aplicável às instituições financeiras.";
    const { sumulas } = extrairSumulasDeTexto(
      `Súmula 297 ${enunciado} Súmula 297 ${enunciado}`,
      "STJ",
    );
    expect(sumulas).toHaveLength(1);
  });

  it("lê a página descartando script e style", () => {
    // Os dois ficam DENTRO do body de propósito: é onde portal de tribunal
    // costuma pôr script, e é o único lugar onde a remoção muda o resultado.
    const html =
      "<html><body><div class='lista'>" +
      "<style>.x{content:'Súmula 999 isto aqui é estilo e não pode entrar de jeito nenhum no acervo'}</style>" +
      "<p>Súmula 297 O Código de Defesa do Consumidor é aplicável às instituições financeiras.</p>" +
      "<script>var s = 'Súmula 998 isto aqui é script e também não pode entrar no acervo jamais';</script>" +
      "</div></body></html>";
    const { sumulas } = extrairSumulasDeHtml(html, "STJ");
    expect(sumulas.map((s) => s.numero)).toEqual([297]);
  });

  it("lê a resposta de API, mesmo com o número só dentro do texto", () => {
    const payload = {
      result: {
        hits: {
          hits: [
            {
              _source: {
                titulo:
                  "Súmula 7 A pretensão de simples reexame de prova não enseja recurso especial nesta corte superior.",
              },
            },
            {
              _source: {
                numero: "83",
                texto:
                  "Não se conhece do recurso especial pela divergência, quando a orientação do tribunal se firmou no mesmo sentido da decisão recorrida.",
              },
            },
          ],
        },
      },
    };
    const { sumulas } = extrairSumulasDeJson(payload, "STJ");
    expect(sumulas.map((s) => s.numero).sort((a, b) => a - b)).toEqual([7, 83]);
    const sete = sumulas.find((s) => s.numero === 7)!;
    expect(sete.texto).toMatch(/^A pretensão de simples reexame/);
  });

  it("escolhe o leitor pelo que o corpo é, não pelo que a fonte prometeu", () => {
    const enunciado = "O Código de Defesa do Consumidor é aplicável às instituições financeiras.";
    expect(colherSumulas(`{"itens":[{"numero":297,"texto":"${enunciado}"}]}`, "STJ").sumulas).toHaveLength(1);
    expect(colherSumulas(`<div><p>Súmula 297 ${enunciado}</p></div>`, "STJ").sumulas).toHaveLength(1);
    expect(colherSumulas(`Súmula 297 ${enunciado}`, "STJ").sumulas).toHaveLength(1);
  });
});

describe("o caminho de colar o texto oficial existe, e passa pelo mesmo leitor", () => {
  it("a procedure de importar existe e é do admin", () => {
    const admin = ler("server/routers/admin.ts");
    expect(admin).toContain("jurisiaImportarSumulas: adminProcedure");
    expect(admin).toContain('const { importarSumulasDeTexto } = await import("../jurisia/coletor-ementas");');
  });

  it("importar de texto usa o MESMO extrator da coleta automática", () => {
    const coletor = ler("server/jurisia/coletor-ementas.ts");
    const bloco = coletor.slice(
      coletor.indexOf("export async function importarSumulasDeTexto"),
      coletor.indexOf("async function gravarSumulas"),
    );
    expect(bloco).toContain("colherSumulas(opts.texto, fonte.tribunal)");
    // Fonte que não é de súmula não entra por esta porta.
    expect(bloco).toContain('fonte.material !== "sumula"');
  });

  it("a coleta automática de súmula pega a lista, sem termo", () => {
    const coletor = ler("server/jurisia/coletor-ementas.ts");
    expect(coletor).toContain('fonte.material === "sumula"\n      ? await colherListaDeSumulas(fonte)');
    const bloco = coletor.slice(
      coletor.indexOf("async function colherListaDeSumulas"),
      coletor.indexOf("O caminho manual"),
    );
    expect(bloco).toContain('enderecoDaFonte(fonte, "")');
    // Porta que abriu e não tinha texto é diferente de porta que não abriu —
    // sem isso a gente trocaria o endereço de uma fonte viva.
    expect(bloco).toMatch(/não trazia o texto dos enunciados/);
  });

  it("a tela tem o botão de colar, e o diálogo cabe na tela", () => {
    const tela = ler("client/src/pages/admin/ConhecimentoJuridicoTab.tsx");
    expect(tela).toContain("Colar texto oficial");
    expect(tela).toContain("jurisiaImportarSumulas");
    expect(tela).toContain('className="max-h-[90vh] max-w-2xl overflow-y-auto"');
  });
});

describe("a tela diz o que aconteceu em português", () => {
  it("403 que persiste vira frase, não 'é o IP'", () => {
    const r = recadoDaSonda(sonda({ veredito: "bloqueado", status: 403, retryNavegador: "persistiu" }));
    expect(r.tom).toBe("fechado");
    expect(r.frase).toMatch(/barrou o nosso servidor/i);
    expect(r.frase).not.toMatch(/\bIP\b|403/);
    expect(r.acao).toMatch(/outra porta/i);
  });

  it("403 que passa com identificação de navegador é conserto nosso", () => {
    const r = recadoDaSonda(sonda({ veredito: "bloqueado", status: 403, retryNavegador: "passou" }));
    expect(r.tom).toBe("conserto");
    expect(r.acao).toMatch(/nosso lado/i);
  });

  it("endereço errado (404 e domínio que não resolve) é conserto nosso, não porta fechada", () => {
    expect(recadoDaSonda(sonda({ veredito: "bloqueado", status: 404 })).tom).toBe("conserto");
    expect(recadoDaSonda(sonda({ veredito: "erro", status: null, causa: "dns" })).tom).toBe("conserto");
  });

  it("certificado é conserto nosso — é o que separa 'o tribunal fechou' de 'a gente não sabe entrar'", () => {
    const r = recadoDaSonda(sonda({ veredito: "erro", status: null, causa: "tls" }));
    expect(r.tom).toBe("conserto");
    expect(r.frase).toMatch(/certificado de segurança/i);
    expect(r.frase).not.toMatch(/\btls\b/i);
  });

  it("responder sem texto de decisão não é 'serve'", () => {
    const r = recadoDaSonda(sonda({ temEmenta: false }));
    expect(r.tom).toBe("quase");
    expect(r.frase).toMatch(/não vem o texto da decisão/i);
  });

  it("súmula contada no corpo vence a heurística da palavra 'ementa'", () => {
    // Página de súmula não usa a palavra "ementa": sem a contagem, a fonte do
    // material mais forte que existe apareceria como "não traz nada".
    const r = recadoDaSonda(sonda({ temEmenta: false, sumulasNoCorpo: 42 }));
    expect(r.tom).toBe("funciona");
    expect(r.frase).toMatch(/42 enunciados de súmula/);
  });

  it("o resumo só fala dos grupos que existem", () => {
    const frases = resumoDaSondagem([
      sonda({ sumulasNoCorpo: 3 }),
      sonda({ veredito: "bloqueado", status: 403, retryNavegador: "persistiu" }),
    ]);
    expect(frases.join(" ")).toMatch(/1 fonte já traz/);
    expect(frases.join(" ")).toMatch(/1 barrou o nosso servidor/);
    expect(frases.join(" ")).not.toMatch(/\b0\b/);

    // Com um grupo só, sai UMA frase: "0 fontes fechadas" é ruído que empurra
    // o que importa para baixo, e é o tipo de linha que volta sozinha.
    expect(resumoDaSondagem([sonda({ sumulasNoCorpo: 3 })])).toHaveLength(1);
  });

  it("o que serve aparece antes do que não tem jeito", () => {
    expect(ORDEM_DO_TOM.funciona).toBeLessThan(ORDEM_DO_TOM.conserto);
    expect(ORDEM_DO_TOM.conserto).toBeLessThan(ORDEM_DO_TOM.quase);
    expect(ORDEM_DO_TOM.quase).toBeLessThan(ORDEM_DO_TOM.fechado);
  });

  it("a tela da sondagem usa a tradução e ORDENA por ela", () => {
    const tela = ler("client/src/pages/admin/AdminJurisIa.tsx");
    expect(tela).toContain('from "@shared/sondagem-em-portugues"');
    expect(tela).toContain("recadoDaSonda(r)");
    expect(tela).toContain(
      "sort((a, b) => ORDEM_DO_TOM[recadoDaSonda(a.r).tom] - ORDEM_DO_TOM[recadoDaSonda(b.r).tom])",
    );
    // O resumo tem que estar NA LISTA da tela, não só no toast que aparece e
    // desaparece — ancorado no `<ul>` porque o literal existe nos dois lugares.
    const lista = tela.slice(tela.indexOf('<ul className="space-y-1'), tela.indexOf("</ul>"));
    expect(lista).toContain("resumoDaSondagem(s.resultados).map((frase) => (");
    // O número técnico não foi removido da tela — desceu pra coluna do lado.
    expect(tela).toContain("Detalhe técnico");
    expect(tela).toContain("{r.status ?? \"—\"} · {r.ms}ms · {v.rotulo}");
  });
});

describe("o que a sondagem mediu está gravado na lista de fontes", () => {
  it("toda fonte declara situação", () => {
    for (const f of FONTES_OFICIAIS) {
      expect(f.situacao, `${f.id} sem situação`).toBeTruthy();
      expect(rotuloSituacao(f.situacao).frase).toBeTruthy();
    }
  });

  it("o STJ está marcado como quem barra o nosso servidor", () => {
    expect(fonteOficialPorId("stj-scon")!.situacao).toBe("recusa_nosso_servidor");
    expect(fonteOficialPorId("stj-sumulas")!.situacao).toBe("recusa_nosso_servidor");
    expect(ligarTemChance(fonteOficialPorId("stj-scon")!)).toBe(false);
  });

  it("as três portas que responderam estão declaradas e marcadas como abertas", () => {
    for (const id of ["tjsp-cjsg", "tjmg-jurisprudencia", "trf4-jurisprudencia"]) {
      const f = fonteOficialPorId(id);
      expect(f, `${id} não declarada`).toBeTruthy();
      expect(f!.situacao, id).toBe("porta_aberta");
      expect(ligarTemChance(f!), id).toBe(true);
    }
  });

  it("o TJCE está marcado como endereço a corrigir, e não como fonte que funciona", () => {
    // O e-SAJ é de São Paulo; o endereço do TJCE foi deduzido e não existe.
    // Deixar isso como "funciona" é o que faria alguém ligar e culpar o robô.
    const f = fonteOficialPorId("tjce-jurisprudencia")!;
    expect(f.situacao).toBe("endereco_a_corrigir");
    expect(ligarTemChance(f)).toBe(false);
  });

  it("a tela mostra a situação e o aviso de quem é o conserto", () => {
    const tela = ler("client/src/pages/admin/ConhecimentoJuridicoTab.tsx");
    expect(tela).toContain("Dá pra ler daqui?");
    expect(tela).toContain("rotuloSituacao(f.situacao).frase");
    // A guarda, não a interpolação: `{f.notaDaSondagem}` continua escrito
    // dentro do bloco mesmo quando a condição é desarmada.
    expect(tela).toContain("{f.notaDaSondagem && (");
    // A chave continua clicável de propósito: medida velha não decide pra
    // sempre, e tribunal desbloqueia.
    expect(tela).toContain("onCheckedChange={(v) => ligar.mutate({ fonteId: f.id, ligada: v })}");
  });
});

describe("a sondagem bate na porta que o robô vai usar", () => {
  it("os candidatos saem da MESMA lista que o coletor lê", () => {
    const sondagem = ler("server/jurisia/sondar-fontes.ts");
    expect(sondagem).toContain('from "@shared/fontes-oficiais"');
    expect(sondagem).toContain("for (const f of fontesQueTrazemEmenta())");
    expect(sondagem).toContain("const url = enderecoDaFonte(f, termo);");
    // Sem o corte de duplicata a lista bate duas vezes no mesmo endereço.
    expect(sondagem).toContain("lista.some((c) => c.url === url)");
  });

  it("a sondagem conta súmula rodando o extrator de verdade", () => {
    const sondagem = ler("server/jurisia/sondar-fontes.ts");
    expect(sondagem).toContain('colherSumulas(texto, "").sumulas.length');
    expect(sondagem).toContain("sumulasNoCorpo");
  });

  it("outros hosts do STJ entraram na medição", () => {
    // "O tribunal barra" e "aquele servidor barra" levam a decisões diferentes.
    const sondagem = ler("server/jurisia/sondar-fontes.ts");
    expect(sondagem).toContain("https://dadosabertos.stj.jus.br/");
    expect(sondagem).toContain("https://processo.stj.jus.br/processo/pesquisa/");
  });
});

describe("súmula e ementa contam separado na resposta", () => {
  const lista = [
    { identificador: "Súmula 297/STJ", orgao: "Súmula", data: "", ementa: "x", url: "u" },
    { identificador: "Súmula Vinculante 11/STF", orgao: "Súmula vinculante", data: "", ementa: "x", url: "u" },
    { identificador: "Apelação 1234567-89.2020.8.26.0100", orgao: "5ª Câmara", data: "", ementa: "x", url: "u" },
  ];

  it("conta pelo identificador, que é quem sabe o que a coisa é", () => {
    expect(contarCitacoes(lista)).toEqual({ sumulas: 2, ementas: 1 });
    expect(rotuloCitacoes(lista)).toBe("2 súmulas e 1 ementa");
  });

  it("lista de um tipo só não inventa o outro", () => {
    expect(rotuloCitacoes([lista[0]])).toBe("1 súmula");
    expect(rotuloCitacoes([lista[2]])).toBe("1 ementa");
    expect(rotuloCitacoes(undefined)).toBe("");
  });
});
