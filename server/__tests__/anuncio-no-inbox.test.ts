/**
 * Origem por anúncio dentro do Inbox: selo, filtro e contador.
 *
 * O que estes testes travam, e por quê:
 *
 *  1. O chip "Anúncio N" e a lista que ele abre contam o MESMO conjunto.
 *     Este repositório já viveu a divergência três vezes (canalId, busca e
 *     pasta Arquivadas ficaram de fora do contador e os pills passaram a
 *     descrever outra coisa). A diferença aqui é deliberada e tem regra
 *     própria: os pills de status SEGUEM o filtro de anúncio; o contador do
 *     próprio chip NÃO — senão, ligado, ele contaria a si mesmo e o "7 de
 *     2420" viraria "7 de 7".
 *
 *  2. A lista não carrega o identificador do clique. `ctwaClid` e `sourceId`
 *     são chaves de atribuição, resolvidas no servidor; a lista busca até mil
 *     conversas e não tem o que fazer com eles.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { origemAnuncioParaLista, parseOrigemAnuncio } from "../integracoes/whatsapp-origem-anuncio";

const raiz = join(__dirname, "..", "..");
const dbCrm = readFileSync(join(raiz, "server", "escritorio", "db-crm.ts"), "utf8");
const routerCrm = readFileSync(join(raiz, "server", "escritorio", "router-crm.ts"), "utf8");
const atendimento = readFileSync(join(raiz, "client", "src", "pages", "Atendimento.tsx"), "utf8");

const REFERRAL_COMPLETO = JSON.stringify({
  sourceId: "120210000000000000",
  sourceType: "ad",
  sourceUrl: "https://fb.me/abc",
  titulo: "Foi demitido sem justa causa?",
  corpo: "Verba rescisória, FGTS, aviso prévio.",
  midiaTipo: "video",
  imagemUrl: "",
  videoUrl: "https://scontent.example/v.mp4",
  thumbnailUrl: "https://scontent.example/t.jpg",
  ctwaClid: "ARAbc123",
});

describe("recorte da origem que vai pra lista", () => {
  it("leva o que o cartão desenha", () => {
    const o = origemAnuncioParaLista(REFERRAL_COMPLETO);
    expect(o).toMatchObject({
      titulo: "Foi demitido sem justa causa?",
      corpo: "Verba rescisória, FGTS, aviso prévio.",
      midiaTipo: "video",
      sourceUrl: "https://fb.me/abc",
      thumbnailUrl: "https://scontent.example/t.jpg",
    });
  });

  it("NÃO leva o identificador do clique nem o id do anúncio", () => {
    const o = origemAnuncioParaLista(REFERRAL_COMPLETO) as Record<string, unknown>;
    expect(o).not.toHaveProperty("ctwaClid");
    expect(o).not.toHaveProperty("sourceId");
    // …mas eles continuam gravados no contato, pro relatório de atribuição.
    expect(parseOrigemAnuncio(REFERRAL_COMPLETO)?.ctwaClid).toBe("ARAbc123");
  });

  it("contato sem anúncio não vira objeto vazio", () => {
    expect(origemAnuncioParaLista(null)).toBeNull();
    expect(origemAnuncioParaLista("")).toBeNull();
    expect(origemAnuncioParaLista("não é json")).toBeNull();
  });

  it("campo que a Meta não mandou vira string vazia, não `undefined`", () => {
    const o = origemAnuncioParaLista(JSON.stringify({ titulo: "Só o título" }));
    expect(o).toMatchObject({ titulo: "Só o título", corpo: "", thumbnailUrl: "", sourceUrl: "" });
  });
});

describe("filtro e contador contam o mesmo conjunto", () => {
  it("o filtro da lista é a origem no CONTATO", () => {
    // Ancorado no bloco do filtro: o MESMO literal aparece no contador do
    // chip logo abaixo, e uma asserção solta sobre o arquivo passava mesmo
    // com a condição do filtro invertida.
    const i = dbCrm.indexOf("if (filtros?.somenteAnuncio) {");
    expect(i).toBeGreaterThan(0);
    const bloco = dbCrm.slice(i, i + 200);
    expect(bloco).toContain("isNotNull(contatos.origemAnuncio)");
  });

  it("o contador do chip usa as condições da vista MAIS a origem", () => {
    const trecho = dbCrm.slice(dbCrm.indexOf("out.anuncio") - 900, dbCrm.indexOf("out.anuncio"));
    expect(trecho).toContain("isNotNull(contatos.origemAnuncio)");
    expect(trecho).toContain("baseSemAnuncio");
  });

  it("o contador do chip ignora o próprio filtro (senão conta a si mesmo)", () => {
    expect(dbCrm).toMatch(/somenteAnuncio\s*\?[\s\S]{0,200}?somenteAnuncio:\s*false/);
  });

  it("os pills de status, ao contrário, SEGUEM o filtro — o zod tem que aceitar", () => {
    // Sem o campo no input, o zod o descarta em silêncio e os pills voltam a
    // descrever o escritório inteiro enquanto a lista mostra sete conversas.
    const contar = routerCrm.slice(
      routerCrm.indexOf("contarConversas: protectedProcedure"),
      routerCrm.indexOf("contarConversasPorStatus(perm.escritorioId"),
    );
    expect(contar).toContain("somenteAnuncio");
  });

  it("listarConversas aceita o filtro", () => {
    const listar = routerCrm.slice(
      routerCrm.indexOf("listarConversas: protectedProcedure"),
      routerCrm.indexOf("contarConversas: protectedProcedure"),
    );
    expect(listar).toContain("somenteAnuncio");
  });

  it("a resposta vazia por falta de permissão tem o mesmo formato da cheia", () => {
    // Formato divergente aqui deixa o chip mostrando `undefined` pra quem não
    // tem permissão de ver atendimento, em vez de zero.
    expect(routerCrm).toMatch(/fechado:\s*0,\s*anuncio:\s*0\s*\}/);
  });
});

describe("tela do Inbox", () => {
  it("o selo ANÚNCIO sai da origem da conversa", () => {
    const selo = atendimento.slice(
      atendimento.indexOf('data-testid="selo-anuncio"') - 200,
      atendimento.indexOf('data-testid="selo-anuncio"') + 900,
    );
    expect(selo).toContain("origemAnuncio");
    expect(selo).toContain("ANÚNCIO");
  });

  it("o chip some quando o escritório não tem lead de anúncio", () => {
    // Escritório que não anuncia não ganha controle morto no topo da caixa —
    // mas o chip LIGADO continua visível, ou não haveria como desligá-lo
    // quando o filtro zera a própria contagem.
    expect(atendimento).toMatch(/counts\.anuncio > 0 \|\| somenteAnuncio/);
  });

  it("o cartão da conversa mostra título, texto e link do anúncio", () => {
    const i = atendimento.indexOf('data-testid="cartao-origem-anuncio"');
    expect(i).toBeGreaterThan(0);
    const cartao = atendimento.slice(i, i + 2200);
    expect(cartao).toContain("Chegou por um anúncio");
    expect(cartao).toContain("ad.titulo");
    expect(cartao).toContain("ad.corpo");
    expect(cartao).toContain("ad.sourceUrl");
  });

  it("o filtro do chip chega ao backend", () => {
    expect(atendimento).toMatch(/somenteAnuncio\)\s*f\.somenteAnuncio = true/);
  });

  it("a cor do bloco sai do tema, não da paleta crua", () => {
    const i = atendimento.indexOf('data-testid="cartao-origem-anuncio"');
    const cartao = atendimento.slice(i, i + 2200);
    expect(cartao).not.toMatch(/(bg|text|border)-(violet|purple|indigo)-[0-9]/);
    expect(cartao).toContain("accent-purple");
  });
});
