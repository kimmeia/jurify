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

  it("Processos: a fileira de ações do cabeçalho quebra de linha", () => {
    // Ancorado no `<div>` que abre a fileira (o vizinho imediato do saldo em
    // créditos): o cabeçalho tem outros `flex-wrap`, e olhar o trecho todo
    // deixava a mutação passar.
    const src = tela("Processos.tsx");
    const i = src.indexOf('<Coins className="h-4 w-4 text-warning" />');
    expect(i, "o saldo de créditos do cabeçalho sumiu").toBeGreaterThan(-1);
    const fileira = src.slice(0, i).match(/<div className="(flex items-center[^"]*)"[^>]*>\s*<div className="inline-flex[^"]*"[^>]*>\s*$/);
    expect(fileira, "fileira de ações não encontrada").toBeTruthy();
    expect(fileira![1], "sem flex-wrap os 3 controles somam 425px e vazam").toContain("flex-wrap");
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
});
