/**
 * Trava os consertos de largura no celular.
 *
 * O caso real: num celular de 390px, SEIS telas empurravam a página inteira
 * de lado — Dashboard 461px, Processos e Movimentações 449px, Financeiro
 * 443px, Tarefas 437px, Acordos 430px. Nenhuma delas dava erro, nenhum teste
 * ficava vermelho e o build passava: largura não aparece em typecheck.
 *
 * Cada verificação aqui guarda UMA causa encontrada no navegador. São testes
 * de texto, e isso é deliberado: a alternativa (medir no Playwright) depende
 * do app no ar com dados, e o que se quer evitar é alguém apagar a classe
 * sem saber que ela estava segurando a tela.
 *
 * Três causas diferentes, para não virar regra de bolso:
 *   1. tira de abas em linha reta  → `max-w-full overflow-x-auto` na tira;
 *   2. fileira de botões sem quebra → `flex-wrap`;
 *   3. grid sem coluna declarada    → `grid-cols-1` + `min-w-0` nos itens
 *      (item de grid nasce com `min-width:auto` e cresce até o conteúdo).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const tela = (arq: string) =>
  readFileSync(join(__dirname, "..", "..", "client", "src", "pages", arq), "utf8");

/** Recorta o trecho entre duas âncoras, para o expect não valer pra tela toda. */
function trecho(src: string, de: string, ate: string) {
  const i = src.indexOf(de);
  expect(i, `âncora não encontrada: ${de}`).toBeGreaterThan(-1);
  const j = src.indexOf(ate, i + de.length);
  expect(j, `fim não encontrado: ${ate}`).toBeGreaterThan(-1);
  return src.slice(i, j);
}

