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

  it("Dashboard: a aba ativa é sublinhado, não retângulo em volta do rótulo", () => {
    // O `TabsTrigger` da casa já traz `border border-transparent` nos quatro
    // lados. Pintar `data-[state=active]:border-foreground` colore os quatro
    // e desenha uma caixa preta em volta da aba — foi o que o dono viu na
    // tela. Só o lado de baixo pode existir, e só ele ganha cor.
    const src = tela("Dashboard.tsx");
    const i = src.indexOf("<TabsTrigger");
    expect(i, "as abas do Dashboard sumiram").toBeGreaterThan(-1);
    const classes = src.slice(i, src.indexOf("/>", i)).match(/className="([^"]*)"/);
    expect(classes, "className do TabsTrigger não encontrado").toBeTruthy();
    const c = classes![1];
    expect(c, "as bordas laterais/superior voltaram").toContain("border-0");
    expect(c, "o sublinhado da aba sumiu").toContain("border-b-2");
    expect(c, "a aba ativa tem que colorir só a borda DE BAIXO").toContain(
      "data-[state=active]:border-b-foreground",
    );
    expect(c, "border-foreground pinta os quatro lados — é o retângulo").not.toMatch(
      /data-\[state=active\]:border-foreground/,
    );
  });

  it("Cofre: a grade de tribunais é uma linha por estado e a credencial nacional ocupa a fileira", () => {
    // O cartão media 2.566px de altura porque a grade dos 78 pares vivia num
    // cartão de 1/3 da largura (335px úteis, 800px vazios ao lado). Duas
    // classes seguram o conserto.
    const grade = readFileSync(
      join(__dirname, "..", "..", "client", "src", "components", "GradeTribunais.tsx"),
      "utf8",
    );
    expect(grade, "a grade voltou a empilhar caixa por grau").not.toContain(
      "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    );
    // Ancorado na CONSTANTE de classes, não no arquivo inteiro: o comentário
    // acima dela cita `[&>*]:min-w-0`, e olhar o arquivo todo deixava a
    // mutação que apaga a classe passar verde.
    const classes = grade.match(/const CLASSES_GRADE =\s*\n?\s*"([^"]*)"/);
    expect(classes, "a constante CLASSES_GRADE sumiu").toBeTruthy();
    expect(classes![1], "a grade perdeu as colunas que se ajustam sozinhas").toMatch(
      /grid-cols-\[repeat\(auto-fill,minmax\(\d+px,1fr\)\)\]/,
    );
    expect(classes![1], "sem [&>*]:min-w-0 a sigla estica a coluna").toContain("[&>*]:min-w-0");

    const proc = tela("Processos.tsx");
    const i = proc.indexOf("SISTEMA_NACIONAL ?");
    expect(i, "a regra de largura do cartão nacional sumiu").toBeGreaterThan(-1);
    expect(proc.slice(i, i + 120)).toContain("lg:col-span-3");
  });

  it("Dashboard: a busca fica na LINHA das abas, na ponta direita, e a linha atravessa a fileira", () => {
    // Pedido do dono (13/09): "opção de buscar vamos alinhar junto do menu com
    // as quatro opções na extremidade da direita". Três coisas seguram isso.
    const src = tela("Dashboard.tsx");
    const i = src.indexOf("<TabsList");
    const j = src.indexOf("<BuscaDoTopo", i);
    expect(j, "a busca saiu da linha das abas").toBeGreaterThan(i);

    // 1. a fileira é quem leva o `border-b` — antes a linha terminava onde as
    //    abas terminavam, e o dono reclamou disso.
    const fileira = src.slice(0, i).match(/<div className="(flex flex-wrap[^"]*)"[^>]*>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<div className="[^"]*"[^>]*>\s*$/);
    expect(fileira, "fileira das abas não encontrada").toBeTruthy();
    expect(fileira![1], "a linha voltou a ser só da tira de abas").toContain("border-b");

    // 2. no celular a busca ocupa a linha inteira em vez de espremer as abas.
    const busca = src.slice(j, src.indexOf("/>", j));
    expect(busca).toContain("w-full sm:w-auto");

    // 3. quem está DENTRO das abas não desenha a própria busca — senão o dono
    //    veria duas, uma na régua e outra no título do painel.
    expect(src).toContain("<BuscaJaNoTopo.Provider value>");
    const comum = readFileSync(
      join(__dirname, "..", "..", "client", "src", "pages", "dashboards", "common.tsx"),
      "utf8",
    );
    expect(comum).toContain("const buscaLaEmCima = useContext(BuscaJaNoTopo);");
    expect(comum).toContain("{!buscaLaEmCima && <BuscaDoTopo />}");
  });

  it("Dashboard: os cartões de ação saíram dos três painéis de setor", () => {
    // "vamos remover esses cards superiores dos dashboards comercial,
    // operacional e financeiro". Os componentes `FaixaAcoes`/`AcaoCard`
    // continuam em `common.tsx` — apagá-los não foi autorizado —, mas nenhum
    // painel pode voltar a montá-los sem ele pedir.
    for (const arq of ["DashboardComercial", "DashboardOperacional", "DashboardFinanceiro", "DashboardGeral"]) {
      const src = readFileSync(
        join(__dirname, "..", "..", "client", "src", "pages", "dashboards", `${arq}.tsx`),
        "utf8",
      );
      expect(src, `${arq}: a faixa de cartões voltou`).not.toContain("<FaixaAcoes");
      expect(src, `${arq}: cartão de ação voltou`).not.toContain("<AcaoCard");
    }
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
