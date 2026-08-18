/**
 * A capa que o robô já lia e jogava fora.
 *
 * Pra decidir se avisa ou cala, o cron de novas ações abre a capa de cada CNJ
 * novo — classe, assunto, partes com polo, vara, valor, distribuição. Usava
 * duas coisas (o polo, pra saber se o cliente é autor; a data, pra saber se é
 * processo velho) e descartava o resto. O card ficava com o número do processo
 * e nada mais, e a tela ainda oferecia "Carregar detalhes — 1 crédito" pra
 * buscar de novo exatamente o que já tinha passado pelas mãos do robô.
 *
 * O segundo defeito é o que fez o dono abrir o chamado: em três lugares o polo
 * era lido com um `else` que significava ATIVO. Parte sem polo reconhecido,
 * capa vazia, tabela do PJe fora do formato — tudo virava "o cliente é o
 * autor", que é o rótulo com o qual o cron SILENCIA o alerta. A falha de
 * leitura escolhia o lado que esconde o caso.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { lerPolo, paraLadoJudit, POLO_LABEL } from "../../shared/polo-parte";
import { lerCapaNovaAcao, lerFalhaDeCapa, montarCapaNovaAcao, LIMITE_PARTES } from "../../shared/nova-acao-capa";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const cron = ler("server/processos/cron-monitoramento.ts");
const router = ler("server/routers/processos.ts");
const runner = ler("server/processos/motor-proprio-runner.ts");
const scraper = ler("scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts");
const tela = ler("client/src/pages/Processos.tsx");

describe("polo: existe um valor pra “não sei”", () => {
  it("o que não for reconhecido vira desconhecido, nunca um dos lados", () => {
    for (const bruto of ["", "   ", "sei lá", null, undefined, 0, {}, []]) {
      expect(lerPolo(bruto), String(bruto)).toBe("desconhecido");
    }
  });

  it("as grafias reais do tribunal continuam sendo lidas", () => {
    expect(lerPolo("ativo")).toBe("ativo");
    expect(lerPolo("ATIVA")).toBe("ativo");
    expect(lerPolo(" Passivo ")).toBe("passivo");
    expect(lerPolo("passiva")).toBe("passivo");
    expect(lerPolo("terceiro")).toBe("terceiro");
    expect(lerPolo("outros interessados")).toBe("terceiro");
  });

  it("terceiro não é chamado de réu no shape legado", () => {
    // "Passive" colocaria o terceiro interessado na coluna dos adversários —
    // o card passaria a afirmar que ele está sendo processado.
    expect(paraLadoJudit("terceiro")).toBe("Unknown");
    expect(paraLadoJudit("qualquer coisa")).toBe("Unknown");
    expect(paraLadoJudit("ativo")).toBe("Active");
    expect(paraLadoJudit("passivo")).toBe("Passive");
  });

  it("desconhecido tem rótulo próprio na tela", () => {
    expect(POLO_LABEL.desconhecido).toBe("Não identificado");
  });

  it("o matcher afirma “ativo”, não chega nele por eliminação", () => {
    // "ativo" é o único valor que faz o cron silenciar o alerta. Cair nele
    // por `return` final esconderia um caso por falta de informação.
    const matcher = ler("server/processos/polo-matcher.ts");
    expect(matcher).toContain('if (polosEncontrados.has("ativo")) return "ativo";');
    expect(matcher).toContain('return "desconhecido";');
  });

  it("nenhum lugar decide polo com um else", () => {
    // As três cópias que existiam. Duas defaultavam pra ativo (silencia o
    // alerta) e a terceira pra passivo — nem entre si concordavam.
    for (const [nome, arquivo] of [["router", router], ["runner", runner]] as const) {
      expect(arquivo, nome).not.toContain('p.polo === "passivo" ? "Passive" : "Active"');
      expect(arquivo, nome).not.toContain('.startsWith("ativ") ? "Active" : "Passive"');
      expect(arquivo, nome).toContain("paraLadoJudit(p.polo)");
    }
  });
});

describe("a capa é guardada na detecção", () => {
  const capaBruta = {
    classe: "Procedimento do Juizado Especial Cível",
    assuntos: ["Indenização por Dano Moral", "Inscrição Indevida"],
    orgaoJulgador: "3ª Vara do Juizado Especial Cível de Fortaleza",
    valorCausaCentavos: 1840000,
    dataDistribuicao: "2026-08-12T00:00:00.000Z",
    partes: [
      { nome: "Aurora Telecom Nordeste S.A.", polo: "ativo", documento: "21884309000146" },
      { nome: "Marcos Aurélio Ribeiro Lima", polo: "passivo", documento: "04851237715" },
    ],
  };

  it("o cron escreve a capa junto do evento", () => {
    expect(cron).toContain("montarCapaNovaAcao(");
    expect(cron).toContain("capa: capaColetada,");
  });

  it("distingue “não tentou” de “tentou e não veio”", () => {
    // Card antigo não tem a chave e continua oferecendo carregar detalhes.
    // Scrape que falhou tem `capaFalhou: true` e ganha o aviso na tela.
    expect(cron).toContain("capaFalhou: capaColetada === null");
    expect(lerFalhaDeCapa(JSON.stringify({ capaFalhou: true }))).toBe(true);
    expect(lerFalhaDeCapa(JSON.stringify({ cnj: "x" }))).toBe(false);
    expect(lerFalhaDeCapa(null)).toBe(false);
    expect(lerFalhaDeCapa("{quebrado")).toBe(false);
  });

  it("converte centavos pra reais uma vez só", () => {
    // A tela formata reais. Guardar centavos aqui renderia R$ 1.840.000,00.
    expect(montarCapaNovaAcao(capaBruta, "passivo", "2026-08-18T12:00:00Z").valorCausa).toBe(18400);
  });

  it("guarda as partes com o polo de cada uma", () => {
    const capa = montarCapaNovaAcao(capaBruta, "passivo", "2026-08-18T12:00:00Z");
    expect(capa.partes.map((p) => p.polo)).toEqual(["ativo", "passivo"]);
    expect(capa.poloDoCliente).toBe("passivo");
  });

  it("processo com dezenas de litisconsortes não incha a linha do evento", () => {
    const muitas = Array.from({ length: 40 }, (_, i) => ({ nome: `Parte ${i}`, polo: "ativo" }));
    const capa = montarCapaNovaAcao({ ...capaBruta, partes: muitas }, "ativo", "2026-08-18T12:00:00Z");
    expect(capa.partes).toHaveLength(LIMITE_PARTES);
  });

  it("a leitura sobrevive a JSON quebrado e a card antigo", () => {
    // Uma linha corrompida não pode derrubar a listagem inteira.
    expect(lerCapaNovaAcao("{quebrado")).toBeNull();
    expect(lerCapaNovaAcao(null)).toBeNull();
    expect(lerCapaNovaAcao(JSON.stringify({ cnj: "x", poloDoCliente: "ativo" }))).toBeNull();
  });

  it("capa vazia não vira bloco vazio na tela", () => {
    const vazia = JSON.stringify({ capa: { classe: null, orgaoJulgador: null, partes: [] } });
    expect(lerCapaNovaAcao(vazia)).toBeNull();
  });

  it("ida e volta preserva o que a tela mostra", () => {
    const capa = montarCapaNovaAcao(capaBruta, "passivo", "2026-08-18T12:00:00Z");
    const lida = lerCapaNovaAcao(JSON.stringify({ capa }));
    expect(lida?.classe).toBe(capaBruta.classe);
    expect(lida?.assuntos[0]).toBe("Indenização por Dano Moral");
    expect(lida?.orgaoJulgador).toBe(capaBruta.orgaoJulgador);
    expect(lida?.valorCausa).toBe(18400);
    expect(lida?.poloDoCliente).toBe("passivo");
    expect(lida?.partes).toHaveLength(2);
  });

  it("a listagem devolve a capa pro frontend", () => {
    const i = router.indexOf("listarNovasAcoes: protectedProcedure");
    const corpo = router.slice(i, i + 9000);
    expect(corpo).toContain("conteudoJson: eventosProcesso.conteudoJson");
    expect(corpo).toContain("capa: lerCapaNovaAcao(conteudoJson)");
    expect(corpo).toContain("capaFalhou: lerFalhaDeCapa(conteudoJson)");
  });
});

describe("o scraper não carimba passivo como ativo", () => {
  it("tabela que embrulha outra tabela de polo é ignorada", () => {
    // O container começa com "polo ativo" porque esse é o primeiro texto lá
    // dentro. Varrer os <tr> dele carimbava "ativo" em todo mundo — inclusive
    // em quem está no polo passivo, que é o caso que interessa alertar.
    expect(scraper).toContain("const aninhadaDePolo =");
    expect(scraper).toContain("if (aninhadaDePolo) continue;");
  });

  it("a mesma parte não entra duas vezes", () => {
    expect(scraper).toContain("const vistos = new Set<string>()");
    expect(scraper).toContain("if (vistos.has(chave)) continue;");
  });
});

describe("a tela", () => {
  it("mostra a natureza da ação, não só o número", () => {
    expect(tela).toContain("NATUREZA DA AÇÃO");
    expect(tela).toContain("const natureza = [capa?.classe, capa?.assuntos?.[0]]");
  });

  it("mostra os dois polos a partir da capa, sem exigir consulta paga", () => {
    expect(tela).toContain('(capa?.partes ?? []).filter((p) => p.polo === "ativo")');
    expect(tela).toContain('(capa?.partes ?? []).filter((p) => p.polo === "passivo")');
  });

  it("nenhum card da tela lê `side` na mão", () => {
    // São três componentes com a mesma lista de partes. Filtrar por `side`
    // faz o terceiro interessado cair num dos dois polos ou sumir, dependendo
    // de qual dos componentes você abriu.
    expect(tela).toContain("function poloDaParte(p: any)");
    expect(tela).not.toContain('p.side === "Active"');
    expect(tela).not.toContain('p.side === "Passive"');
  });

  it("parte que não é autor nem réu aparece, em vez de sumir", () => {
    expect(tela).toContain("OUTRAS PARTES");
  });

  it("diz de que lado está o cliente", () => {
    expect(tela).toContain("Seu cliente é RÉU");
    expect(tela).toContain("Seu cliente é AUTOR");
    expect(tela).toContain("Polo não identificado");
  });

  it("o selo só aparece quando alguém leu o processo", () => {
    // Sem capa não há o que afirmar. Um selo de polo sem dado por trás é o
    // mesmo defeito de antes, com outra cor.
    expect(tela).toContain("const selo = capa ? SELO_POLO[poloCliente] ?? SELO_POLO.desconhecido : null");
  });

  it("o card que falhou explica e oferece nova tentativa", () => {
    expect(tela).toContain("O tribunal não devolveu a capa deste processo");
    expect(tela).toContain('"Tentar de novo"');
  });

  it("card com capa não pede crédito de novo pelo que já tem", () => {
    expect(tela).toContain("Capa lida na detecção — sem crédito extra");
    expect(tela).toContain('"Ver movimentações"');
  });
});
