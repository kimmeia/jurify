/**
 * O robô de jornada saindo do terminal.
 *
 * Ele existia como spec de Playwright — e por isso rodava só com
 * `ROBO_JORNADA=1 pnpm test:e2e`. Quem opera o sistema não abre terminal,
 * então na prática nunca rodava, e o que ele achava morria no console de quem
 * executou. Botão no painel + histórico é o que separa "existe" de "está de
 * pé".
 *
 * Três decisões que estes testes protegem, porque cada uma tem um jeito óbvio
 * e errado de fazer:
 *
 *   · o clique NÃO espera o fim. São minutos; uma mutation segurando a
 *     conexão estouraria em qualquer proxy no caminho.
 *   · a linha do histórico nasce ANTES da execução terminar. Sem isso o
 *     painel fica mudo entre o clique e o resultado, que é como um botão
 *     quebrado se parece.
 *   · o teardown roda em `finally`, mesmo com a execução quebrada — é
 *     exatamente o caso em que ninguém está olhando.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  MARCA_ERROR_BOUNDARY,
  PAUSA_POS_RENDER_MS,
  ROTAS_JORNADA,
  TIMEOUT_EXECUCAO_MS,
} from "../admin/jornada/rotas";
import { ehRotaProibida } from "../admin/jornada/lista-negra";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const executor = ler("server/admin/jornada/executor.ts");
const historico = ler("server/admin/jornada/historico.ts");
const router = ler("server/admin/router-admin-jornada.ts");
const painel = ler("client/src/pages/admin/AdminRoboJornada.tsx");
const routers = ler("server/routers.ts");
const migration = ler("drizzle/0194_jornada_varreduras.sql");
const app = ler("client/src/App.tsx");
const nav = ler("client/src/components/AdminLayout.tsx");

describe("as rotas que ele percorre", () => {
  it("nenhuma está na lista negra", () => {
    const proibidas = ROTAS_JORNADA.filter((r) => ehRotaProibida(r));
    expect(proibidas, `rotas fora do alcance: ${proibidas.join(", ")}`).toEqual([]);
  });

  it("cobre o app inteiro, não uma amostra", () => {
    expect(ROTAS_JORNADA.length).toBeGreaterThan(15);
    for (const r of ["/dashboard", "/clientes", "/agenda", "/financeiro", "/ponto"]) {
      expect(ROTAS_JORNADA, r).toContain(r);
    }
  });

  it("o executor checa a lista negra mesmo com a lista sendo fixa", () => {
    // Rota proibida entrando por descuido não daria erro — daria acesso.
    expect(executor).toContain("if (ehRotaProibida(rota)) continue;");
  });
});

describe("o executor", () => {
  it("usa a biblioteca do Playwright, não o test runner", () => {
    // Rodar o runner dentro do processo do servidor traria relatório, workers e
    // ciclo de vida que não servem pra nada aqui.
    expect(executor).toContain("chromium.launch");
    expect(executor).toContain('import { chromium, type Browser, type Page } from "@playwright/test"');
    expect(executor).not.toMatch(/^\s*(test|describe)\(/m);
  });

  it("uma execução por vez", () => {
    // São minutos de navegador aberto no mesmo container que atende usuário;
    // duas ao mesmo tempo brigam por CPU e por teardown.
    expect(executor).toContain("let rodando = false");
    expect(executor).toContain("export function jornadaEmAndamento()");
    expect(router).toContain("jornadaEmAndamento()");
  });

  it("uma rota que falha não interrompe a varredura", () => {
    // Falhar na primeira esconderia as outras dezoito, e o relatório útil é
    // "quais telas estão quebradas", não "a primeira que quebrou".
    expect(executor).toContain("const esperar = <T>(p: Promise<T>) => p.then(() => true).catch(() => false)");
    expect(executor).toContain("problemas.push(");
  });

  it("espera o app montar antes de julgar a tela", () => {
    // Este é O teste deste arquivo.
    //
    // A primeira execução real varreu 19 telas em 6 segundos e deu tudo
    // limpo. Não estava limpo: `domcontentloaded` numa SPA volta com
    // `<div id="root"></div>` e mais nada, o shell é igual em toda rota, e
    // toda conferência feita nesse instante olha pra uma página vazia e
    // aprova. Sem app não há spinner pra esperar, não há erro pra capturar,
    // não há chamada de API pra dar 5xx.
    //
    // Reproduzido com navegador de verdade: a checagem passava em 52ms com o
    // root vazio, e 2,5s depois a página lançava um React #310.
    expect(executor).toContain('document.getElementById("root")?.childElementCount ?? 0) > 0');
    expect(executor).toContain("TIMEOUT_MONTAGEM_MS");

    const posMontagem = executor.indexOf("childElementCount");
    const posSpinner = executor.indexOf("progressbar");
    expect(posMontagem).toBeGreaterThan(0);
    expect(
      posSpinner,
      "o spinner precisa ser conferido DEPOIS da montagem — antes dela não existe spinner nenhum",
    ).toBeGreaterThan(posMontagem);
  });

  it("tela em branco é achado, não silêncio", () => {
    expect(executor).toContain("tela em branco: o app não montou");
  });

  it("erro engolido pelo ErrorBoundary é achado", () => {
    // Sem isto o robô vê uma tela que "montou" e aprova — mas o que montou foi
    // a mensagem de desculpas, não o app.
    expect(executor).toContain("MARCA_ERROR_BOUNDARY");
    expect(executor).toContain("ErrorBoundary engoliu uma exceção de render");
    expect(ler("client/src/components/ErrorBoundary.tsx")).toContain(MARCA_ERROR_BOUNDARY);
  });

  it("cair pro login no meio da caminhada é achado", () => {
    // A tela de login abre perfeitamente bem — passaria como sucesso.
    expect(executor).toContain('onde.startsWith("/login")');
    expect(executor).toContain("a sessão não sobreviveu");
  });

  it("dá um respiro pro erro que só aparece depois de montar", () => {
    // Erro de render não é síncrono com a montagem: monta, o efeito dispara, e
    // aí cai. Sem a pausa o erro seria contado na rota seguinte.
    expect(executor).toContain("await page.waitForTimeout(PAUSA_POS_RENDER_MS)");
    expect(PAUSA_POS_RENDER_MS).toBeGreaterThanOrEqual(1_000);
  });

  it("os listeners são anexados antes do primeiro goto", () => {
    // Evento disparado antes do listener é perdido, e a primeira tela é onde
    // erro de bootstrap aparece.
    const posListener = executor.indexOf('page.on("pageerror"');
    const posEntrar = executor.indexOf("await entrar(page,");
    expect(posListener).toBeGreaterThan(0);
    expect(posEntrar).toBeGreaterThan(posListener);
  });

  it("filtra ruído de rede, mas nunca erro de JS", () => {
    // A assimetria é de propósito: `console.error` engole request cancelada
    // por navegação, `pageerror` é exceção de verdade e não passa por filtro.
    expect(executor).toContain("RUIDO_DE_REDE");
    const i = executor.indexOf('page.on("pageerror"');
    expect(executor.slice(i, executor.indexOf("\n", i))).not.toContain("ehRuido");
    const j = executor.indexOf('page.on("console"');
    expect(executor.slice(j, j + 220)).toContain("!ehRuido(m.text())");
  });

  it("o teardown roda mesmo com a execução quebrada", () => {
    const i = executor.indexOf("} finally {");
    const corpo = executor.slice(i, i + 900);
    expect(corpo).toContain("teardownTestEscritorio(runId)");
    expect(corpo).toContain("rodando = false");
  });

  it("teardown que falha vira dado, não silêncio", () => {
    // `escritorioLimpo: false` é o campo que o dono olha. Engolir o erro aqui
    // esconderia justamente a sobra no banco de produção.
    expect(executor).toContain("escritorioLimpo = await teardownTestEscritorio(runId)");
    expect(executor).toContain("teardown do escritório de teste falhou");
  });

  it("tem teto de tempo que libera a trava", () => {
    // Navegador travado seguraria `rodando` pra sempre e o botão do painel
    // ficaria morto até o próximo deploy.
    expect(executor).toContain("rodarJornadaComTeto");
    expect(TIMEOUT_EXECUCAO_MS).toBeGreaterThan(5 * 60_000);
    expect(TIMEOUT_EXECUCAO_MS).toBeLessThan(30 * 60_000);
  });
});

describe("o disparo pelo painel", () => {
  it("não espera a varredura terminar", () => {
    // A resposta volta com o runId; o painel acompanha pelo histórico.
    const i = router.indexOf("rodar: adminProcedure");
    const corpo = router.slice(i, i + 1400);
    expect(corpo).toContain("void rodarJornadaComTeto(baseUrl)");
    expect(corpo).toContain("return { runId, baseUrl }");
  });

  it("a linha do histórico nasce antes da execução", () => {
    const i = router.indexOf("rodar: adminProcedure");
    const corpo = router.slice(i, i + 1400);
    const posAbrir = corpo.indexOf("await abrirVarredura(");
    const posRodar = corpo.indexOf("void rodarJornadaComTeto");
    expect(posAbrir).toBeGreaterThan(0);
    expect(posRodar).toBeGreaterThan(posAbrir);
  });

  it("execução que morre no meio não fica “rodando” pra sempre", () => {
    expect(router).toContain("marcarFalha(runId, msg)");
    expect(historico).toContain("export async function marcarFalha");
  });

  it("recusa disparo concorrente com mensagem, não com erro genérico", () => {
    const i = router.indexOf("rodar: adminProcedure");
    expect(router.slice(i, i + 500)).toContain("Já existe uma varredura em andamento");
  });

  it("é procedure de admin, como o auditor", () => {
    expect(router).toContain("adminProcedure.mutation");
    expect(router).not.toContain("protectedProcedure");
  });

  it("não existe caminho de correção — o robô relata", () => {
    expect(router).not.toContain("corrigir");
  });

  it("está montado no roteador", () => {
    expect(routers).toContain("adminJornada: adminJornadaRouter");
  });
});

describe("o histórico", () => {
  it("guarda onde rodou", () => {
    // Achado sem saber de qual ambiente veio não serve pra nada.
    expect(migration).toContain("baseUrlJV");
    expect(historico).toContain("baseUrl: baseUrl.slice(0, 255)");
  });

  it("guarda se o escritório foi mesmo apagado", () => {
    expect(migration).toContain("escritorioLimpoJV");
    expect(historico).toContain("escritorioLimpo: r.escritorioLimpo");
  });

  it("só as rotas com problema entram no detalhe", () => {
    // Guardar as 19 sempre encheria a coluna de linha verde que ninguém lê.
    expect(historico).toContain("r.rotas.filter((x) => !x.ok)");
  });

  it("JSON quebrado não derruba a listagem", () => {
    // A execução aconteceu e o resumo em coluna continua válido.
    const i = historico.indexOf("export async function listarVarreduras");
    expect(historico.slice(i, i + 1400)).toContain("} catch {");
  });

  it("a migration é não-destrutiva e idempotente", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS jornada_varreduras");
  });
});

describe("o painel", () => {
  it("está no menu e na rota do admin", () => {
    expect(nav).toContain('label: "Robô de jornada", path: "/admin/robo-jornada"');
    expect(app).toContain('<Route path="/admin/robo-jornada">');
  });

  it("dá sinal de vida enquanto o robô navega", () => {
    // Cinco minutos de silêncio depois do clique é como um botão quebrado se
    // parece.
    expect(painel).toContain("refetchInterval");
    expect(painel).toContain("emAndamento");
  });

  it("responde primeiro “isso mexe nos meus dados?”", () => {
    // É a pergunta que vem antes de qualquer resultado.
    expect(painel).toContain("escritório descartável");
    expect(painel).toContain("padrões bloqueados");
  });

  it("mostra quando o escritório de teste sobrou", () => {
    expect(painel).toContain("sobrou no banco");
    expect(painel).toContain("ROB-01");
  });

  it("o botão não some quando já há execução — fica desabilitado", () => {
    // Botão que desaparece deixa a pessoa sem saber se clicou.
    expect(painel).toContain("disabled={emAndamento || rodar.isPending}");
  });
});
