/**
 * O PJe monta o detalhe NO LUGAR, e isso não é falha.
 *
 * Em 11/09/2026 o adapter ganhou uma guarda contra ler a TABELA DE RESULTADOS:
 * quando a página do processo não abre, "Classe judicial" e "Polo ativo" estão
 * na tela como TÍTULOS DE COLUNA, e o scraper devolvia o título vizinho como se
 * fosse o valor do campo — foi assim que "Polo ativo" virou a natureza da ação
 * num card, e como o poll regravava `hashUltimasMovs` com o hash de ZERO
 * movimentações, soltando uma avalanche de "novas" no ciclo seguinte.
 *
 * A guarda estava certa no diagnóstico e errada no mecanismo. Ela decidia por
 * SNIFFING de página: "ainda tem a grade no DOM e nenhum marcador de detalhe
 * que eu conheça → desisto". Só que o PJe também renderiza o detalhe na MESMA
 * aba, por AJAX: não abre aba, a URL continua `listView.seam` e a grade fica no
 * DOM. Se o painel usa um id fora da lista de marcadores, a guarda recusava uma
 * página que TINHA o processo aberto — e o dono viu monitoramento que funcionava
 * passar a devolver "O processo apareceu na busca, mas a página dele não abriu".
 *
 * A regra que fica: quem decide é o RESULTADO da extração, não o palpite sobre
 * a página. Valor que é rótulo de coluna já não conta como campo preenchido (a
 * recusa de rótulo continua de pé), então capa vazia + zero movimentação é o
 * sinal honesto de falha — e aí, sim, o erro sai com a foto e a grade em mãos.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const adapter = readFileSync(
  join(raiz, "scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts"),
  "utf8",
);

/** O corpo de `consultarPorCnj`, onde a decisão acontece. */
function corpoConsultarPorCnj(): string {
  const i = adapter.indexOf("async consultarPorCnj(");
  expect(i).toBeGreaterThan(-1);
  const j = adapter.indexOf("\n  private async", i);
  return adapter.slice(i, j > i ? j : undefined);
}

