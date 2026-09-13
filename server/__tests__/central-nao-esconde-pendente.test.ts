/**
 * A Central de Movimentações não pode esconder trabalho atrás do teto da
 * página — nem afirmar que a página é o período inteiro.
 *
 * Origem (13/09, print do dono): a tela dizia "Nada pendente nos últimos 30
 * dias · As 80 movimentações do período já foram resolvidas" com o badge da
 * aba marcando **11**. Os dois números saíam de lugares diferentes:
 *
 *   - o badge (`contador`) conta o BANCO: não lidas dos últimos 30 dias, sem teto;
 *   - a tela contava a PÁGINA, cortada em `limite` (80) e ordenada só por data.
 *
 * O escritório tinha 91 no período e as 11 pendentes eram mais ANTIGAS que as
 * 80 que couberam: caíam fora da consulta, não apareciam em lugar nenhum da
 * tela e ainda faziam a contagem concluir "tudo resolvido". Reproduzido no app
 * rodando com esse mesmo cenário antes de consertar.
 *
 * Duas garantias, e as duas precisam valer juntas:
 *   1. ORDEM — não lida primeiro. É o que impede o teto de comer pendência.
 *   2. JANELA — os números do período vêm de uma contagem no banco, à parte da
 *      página, pra tela poder dizer quando está mostrando só uma parte.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { triar } from "../processos/router-movimentacoes";

const raiz = path.resolve(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");
const router = ler("server/processos/router-movimentacoes.ts");
const tela = ler("client/src/pages/Movimentacoes.tsx");

/** Trecho entre âncoras — a final exclusiva, pra não pegar a função vizinha. */
function recorte(fonte: string, de: string, ate: string): string {
  const i = fonte.indexOf(de);
  expect(i, `âncora não encontrada: ${de}`).toBeGreaterThan(-1);
  const j = fonte.indexOf(ate, i + de.length);
  expect(j, `âncora final não encontrada: ${ate}`).toBeGreaterThan(-1);
  return fonte.slice(i, j);
}

describe("a consulta põe pendente na frente do teto", () => {
  const central = recorte(router, "central: protectedProcedure", "detalhe: protectedProcedure");

  it("ordena por lido ANTES da data", () => {
    // Só `desc(dataEvento)` é o bug: com mais movimentações do que cabem, as
    // pendentes antigas somem da consulta.
    expect(central).toContain(
      "orderBy(asc(eventosProcesso.lido), desc(eventosProcesso.dataEvento))",
    );
  });

  it("a ordenação vem antes do corte, não depois", () => {
    const ordem = central.indexOf("orderBy(asc(eventosProcesso.lido)");
    const corte = central.indexOf(".limit(limite)");
    expect(corte, "o teto sumiu — sem ele nada disso importa").toBeGreaterThan(-1);
    expect(ordem).toBeLessThan(corte);
  });

  it("o teto continua existindo e continua sendo 80 por padrão", () => {
    // A amarra não é "tirar o limite": é não deixar ele esconder pendência.
    expect(central).toContain("limite: z.number().int().min(1).max(200).default(80)");
  });
});

describe("os números do período são contados no banco", () => {
  const central = recorte(router, "central: protectedProcedure", "detalhe: protectedProcedure");

  it("existe uma contagem à parte, sem teto, separada por estado", () => {
    const consulta = recorte(central, "const [totalJanela]", "const hoje");
    expect(consulta, "a contagem precisa somar por lido").toContain("CASE WHEN");
    expect(consulta, "contagem com teto contaria a página de novo").not.toContain("limit(");
    // Os dois números têm que SAIR dessa consulta. Conferir só que o nome
    // existe deixa passar o mutante que reatribui a variável à página —
    // sobreviveu assim na 1ª volta desta amarra.
    expect(consulta).toContain("const aResolverPeriodo = Number(totalJanela?.aResolver ?? 0);");
    expect(consulta).toContain("const resolvidasPeriodo = Number(totalJanela?.resolvidas ?? 0);");
    expect(consulta, "contar `rows` é contar a página").not.toContain("rows");
  });

  it("a contagem do período é entregue à triagem", () => {
    const chamada = recorte(central, "return triar(", "}),");
    expect(chamada).toContain("aResolver: aResolverPeriodo");
    expect(chamada).toContain("resolvidas: resolvidasPeriodo");
  });
});