describe("as telas cabem num celular de 390px", () => {
  it("Dashboard: a régua de abas rola dentro dela mesma", () => {
    // A classe tem que estar no `className` do invólucro, não só citada no
    // comentário acima dele — foi assim que a 1ª versão desta amarra passou
    // com a classe apagada.
    const src = tela("Dashboard.tsx");
    const i = src.indexOf("<TabsList");
    expect(i, "a régua de abas do Dashboard sumiu").toBeGreaterThan(-1);
    const inv = src.slice(0, i).match(/<div className="([^"]*)"[^>]*>\s*$/);
    expect(inv, "invólucro da régua não encontrado").toBeTruthy();
    expect(inv![1], "a tira das abas perdeu a rolagem própria").toContain("overflow-x-auto");
    expect(inv![1], "sem max-w-full a tira cresce além da tela").toContain("max-w-full");
  });

  it("Financeiro: abas rolam e as duas tabelas rolam dentro da moldura", () => {
    const src = tela("Financeiro.tsx");
    // A régua principal da tela (7 abas). A outra TabsList do arquivo é a
    // tira curta de dentro de uma aba e cabe sozinha — medida no navegador.
    const principal = (src.match(/<TabsList[^>]*!bg-muted[^>]*/g) || [])[0];
    expect(principal, "a régua principal de abas do Financeiro sumiu").toBeTruthy();
    expect(principal, "TabsList sem rolagem própria empurra a página").toContain("overflow-x-auto");
    expect(principal, "TabsList sem max-w-full cresce além da tela").toContain("max-w-full");
    const tabelas = (src.match(/<Table>/g) || []).length;
    const molduras = (src.match(/border rounded-lg overflow-x-auto/g) || []).length;
    expect(molduras, `as ${tabelas} tabelas precisam de moldura que role`).toBeGreaterThanOrEqual(2);
  });

  it("Financeiro: o valor do KPI não divide o cartão em duas colunas no celular", () => {
    const src = tela("Financeiro.tsx");
    expect(src, "os KPIs voltaram a 2 colunas no celular — o valor não cabe")
      .toContain("grid-cols-1 sm:grid-cols-2");
  });

  it("Processos: o cabeçalho não tem fileira de ações, e a tira de abas quebra", () => {
    // Em 12/09 a fileira (créditos + Consultar CNJ + Resumo diário) somava
    // 425px e vazava da tela de 390px; o conserto foi `flex-wrap` nela. Em
    // 13/09 o dono tirou os três controles, então o que impede o vazamento
    // agora é não existir fileira — e quem segura a largura é a tira de abas.
    const src = tela("Processos.tsx");
    const cabecalho = trecho(src, "function CabecalhoProcessos(", "export default function Processos(");
    expect(cabecalho, "o cabeçalho voltou a ter controle na direita").not.toContain("<Button");

    const tira = (src.match(/<TabsList[^>]*!bg-muted[^>]*/g) || [])[0];
    expect(tira, "a régua de abas de Processos sumiu").toBeTruthy();
    expect(tira, "sem flex-wrap as abas viram uma linha reta mais larga que a tela")
      .toContain("flex-wrap");
  });

  it("Tarefas: os filtros descem para a linha de baixo", () => {
    const src = tela("Tarefas.tsx");
    const cabeca = trecho(src, "{/* Busca + filtros */}", "Buscar tarefas...");
    expect(cabeca, "sem flex-wrap os 4 filtros ficam na linha da busca e vazam 47px")
      .toContain("flex-wrap");
    // Os 4 chips somam ~350px e sobram ~358px: sem quebra PRÓPRIA o último
    // ("Concluída") era aparado na borda mesmo com a linha já quebrada.
    const grupo = trecho(src, "Buscar tarefas...", '"todas", "pendente"');
    expect(grupo, "o grupo de filtros precisa quebrar por conta própria")
      .toMatch(/flex flex-wrap gap-1 max-w-full/);
  });

  it("Tarefas: a linha de apoio quebra em vez de se sobrepor", () => {
    // Lia-se "10/09/2026⚠" com o triângulo em cima do número, porque os
    // itens encolhiam abaixo do próprio texto.
    const linha = trecho(tela("Tarefas.tsx"), "t.responsavelNome &&", "t.vencida &&");
    const src = tela("Tarefas.tsx");
    const i = src.indexOf("{t.responsavelNome &&");
    const inv = src.slice(0, i).match(/<div className="(flex[^"]*text-\[10px\][^"]*)"[^>]*>\s*$/);
    expect(inv, "linha de apoio da tarefa não encontrada").toBeTruthy();
    expect(inv![1], "sem flex-wrap o aviso de atraso cai em cima da data").toContain("flex-wrap");
    expect((linha.match(/shrink-0/g) || []).length,
      "responsável e data precisam de shrink-0 para não encolher abaixo do texto")
      .toBeGreaterThanOrEqual(2);
  });

  it("Acordos: o grid declara a coluna do celular e os itens podem encolher", () => {
    const t = trecho(tela("Acordos.tsx"), 'className="grid gap-3.5', "Situação da carteira");
    expect(t, "grid sem coluna declarada cria coluna `auto` e cresce até o conteúdo")
      .toContain("grid-cols-1 lg:grid-cols-3");
    const minw = (t.match(/min-w-0/g) || []).length;
    expect(minw, "item de grid nasce com min-width:auto — os dois precisam de min-w-0")
      .toBeGreaterThanOrEqual(2);
  });

  it("Agenda: a pílula AGORA cabe na calha das horas", () => {
    const src = tela("Agenda.tsx");
    const i = src.indexOf("AGORA");
    expect(i, "a pílula AGORA sumiu").toBeGreaterThan(-1);
    const volta = src.slice(Math.max(0, i - 420), i);
    expect(volta, "sem w-12 a pílula mede ~85px numa calha de 48px e invade a grade")
      .toContain("w-12");
    expect(volta, "o selo precisa ficar em duas linhas para caber").toContain("flex-col");
  });

  it("Movimentações: a coluna do nome cresce em tela grande", () => {
    const t = trecho(tela("Movimentacoes.tsx"), "function LinhaRelevante", "nomeDoCaso(item)");
    expect(t, "220px fixos truncavam o nome com mil pixels vazios à direita")
      .toMatch(/w-\[220px\] lg:w-\[300px\] xl:w-\[380px\]/);
  });

  it("Editar plano: o destaque quebra em linhas em vez de exigir a largura dele", () => {
    // A causa medida: `truncate` é `white-space: nowrap`, e um ITEM DE FLEX
    // nasce com `min-width: auto` — junto, o texto exigia 1467px e empurrava
    // cartão, coluna, grid e página (2110px numa janela de 1440). `min-w-0`
    // é o que deixa o item encolher; sem ele, trocar truncate por break-words
    // não resolveria sozinho.
    const t = trecho(tela("admin/AdminPlanoEditor.tsx"), "Destaques do cartão", "novaFeature");
    const linha = t.match(/<span className="([^"]*)">\{f\}<\/span>/);
    expect(linha, "a linha do destaque sumiu").toBeTruthy();
    expect(linha![1], "sem min-w-0 o item de flex exige a largura do texto inteiro")
      .toContain("min-w-0");
    expect(linha![1], "nowrap volta a empurrar a página de lado").not.toContain("truncate");
  });

  it("Editar plano: a coluna do meio pode encolher e as laterais têm largura própria", () => {
    const src = tela("admin/AdminPlanoEditor.tsx");
    const grid = src.match(/className="mx-auto grid max-w-\[1500px\][^"]*"/);
    expect(grid, "o grid de três colunas do editor sumiu").toBeTruthy();
    expect(grid![0], "só minmax(0,1fr) impede um filho largo de esticar a linha")
      .toContain("minmax(0,1fr)");
  });

  it("Editar plano: a grade de limites começa em uma coluna", () => {
    const t = trecho(tela("admin/AdminPlanoEditor.tsx"), "Limites", "Módulos inclusos");
    expect(t, "duas colunas fixas espremem rótulo e campo num celular de 390px")
      .toContain("grid-cols-1");
    expect(t, "célula de grid nasce com min-width:auto e cresce até o rótulo mais longo")
      .toContain("[&>*]:min-w-0");
  });
});