describe("não desistir antes de tentar extrair", () => {
  it("o clique que não confirmou a página só LEVANTA A BANDEIRA — não retorna", () => {
    const corpo = corpoConsultarPorCnj();
    const bloco = corpo.slice(corpo.indexOf("if (!abriuDetalhe) {"));
    const fim = bloco.indexOf("\n        }");
    const dentro = bloco.slice(0, fim > 0 ? fim : 400);
    expect(dentro).toContain("detalheNaoAbriu = true;");
    // É exatamente o `return` que estava aqui que quebrou o monitoramento.
    expect(dentro).not.toContain("return {");
  });

  it("a falha por 'não abriu' só é reportada DEPOIS da extração vir vazia", () => {
    const corpo = corpoConsultarPorCnj();
    const bandeira = corpo.indexOf("detalheNaoAbriu = true;");
    const extraiu = corpo.indexOf("const conseguiuExtrair =");
    const reporta = corpo.indexOf('categoriaErro: "detalhe_nao_abriu"');
    expect(bandeira).toBeGreaterThan(-1);
    expect(extraiu).toBeGreaterThan(bandeira);
    expect(reporta).toBeGreaterThan(extraiu);
    // E dentro do ramo de extração vazia, não solto no meio do fluxo.
    const vazio = corpo.indexOf("if (!conseguiuExtrair) {");
    expect(reporta).toBeGreaterThan(vazio);
  });

  it("a categoria distingue as duas causas: clique sem destino × seletor que não casou", () => {
    const corpo = corpoConsultarPorCnj();
    expect(corpo).toMatch(/if \(detalheNaoAbriu\) \{[\s\S]{0,400}?categoriaErro: "detalhe_nao_abriu"/);
    expect(corpo).toContain('categoriaErro: "parse_falhou"');
  });

  it("a grade da busca continua voltando no erro — é dela que o cron monta a capa", () => {
    const corpo = corpoConsultarPorCnj();
    const bloco = corpo.slice(corpo.indexOf("if (detalheNaoAbriu) {"));
    expect(bloco.slice(0, 900)).toContain("linhasDaBusca,");
  });

  it("a foto tirada na hora do clique é a que vai no erro, não uma tirada depois", () => {
    const corpo = corpoConsultarPorCnj();
    expect(corpo).toContain("screenshotDetalheNaoAbriu = await this.tirarScreenshotErro(");
    expect(corpo).toContain("screenshotPath: screenshotDetalheNaoAbriu ?? screenshotPath,");
  });
});

describe("a conferência que decide olha o conteúdo", () => {
  it("órgão julgador conta como conteúdo junto com classe, partes e movimentações", () => {
    // Detalhe que trouxe só a vara é página do processo do mesmo jeito. Sem
    // isso, uma capa parcial legítima voltava como falha.
    expect(adapter).toMatch(
      /const conseguiuExtrair =\s*\n?\s*capa\.classe \|\| capa\.orgaoJulgador \|\| capa\.partes\.length > 0 \|\| movimentacoes\.length > 0;/,
    );
  });

  it("a recusa de rótulo continua de pé — é ELA que impede ler a tabela de resultados", () => {
    // Se esta proteção sair, "Polo ativo" volta a virar natureza da ação, agora
    // sem o sniffing de página pra segurar.
    expect(adapter).toContain("ehRotulo");
    expect(adapter.toLowerCase()).toContain("polo ativo");
  });
});

describe("esperar o detalhe sem torrar o tempo do cron", () => {
  it("os marcadores do detalhe têm UMA fonte, usada pela espera e pela conferência", () => {
    expect(adapter).toContain("const SELETOR_DETALHE_PROCESSO =");
    // Duas listas divergindo faria a espera desistir de uma página que a
    // conferência aceitaria.
    expect(adapter.match(/SELETOR_DETALHE_PROCESSO/g)?.length).toBe(4);
    expect(adapter).toContain("#panelDetalhesProcesso, #divTimeLine");
    // Contar o nome não basta: dá pra passar a constante pro `evaluate` e ainda
    // procurar um seletor cravado dentro dele. O que importa é que a conferência
    // USE o parâmetro que recebeu — a mutação passou por cima da contagem.
    expect(adapter).toContain("const temDetalhe = !!document.querySelector(seletorDetalhe);");
    // E a única lista literal de marcadores é a da constante: a busca por
    // "#divTimeLine" fora dela é o sinal de cópia.
    const forasDaConstante = adapter
      .split("const SELETOR_DETALHE_PROCESSO =")[1]
      .split("\n")
      .slice(2)
      .join("\n");
    expect(forasDaConstante).not.toContain('querySelector("#divTimeLine"');
  });

  it("o clique espera aba nova OU detalhe na mesma aba, o que vier primeiro", () => {
    const corpo = corpoConsultarPorCnj();
    expect(corpo).toContain("const marcadorNaMesmaAba = pageBusca");
    expect(corpo).toMatch(/primeiroSinal<Page \| typeof MESMA_ABA>\(\s*\n\s*\[newPagePromise\.catch\(\(\) => null\), marcadorNaMesmaAba\],/);
    expect(corpo).toContain("const newPage = sinal === MESMA_ABA ? null : sinal;");
  });

  it("a corrida ignora quem falha: `Promise.race` cru deixaria o null ganhar", () => {
    const helper = adapter.slice(
      adapter.indexOf("async function primeiroSinal"),
      adapter.indexOf("export const TJCE_1G"),
    );
    // O truque é este: espera que resolveu null nunca resolve de novo, então
    // quem ganha é sempre um sinal positivo ou o teto de tempo.
    expect(helper).toContain("p.then((v) => (v == null ? new Promise<T>(() => {}) : v))");
    expect(helper).toContain("setTimeout(() => resolve(null), msTeto)");
    // Timer pendurado não pode segurar o processo do cron depois da consulta.
    expect(helper).toContain("unref?.()");
  });
});