describe("triar separa o que é da página do que é do período", () => {
  const universo = [
    { id: 1, grupo: "relevante" as const, lido: false },
    { id: 2, grupo: "relevante" as const, lido: true },
  ];

  it("o caso do print: página só com resolvidas, período com 11 pendentes", () => {
    const r = triar([universo[1]], { estado: "a_resolver" }, { aResolver: 11, resolvidas: 80 });
    // `contagem` fala da página — e é por isso que ela NÃO pode alimentar o
    // texto "as N do período já foram resolvidas".
    expect(r.contagem.resolvidas).toBe(1);
    // `janela` fala do banco: é o que faz a tela parar de mentir.
    expect(r.janela).toEqual({ aResolver: 11, resolvidas: 80, noPeriodo: 91 });
  });

  it("sem a contagem do banco, a janela descreve a própria página", () => {
    // Caller antigo não pode receber zero: a tela leria "nada no período".
    expect(triar(universo, { estado: "todas" }).janela).toEqual({
      aResolver: 1,
      resolvidas: 1,
      noPeriodo: 2,
    });
  });
});

describe("a tela usa o número do período, não o da página", () => {
  it("o texto 'já foram resolvidas' conta o período", () => {
    expect(tela).toContain("total={totalParaTextoVazio}");
    // Ancorado NA atribuição: `jan?.noPeriodo` aparece em outro lugar do
    // arquivo, e olhar o arquivo inteiro deixava passar o mutante que voltava
    // a alimentar o texto com `data.total` — a página.
    const calc = recorte(tela, "const totalParaTextoVazio", ";");
    expect(calc, "era `data.total` (a página) que escrevia 'as 80 do período'")
      .toContain("jan?.noPeriodo");
  });

  it("'nada no período' se decide pelo banco", () => {
    const decisao = recorte(tela, "const vazio: MotivoVazio", "const contagemJanela");
    expect(decisao, "com o teto batendo, `total` nunca é 0 e o motivo se perdia")
      .toContain("data?.janela.noPeriodo");
  });

  it("o rótulo de Resolvidas conta o período quando não há filtro de tipo", () => {
    expect(tela).toContain("const resolvidasRotulo");
    expect(tela).toContain("` (${resolvidasRotulo})`");
    const calc = recorte(tela, "const resolvidasRotulo", "const totalParaTextoVazio");
    expect(calc, "sem o número do período volta o '(80)' que era o tamanho da página")
      .toContain("jan?.resolvidas");
    expect(calc, "com filtro de tipo ligado ele volta a descrever a tela")
      .toContain("contagem.resolvidas");
  });

  it("o aviso de página cortada existe e só aparece quando falta algo", () => {
    const calc = recorte(tela, "const faltamNaLista", "// O número da aba Resolvidas");
    expect(calc, "sem o max, número negativo viraria aviso").toContain("Math.max(0,");
    expect(calc, "com busca ou filtro de tipo a comparação não vale").toContain(
      'tipo !== "todos"',
    );
    expect(tela).toContain("{faltamNaLista > 0 && (");
    expect(tela).toContain("Mostrando {itens.length} de {noEstadoAtual}");
  });
});

describe("o badge do menu continua sendo a régua", () => {
  it("o contador segue contando o banco inteiro da janela, sem teto", () => {
    const contador = ler("server/processos/contador-movimentacoes.ts");
    expect(contador).toContain("eq(eventosProcesso.lido, false)");
    expect(contador, "teto aqui faria os dois números voltarem a discordar")
      .not.toContain(".limit(");
  });
});
