/**
 * Comparador ANTES | DEPOIS das telas reais, lado a lado e com lupa.
 *
 *   node gera-comparador.mjs <ser-antes> <ser-depois> <fontes.css> <saida.html>
 *
 * Por que este existe em vez do `gera-navegavel.mjs`: no navegável o dono não
 * viu diferença nenhuma — e estava certo. Cinco dos seis consertos só
 * aparecem NO CELULAR, o arquivo abria no computador (onde nada muda), a
 * chave Antes/Depois obrigava a guardar a tela anterior na memória, e o
 * quadro de 390px CORTA o que vaza, então o "antes" parecia normal.
 *
 * O que este faz diferente:
 *   - abre em cada achado JÁ na tela e no tamanho onde ele acontece;
 *   - mostra os dois lados ao mesmo tempo, com a MESMA lupa e o MESMO
 *     recorte, então a diferença fica na mesma posição da tela;
 *   - desenha um anel em cima do elemento que mudou e, no celular, a linha
 *     da borda da tela — é o que torna o vazamento visível;
 *   - tem "piscar", que sobrepõe os dois no mesmo lugar (é assim que olho
 *     humano acha diferença pequena);
 *   - e ainda deixa navegar o sistema inteiro, como antes.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [ANTES, DEPOIS, FONTES_CSS, SAIDA] = process.argv.slice(2);

const TELAS = [
  ["dashboard", "Dashboard"],
  ["atendimento", "Atendimento"],
  ["clientes", "Clientes"],
  ["agenda", "Agenda"],
  ["processos", "Processos"],
  ["movimentacoes", "Movimentações"],
  ["kanban", "Kanban"],
  ["acordos", "Acordos"],
  ["financeiro", "Financeiro"],
  ["relatorios", "Relatórios"],
  ["tarefas", "Tarefas"],
];

/**
 * Um item = uma comparação. `alvo` diz como achar o ponto dentro da tela:
 * o texto que aparece nele e quantos níveis subir até o bloco que interessa.
 * `medida` é a largura do conteúdo medida no navegador (celular de 390px).
 */
const ITENS = [
  {
    id: "dashboard-abas", olhe: "Olhe a moldura cinza das abas (o anel): no antes a quarta aba ESCAPA dela e cruza a linha da borda da tela; no depois ela fica cortada dentro da moldura, e é a moldura que rola.", tela: "dashboard", vista: "celular",
    curto: "A régua de abas saía pela tela",
    alvo: { texto: "Operacional", subir: 2 },
    medida: { antes: 461, depois: 390, tela: 390 },
    pontos: [[
      "“Geral · Comercial · Operacional · Financeiro” seguia em linha reta",
      "Os quatro botões somam mais do que a largura do celular, então empurravam a PÁGINA inteira para o lado: arrastar a lista fazia a tela andar junto. Agora quem rola é a própria régua, e o resto fica parado.",
    ]],
  },
  {
    id: "agenda-agora", olhe: "Olhe a etiqueta amarela: no antes ela é larga e entra por cima do bloco do compromisso; no depois cabe na calha das horas, em duas linhas.", tela: "agenda", vista: "desktop",
    curto: "A etiqueta AGORA cobria o compromisso",
    alvo: { texto: "AGORA", subir: 0 },
    medida: { antes: 103, depois: 48, tela: 48, rotulo: "largura da etiqueta · calha das horas tem 48px" },
    pontos: [[
      "Ela media 103px numa calha de 48px",
      "O excedente era desenhado por cima da grade e escondia o nome do compromisso que está acontecendo. Virou duas linhas — AGORA em cima, o horário embaixo — e agora termina exatamente onde a grade começa.",
    ]],
  },
  {
    id: "processos-acoes", olhe: "Olhe a fileira de botões do topo: no antes ela continua para fora da linha da borda; no depois quebra para a linha de baixo.", tela: "processos", vista: "celular",
    curto: "Os botões do topo passavam da borda",
    alvo: { texto: "Resumo diário", subir: 1 },
    medida: { antes: 449, depois: 390, tela: 390 },
    pontos: [[
      "Saldo de créditos + Consultar CNJ + Resumo diário na mesma linha",
      "Os três somavam 425px numa tela de 390px e o último ficava metade fora. Agora a fileira quebra para a linha de baixo quando não cabe.",
    ]],
  },
  {
    id: "movimentacoes-nome", olhe: "Olhe o nome do cliente: no antes termina em “…”; no depois aparece inteiro.", tela: "movimentacoes", vista: "desktop",
    curto: "O nome do cliente era cortado",
    alvo: { seletor: "nome-movimentacao", subir: 0 },
    medida: { antes: 220, depois: 380, tela: 380, rotulo: "largura da coluna do nome" },
    pontos: [[
      "220px fixos, com mais de mil pixels vazios ao lado",
      "“Maria Aparecida Nogueira de Sousa” aparecia como “Maria Aparecida Nogueir…” num monitor de 1440px. A coluna cresce por faixa (300px no notebook, 380px no monitor) e no celular continua enxuta.",
    ]],
  },
  {
    id: "acordos-cartoes", olhe: "Olhe os três cartões: no antes ficam lado a lado e atravessam a linha da borda; no depois ficam um debaixo do outro.", tela: "acordos", vista: "celular",
    curto: "Três cartões lado a lado num celular",
    alvo: { texto: "Em negociação agora", subir: 3 },
    medida: { antes: 430, depois: 390, tela: 390 },
    pontos: [[
      "Cada cartão ficava com ~110px",
      "O bloco não declarava quantas colunas usar no celular, então ele crescia até o tamanho do conteúdo e empurrava a página. Agora empilha no celular e volta a três colunas a partir do notebook.",
    ]],
  },
  {
    id: "financeiro-kpi", olhe: "Olhe o primeiro cartão verde: no antes o valor quebra em duas linhas e os rótulos colam nos números; no depois o cartão ocupa a largura toda.", tela: "financeiro", vista: "celular",
    curto: "O cartão do KPI ficava ilegível",
    alvo: { texto: "Entrou no caixa", subir: 1 },
    pontos: [
      ["O valor quebrava em duas linhas",
       "“R$ 10.700,00” não cabia na largura do cartão: “R$” ficava em cima e o número embaixo. Agora o cartão ocupa a largura toda no celular e o valor fica inteiro numa linha."],
      ["A legenda colava no valor",
       "Lia-se “AsaasR$ 0,00” e “ManualR$ 10.700,00”, sem espaço entre o rótulo e o número. Ganhou folga e os dois aparecem inteiros."],
    ],
  },
  {
    id: "financeiro-dinheiro", olhe: "Aqui o tamanho não muda — o que muda é o que está escrito: “R$ 10.7k” no antes, “R$ 10,7 mil” no depois.", tela: "financeiro", vista: "desktop",
    curto: "Dinheiro escrito com ponto de inglês",
    alvo: { texto: "Entrou no caixa", subir: 1 },
    pontos: [[
      "O mesmo valor saía “R$ 10.700,00” no Dashboard e “R$ 10.7k” aqui",
      "O ponto decimal é de inglês, num sistema brasileiro — e a função que abreviava estava copiada, idêntica e com o mesmo defeito, em dois arquivos. Agora existe uma só, e ela escreve no formato do país: “R$ 10,7 mil”.",
    ]],
  },
  {
    id: "financeiro-abas", olhe: "Olhe a régua de abas (o anel): no antes ela cruza a linha da borda da tela; no depois termina antes dela.", tela: "financeiro", vista: "celular",
    curto: "As abas e a tabela empurravam a tela",
    alvo: { texto: "Cobranças", subir: 1 },
    medida: { antes: 443, depois: 390, tela: 390 },
    pontos: [[
      "Sete abas em linha reta e uma tabela de 1.589px",
      "As duas coisas arrastavam a página de lado. Agora as abas rolam dentro da própria régua e a tabela rola dentro da moldura dela — a página fica parada. (Virar a tabela em cartão, como Clientes já faz, é redesenho e não entrou.)",
    ]],
  },
  {
    id: "tarefas-filtros", olhe: "Olhe o botão “Concluída”: no antes fica depois da linha da borda, fora da tela; no depois desceu para a linha de baixo.", tela: "tarefas", vista: "celular",
    curto: "Os filtros passavam da borda",
    alvo: { texto: "Concluída", subir: 0 },
    medida: { antes: 437, depois: 390, tela: 390 },
    pontos: [[
      "“Todas · Pendente · Em andamento · Concluída” na linha da busca",
      "Estouravam 47px para fora: “Concluída” ficava fora da tela. Agora a busca fica numa linha e os filtros na seguinte, quebrando quando não cabem.",
    ]],
  },
  {
    id: "tarefas-aviso", olhe: "Aqui o tamanho não muda — olhe a data: no antes o triângulo de atraso fica colado/em cima dela; no depois cada coisa tem a sua linha.", tela: "tarefas", vista: "celular",
    curto: "O aviso de atraso caía em cima da data",
    alvo: { texto: "Cobrar entrada", subir: 2 },
    pontos: [[
      "Lia-se “10/09/2026⚠”, com o triângulo colado no número",
      "Responsável, data e aviso ficavam na mesma linha e encolhiam abaixo do próprio texto, até se sobreporem. Agora quebram de linha em vez de se atropelar.",
    ]],
  },
];

/** O que ficou de fora, e por quê. Cada um é decisão do dono. */
const PENDENTES = [
  ["Título de tela em 5 tamanhos (18 · 20 · 22 · 24 · 26px)",
   "A troca de tela “pula” porque cada uma escreve o próprio tamanho. Padronizar mexe em cabeçalho de tela — e aí entram a saudação do Dashboard e do Atendimento (“Bom dia, Dono”) e os heroes de Clientes e Financeiro, que são DELIBERADOS e melhores que um título seco. Precisa de mockup próprio e da sua autorização, porque trocar a saudação por “Dashboard” seria remoção."],
  ["Três avisos empilhados antes do conteúdo no Financeiro",
   "“Asaas desconectado” aparece como pastilha E como faixa, dizendo a mesma coisa, e embaixo vem “7 cobranças sem categoria”. Juntar ou esconder um deles é decisão de produto — e tirar aviso é remoção. Não mexi."],
  ["A tabela de cobranças tem 1.589px no celular",
   "Hoje ela rola dentro da moldura dela, o que já impede a página de andar de lado. Virar cartão abaixo de `md` (como Clientes já faz) é redesenho de tabela, não recorte de layout."],
  ["O valor no hero verde do Financeiro tem contraste baixo",
   "Verde-escuro sobre verde. É decisão de cor, e cor neste sistema foi escolhida por você — não mexo sem falar."],
  ["Na tarefa, o título é cortado no celular e os botões da linha não existem no toque",
   "“Cobrar entrada d…”: os botões de ação da linha só aparecem no `hover`, que no celular nunca acontece — mas ocupam largura mesmo invisíveis, e é essa largura que corta o título. Consertar de verdade é decidir o que a linha mostra num celular. Mockup próprio."],
  ["47 telas formatam data na mão",
   "Fiz o formatador de dinheiro (`shared/formato-numero.ts`); o de data é o mesmo tipo de conserto, maior. Só vale a pena junto com uma passada nas telas."],
];

const fontes = readFileSync(FONTES_CSS, "utf8");
const dados = { css: {}, telas: { antes: {}, depois: {} } };
for (const [estado, dir] of [["antes", ANTES], ["depois", DEPOIS]]) {
  dados.css[estado] = readFileSync(`${dir}/css.txt`, "utf8");
  for (const vp of ["desktop", "celular"]) {
    dados.telas[estado][vp] = {};
    for (const [nome] of TELAS) {
      const arq = `${dir}/${vp}/${nome}.html`;
      if (existsSync(arq)) dados.telas[estado][vp][nome] = readFileSync(arq, "utf8");
    }
  }
}

/** JSON dentro de <script> não pode conter "</" nem "<!--". */
const jsonSeguro = (o) =>
  JSON.stringify(o).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\u0021--");

const NOME_TELA = Object.fromEntries(TELAS);

const menu = ITENS.map((it, i) => `
  <button class="item" data-i="${i}">
    <span class="rot"><span class="num">${i + 1}</span>${it.curto}</span>
    <span class="sub">${NOME_TELA[it.tela]} · ${it.vista === "celular" ? "no celular" : "no computador"}</span>
  </button>`).join("");

const menuTelas = TELAS.map(([id, rotulo]) =>
  `<button class="item peq" data-tela="${id}">${rotulo}</button>`).join("");

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JuridFlow — antes e depois, lado a lado</title>
<style>
${fontes}
:root{
  --tinta:#0f1b2d; --tinta-2:#4a5b70; --tinta-3:#7c8a9c; --linha:#dde3ea;
  --fundo:#eef2f7; --papel:#fff; --marinho:#194b86; --marinho-claro:#e8eef7;
  --vermelho:#a8231b; --vermelho-bg:#fdeceb; --verde:#097245; --verde-bg:#e6f4ec;
  --ambar:#8a5a0b;
  --sombra:0 1px 2px rgba(15,27,45,.06),0 8px 24px rgba(15,27,45,.07);
}
*{box-sizing:border-box}
body{margin:0;background:var(--fundo);color:var(--tinta);
  font-family:Inter,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;
  -webkit-font-smoothing:antialiased}
header{position:sticky;top:0;z-index:30;background:var(--papel);border-bottom:1px solid var(--linha);
  padding:11px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.marca{display:flex;align-items:center;gap:10px;min-width:0}
.marca .j{width:34px;height:34px;border-radius:9px;background:var(--marinho);color:#fff;
  font-family:Poppins,Inter,sans-serif;font-weight:800;font-size:19px;
  display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.marca b{font-size:15px;font-weight:700;letter-spacing:-.01em;display:block}
.marca small{color:var(--tinta-2);font-size:12px;display:block}
.chaves{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-left:auto}
.chave{display:inline-flex;background:var(--fundo);border:1px solid var(--linha);border-radius:9px;padding:3px;gap:2px}
.chave button{appearance:none;border:0;background:transparent;color:var(--tinta-2);font:inherit;
  font-weight:600;font-size:12.5px;padding:6px 12px;border-radius:7px;cursor:pointer;white-space:nowrap}
.chave button[aria-pressed=true]{background:var(--papel);color:var(--tinta);box-shadow:var(--sombra)}
.rotulo{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--tinta-3)}
.corpo{display:grid;grid-template-columns:300px minmax(0,1fr);align-items:start}
nav{border-right:1px solid var(--linha);background:var(--papel);min-height:calc(100vh - 58px);padding:14px 12px 40px}
nav .titulo{padding:4px 10px 8px;font-size:11px;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;color:var(--tinta-3)}
nav .titulo.sep{margin-top:16px;border-top:1px solid var(--linha);padding-top:14px}
.item{display:block;width:100%;text-align:left;appearance:none;border:0;background:transparent;
  padding:8px 11px;border-radius:9px;cursor:pointer;font:inherit;margin-bottom:2px}
.item:hover{background:var(--fundo)}
.item[aria-current=true]{background:var(--marinho-claro)}
.item[aria-current=true] .rot{color:var(--marinho)}
.item.peq{padding:6px 11px;font-size:13px;font-weight:600;color:var(--tinta-2)}
.item.peq[aria-current=true]{color:var(--marinho)}
.rot{display:flex;align-items:baseline;gap:8px;font-weight:600;font-size:13.5px;line-height:1.3}
.num{flex:0 0 auto;width:19px;height:19px;border-radius:99px;background:var(--tinta-3);color:#fff;
  font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;
  transform:translateY(2px)}
.item[aria-current=true] .num{background:var(--marinho)}
.sub{display:block;color:var(--tinta-3);font-size:11.5px;margin-top:2px;padding-left:27px}
main{padding:20px 22px 70px;min-width:0}
.cabeca{margin-bottom:12px}
.cabeca h1{margin:0 0 3px;font-size:23px;font-weight:700;letter-spacing:-.02em}
.cabeca .onde{display:inline-flex;align-items:center;gap:7px;color:var(--tinta-2);font-size:13px}
.pino{display:inline-flex;align-items:center;gap:5px;background:var(--marinho-claro);color:var(--marinho);
  font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:99px}
.explica{background:var(--papel);border:1px solid var(--linha);border-left:3px solid var(--ambar);
  border-radius:11px;padding:12px 15px;margin-bottom:14px;box-shadow:var(--sombra);max-width:1000px}
.explica h3{margin:0 0 2px;font-size:14px;font-weight:650}
.explica p{margin:0 0 10px;color:var(--tinta-2);font-size:13.5px}
.explica p:last-child{margin-bottom:0}
.explica code{background:var(--fundo);padding:1px 5px;border-radius:5px;font-size:12.5px}

.olhe{display:flex;gap:10px;align-items:baseline;max-width:1000px;margin:-4px 0 14px;
  background:#fff8e8;border:1px solid #f0dcb4;border-radius:10px;padding:11px 15px;
  color:#6b4a06;font-size:13.5px}
.olhe b{flex:0 0 auto;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:#8a5a0b}
.par{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
.lado{flex:0 0 auto}
.selo{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;
  letter-spacing:.07em;text-transform:uppercase;margin-bottom:7px}
.selo.a{color:var(--vermelho)}
.selo.d{color:var(--verde)}
.selo i{width:10px;height:10px;border-radius:3px;display:inline-block}
.selo.a i{background:var(--vermelho)}
.selo.d i{background:var(--verde)}
.lente{position:relative;overflow:hidden;background:#fff;border-radius:12px;
  border:1px solid var(--linha);box-shadow:var(--sombra)}
.lente.a{outline:2px solid var(--vermelho-bg)}
.lente.d{outline:2px solid var(--verde-bg)}
.lente iframe{border:0;display:block;transform-origin:0 0;background:#fff}
.anel{position:absolute;border:2px solid var(--vermelho);border-radius:7px;
  box-shadow:0 0 0 9999px rgba(15,27,45,.06);pointer-events:none}
.lente.d .anel{border-color:var(--verde)}
.borda-tela{position:absolute;top:0;bottom:0;width:0;border-left:2px dashed var(--vermelho);
  pointer-events:none}
.borda-tela span{position:absolute;top:6px;right:5px;background:var(--vermelho);color:#fff;
  font-size:10px;font-weight:700;padding:2px 6px;border-radius:5px;white-space:nowrap}
.aviso-lente{margin-top:7px;color:var(--tinta-3);font-size:11.5px;max-width:420px}

.regua{max-width:1000px;margin:18px 0 0;background:var(--papel);border:1px solid var(--linha);
  border-radius:11px;padding:13px 16px;box-shadow:var(--sombra)}
.regua h4{margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;color:var(--tinta-3)}
.barra{display:grid;grid-template-columns:64px minmax(0,1fr) 92px;align-items:center;gap:10px;margin-bottom:7px}
.barra b{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--tinta-3)}
.barra .trilha{height:16px;background:var(--fundo);border-radius:5px;position:relative;overflow:hidden}
.barra .cabe{position:absolute;top:0;bottom:0;left:0;background:#c6d4e6}
.barra .sobra{position:absolute;top:0;bottom:0;background:var(--vermelho);opacity:.85}
.barra .marco{position:absolute;top:-3px;bottom:-3px;border-left:2px dashed var(--tinta-2)}
.barra i{font-style:normal;font-size:12.5px;font-weight:600;text-align:right;color:var(--tinta-2);
  font-variant-numeric:tabular-nums}
.barra i.mal{color:var(--vermelho)}
.barra i.bem{color:var(--verde)}
.regua small{display:block;margin-top:6px;color:var(--tinta-3);font-size:11.5px}

.pendentes{background:var(--papel);border:1px solid var(--linha);border-radius:14px;
  padding:6px 20px 18px;box-shadow:var(--sombra);max-width:880px}
.pendentes h3{font-size:14.5px;font-weight:650;margin:18px 0 4px}
.pendentes p{margin:0;color:var(--tinta-2)}
.pendentes code{background:var(--fundo);padding:1px 5px;border-radius:5px;font-size:12.5px}
.rodape{margin-top:22px;color:var(--tinta-3);font-size:12px;max-width:1000px}
.recado{position:fixed;left:50%;bottom:26px;transform:translate(-50%,14px);opacity:0;
  background:var(--tinta);color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;
  pointer-events:none;transition:.18s;z-index:40;max-width:86vw;text-align:center}
.recado.ver{opacity:1;transform:translate(-50%,0)}
@media (max-width:1000px){
  .corpo{grid-template-columns:1fr}
  nav{border-right:0;border-bottom:1px solid var(--linha);min-height:0}
  main{padding:14px}
  .chaves{margin-left:0;width:100%}
}
</style>
</head>
<body>

<header>
  <div class="marca">
    <div class="j">J</div>
    <div>
      <b>JuridFlow — antes e depois</b>
      <small>telas do sistema rodando, serializadas em 12/09/2026</small>
    </div>
  </div>
  <div class="chaves">
    <span class="rotulo">Vista</span>
    <div class="chave" id="chave-modo">
      <button data-modo="lado" aria-pressed="true">Lado a lado</button>
      <button data-modo="piscar" aria-pressed="false">Piscar</button>
      <button data-modo="inteira" aria-pressed="false">Tela inteira</button>
    </div>
    <div class="chave">
      <button id="anterior">← anterior</button>
      <button id="proximo">próximo →</button>
    </div>
  </div>
</header>

<div class="corpo">
  <nav>
    <div class="titulo">O que muda (${ITENS.length})</div>
    ${menu}
    <div class="titulo sep">Fora da proposta</div>
    <button class="item" data-pendentes="1">
      <span class="rot"><span class="num" style="background:var(--tinta-3)">${PENDENTES.length}</span>O que NÃO entrou</span>
      <span class="sub">Decisões que são suas, e o motivo de cada uma.</span>
    </button>
    <div class="titulo sep">Navegar pelo sistema</div>
    ${menuTelas}
  </nav>
  <main>
    <div class="cabeca">
      <h1 id="titulo">—</h1>
      <div class="onde" id="onde"></div>
    </div>
    <div id="explica"></div>
    <div class="par" id="par"></div>
    <div id="regua"></div>
    <div class="pendentes" id="pendentes" hidden></div>
    <div class="rodape" id="rodape"></div>
  </main>
</div>

<div class="recado" id="recado"></div>

<script type="application/json" id="dados">${jsonSeguro(dados)}</script>
<script type="application/json" id="itens">${jsonSeguro(ITENS)}</script>
<script type="application/json" id="pendentes-json">${jsonSeguro(PENDENTES)}</script>
<script type="application/json" id="nomes">${jsonSeguro(NOME_TELA)}</script>
<script>
const D = JSON.parse(document.getElementById("dados").textContent);
const ITENS = JSON.parse(document.getElementById("itens").textContent);
const PENDENTES = JSON.parse(document.getElementById("pendentes-json").textContent);
const NOME = JSON.parse(document.getElementById("nomes").textContent);
const MEDIDA = { desktop:[1440,900], celular:[390,844] };
/** Caixa da lupa: o celular pede caixa alta e estreita; o monitor, larga. */
const CAIXA = { desktop:[548,372], celular:[406,452] };
const PAD = 26;

let idx = 0, modo = "lado", vendoPendentes = false, telaLivre = null, estadoLivre = "depois";

const recado = document.getElementById("recado");
let tRec;
function falar(t){
  recado.textContent = t; recado.classList.add("ver");
  clearTimeout(tRec); tRec = setTimeout(()=>recado.classList.remove("ver"), 2400);
}

function pagina(estado, vista, tela){
  const corpo = ((D.telas[estado]||{})[vista]||{})[tela];
  if (!corpo) return '<body style="font:14px Inter,sans-serif;color:#7c8a9c;padding:30px">Tela não capturada neste tamanho.</body>';
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>' +
    D.css[estado] + '</style></head>' + corpo + '</html>';
}

/**
 * Acha o ponto que mudou dentro da tela: o elemento MAIS FUNDO que contém o
 * texto (senão pegaria o <body>), e daí sobe os níveis pedidos.
 */
function acharAlvo(doc, alvo){
  if (alvo.seletor === "nome-movimentacao") {
    const el = [...doc.querySelectorAll("span")]
      .find((s) => typeof s.className === "string" && s.className.startsWith("w-[220px]"));
    return el || null;
  }
  const alvos = [...doc.querySelectorAll("body *")].filter((el) => {
    const t = (el.textContent || "");
    if (!t.includes(alvo.texto)) return false;
    return ![...el.children].some((f) => (f.textContent || "").includes(alvo.texto));
  });
  let el = alvos[0];
  if (!el) return null;
  for (let i = 0; i < (alvo.subir || 0) && el.parentElement && el.parentElement.tagName !== "BODY"; i++) {
    el = el.parentElement;
  }
  return el;
}

function medirAlvo(frame, alvo, rolagemForcada){
  const doc = frame.contentDocument;
  if (!doc) return null;
  const el = acharAlvo(doc, alvo);
  if (!el) return null;
  const se = doc.scrollingElement;
  const r0 = el.getBoundingClientRect();
  // Rola só na vertical: na horizontal a tela tem que ficar como ABRE, senão
  // o vazamento lateral (que é o defeito) desaparece da foto.
  // A MESMA rolagem nos dois lados, de propósito: quando o conserto empurra
  // o elemento para a linha de baixo, é essa descida que conta a história.
  se.scrollTop = rolagemForcada != null
    ? rolagemForcada
    : Math.max(0, r0.top + se.scrollTop - 70);
  se.scrollLeft = 0;
  const r = el.getBoundingClientRect();
  return { left:r.left, top:r.top, width:r.width, height:r.height, rolagem: se.scrollTop };
}

function carregar(frame, estado, vista, tela){
  return new Promise((ok) => { frame.onload = () => ok(); frame.srcdoc = pagina(estado, vista, tela); });
}

function lado(classe, rotulo){
  return '<div class="lado"><div class="selo ' + classe + '"><i></i>' + rotulo + '</div>' +
    '<div class="lente ' + classe + '"><iframe title="' + rotulo + '"></iframe>' +
    '<div class="anel" hidden></div><div class="borda-tela" hidden><span></span></div></div>' +
    '<div class="aviso-lente"></div></div>';
}

function barra(rotulo, valor, tela, pior, teto, comLimite){
  const cabe = Math.min(valor, tela) / teto * 100;
  const sobra = Math.max(0, valor - tela) / teto * 100;
  const marco = tela / teto * 100;
  return '<div class="barra"><b>' + rotulo + '</b><div class="trilha">' +
    '<div class="cabe" style="width:' + (comLimite ? cabe : valor / teto * 100).toFixed(2) + '%"></div>' +
    (comLimite && sobra > 0 ? '<div class="sobra" style="left:' + marco.toFixed(2) + '%;width:' + sobra.toFixed(2) + '%"></div>' : '') +
    (comLimite ? '<div class="marco" style="left:' + marco.toFixed(2) + '%"></div>' : '') +
    '</div><i class="' + (pior ? "mal" : "bem") + '">' + valor + 'px</i></div>';
}

async function pintar(){
  document.querySelectorAll("[data-i]").forEach((b) => b.setAttribute("aria-current", String(!vendoPendentes && !telaLivre && Number(b.dataset.i) === idx)));
  document.querySelectorAll("[data-tela]").forEach((b) => b.setAttribute("aria-current", String(telaLivre === b.dataset.tela)));
  document.querySelector("[data-pendentes]").setAttribute("aria-current", String(vendoPendentes));
  document.querySelectorAll("[data-modo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modo === modo)));

  const pend = document.getElementById("pendentes");
  const par = document.getElementById("par");
  const regua = document.getElementById("regua");
  const explica = document.getElementById("explica");

  if (vendoPendentes){
    par.innerHTML = ""; regua.innerHTML = ""; explica.innerHTML = "";
    document.getElementById("titulo").textContent = "O que NÃO entrou nesta proposta";
    document.getElementById("onde").textContent = "Cada item aqui é uma decisão sua — está escrito por que eu não mexi.";
    document.getElementById("rodape").textContent = "";
    pend.hidden = false;
    const cod = (t) => t.replace(/\\x60([^\\x60]+)\\x60/g, "<code>$1</code>");
    pend.innerHTML = PENDENTES.map(([t,d]) => "<h3>" + t + "</h3><p>" + cod(d) + "</p>").join("");
    return;
  }
  pend.hidden = true;

  // "Navegar pelo sistema": uma tela inteira por vez, com chave de estado.
  if (telaLivre){
    explica.innerHTML = '<div class="explica" style="border-left-color:var(--linha)"><p>' +
      'Aqui não há comparação: é o sistema para você passear, nos dois tamanhos. ' +
      'Use <b>Lado a lado</b> num dos achados numerados à esquerda para ver a diferença.</p></div>';
    document.getElementById("titulo").textContent = NOME[telaLivre] || telaLivre;
    document.getElementById("onde").innerHTML = '<span class="pino">versão: ' + estadoLivre + '</span>';
    regua.innerHTML = "";
    par.innerHTML = lado("d", "computador") + lado("d", "celular");
    const [dk, cel] = par.querySelectorAll(".lente");
    const fdk = dk.querySelector("iframe"), fcel = cel.querySelector("iframe");
    fdk.style.width = "1440px"; fdk.style.height = "900px"; fdk.style.transform = "scale(0.42)";
    dk.style.width = "605px"; dk.style.height = "378px";
    fcel.style.width = "390px"; fcel.style.height = "844px"; fcel.style.transform = "scale(0.52)";
    cel.style.width = "203px"; cel.style.height = "439px";
    par.querySelectorAll(".selo").forEach((s, i) => { s.className = "selo d"; s.innerHTML = '<i></i>' + (i ? "celular" : "computador"); });
    await Promise.all([carregar(fdk, estadoLivre, "desktop", telaLivre), carregar(fcel, estadoLivre, "celular", telaLivre)]);
    document.getElementById("rodape").textContent = "Foto, não protótipo: dentro da moldura nada abre, filtra ou envia.";
    return;
  }

  const it = ITENS[idx];
  const [L,A] = MEDIDA[it.vista];
  const [BW,BH] = modo === "inteira" ? [it.vista === "celular" ? 390 : 720, it.vista === "celular" ? 844 : 450] : CAIXA[it.vista];

  document.getElementById("titulo").textContent = (idx + 1) + ". " + it.curto;
  document.getElementById("onde").innerHTML =
    '<span class="pino">' + NOME[it.tela] + '</span>' +
    '<span>' + (it.vista === "celular" ? "como aparece num celular de 390px de largura" : "como aparece num monitor de 1440px") + '</span>';

  explica.innerHTML = '<div class="explica">' + it.pontos
    .map(([t,d]) => "<h3>" + t + "</h3><p>" + d + "</p>").join("") + '</div>' +
    (it.olhe ? '<div class="olhe"><b>Onde olhar</b>' + it.olhe + '</div>' : "");

  par.innerHTML = modo === "piscar"
    ? '<div class="lado"><div class="selo a" id="seloPiscar"><i></i>piscando entre antes e depois</div>' +
      '<div class="lente a" style="position:relative">' +
      '<iframe title="antes"></iframe><div class="anel" hidden></div><div class="borda-tela" hidden><span></span></div>' +
      '<iframe title="depois" style="position:absolute;inset:0"></iframe>' +
      '</div><div class="aviso-lente">O mesmo pedaço da tela, no mesmo lugar, alternando a cada 0,9s. É assim que o olho acha diferença pequena.</div></div>'
    : lado("a", "antes") + lado("d", "depois");

  const lentes = [...par.querySelectorAll(".lente")];
  const frames = [...par.querySelectorAll("iframe")];
  for (const f of frames){ f.style.width = L + "px"; f.style.height = A + "px"; }
  for (const l of lentes){ l.style.width = BW + "px"; l.style.height = BH + "px"; }

  const [fa, fd] = modo === "piscar" ? [frames[0], frames[1]] : [frames[0], frames[1]];
  await Promise.all([
    carregar(fa, "antes", it.vista, it.tela),
    carregar(fd, "depois", it.vista, it.tela),
  ]);

  if (modo === "inteira"){
    const k = Math.min(1, BW / L, BH / A);
    for (const f of frames) f.style.transform = "scale(" + k + ")";
    for (const l of lentes){ l.style.width = Math.round(L*k) + "px"; l.style.height = Math.round(A*k) + "px"; }
    // Anel também na tela inteira: sem ele o dono não sabe onde olhar.
    marcar(fa, lentes[0], it, k, 0, 0, L);
    marcar(fd, lentes[1] || lentes[0], it, k, 0, 0, L);
    document.getElementById("rodape").textContent = "Tela inteira, nos dois estados. O anel marca o ponto que mudou.";
  } else {
    const ra = medirAlvo(fa, it.alvo);
    const rd = medirAlvo(fd, it.alvo, ra ? ra.rolagem : null);
    if (!ra || !rd){
      // Cai na tela inteira SÓ nesta comparação: mexer na variável de modo
      // fazia todas as seguintes abrirem sem lupa, sem ninguém ter pedido.
      falar("Não localizei o ponto nesta captura — mostrando a tela inteira.");
      const k = Math.min(1, BW / L, BH / A);
      for (const f of frames) f.style.transform = "scale(" + k + ")";
      for (const l of lentes){ l.style.width = Math.round(L*k) + "px"; l.style.height = Math.round(A*k) + "px"; }
      document.getElementById("rodape").textContent = "Ponto não localizado nesta captura — tela inteira, nos dois estados.";
      return;
    }
    // O recorte cobre os DOIS retângulos (eles mudam de lugar e de tamanho)
    // e, no celular, sempre começa na borda esquerda e vai além dos 390px —
    // sem isso a linha da borda da tela some da foto e o vazamento fica
    // invisível, que foi o defeito da primeira entrega.
    const cel = it.vista === "celular";
    const dirA = ra.left + ra.width, dirD = rd.left + rd.width;
    const x0 = cel ? 0 : Math.max(0, Math.min(ra.left, rd.left) - PAD);
    const x1 = cel ? Math.max(404, Math.max(dirA, dirD) + PAD) : Math.max(dirA, dirD) + PAD;
    const y0 = Math.max(0, Math.min(ra.top, rd.top) - PAD);
    const y1 = Math.max(ra.top + ra.height, rd.top + rd.height) + PAD;
    const necW = Math.max(x1 - x0, cel ? 424 : 520);
    const necH = Math.max(y1 - y0, 170);
    // Teto de 1.8×: zoom demais corta o contexto e o dono perde a referência.
    const k = Math.max(0.45, Math.min(1.8, Math.min(BW/necW, BH/necH)));
    aplicar(fa, lentes[0], ra, k, x0, y0, it, L);
    aplicar(fd, lentes[modo === "piscar" ? 0 : 1], rd, k, x0, y0, it, L, modo === "piscar");
    document.getElementById("rodape").textContent =
      "Zoom de " + k.toFixed(1) + "× no mesmo pedaço da tela, nos dois estados. " +
      (it.vista === "celular" ? "A linha tracejada é a borda do celular: o que passa dela o usuário só vê arrastando a página." : "");
  }

  const reg = document.getElementById("regua");
  if (it.medida){
    const r = it.medida;
    // Só fala de "limite" quando existe limite estourado: no conserto da
    // coluna de Movimentações o número CRESCER é o acerto, e a nota antiga
    // ("barra vermelha = o quanto passava") dizia o contrário do que mostra.
    const comLimite = r.antes > r.tela;
    const teto = Math.max(r.antes, r.depois, r.tela) * 1.06;
    reg.innerHTML = '<div class="regua"><h4>' + (r.rotulo || "largura do conteúdo · a tela do celular tem 390px") + '</h4>' +
      barra("antes", r.antes, r.tela, comLimite, teto, comLimite) +
      barra("depois", r.depois, r.tela, r.depois > r.tela, teto, comLimite) +
      '<small>' + (comLimite
        ? "A linha tracejada é a borda da tela. A barra vermelha é o quanto o conteúdo passava dela."
        : "Medido no navegador, nos dois estados. Aqui crescer é o acerto.") +
      '</small></div>';
  } else reg.innerHTML = "";

  if (modo === "piscar") piscar();
}

function marcar(frame, lente, it, k, tx, ty, L){
  const r = medirAlvo(frame, it.alvo);
  frame.style.transform = "scale(" + k + ")";
  const anel = lente.querySelector(".anel");
  if (!r || !anel) return;
  anel.hidden = false;
  anel.style.left = ((r.left - tx)*k - 3) + "px";
  anel.style.top = ((r.top - ty)*k - 3) + "px";
  anel.style.width = (r.width*k + 6) + "px";
  anel.style.height = (r.height*k + 6) + "px";
}

function aplicar(frame, lente, r, k, tx, ty, it, L, segundo){
  frame.style.transform = "scale(" + k + ") translate(" + (-tx) + "px," + (-ty) + "px)";
  const anel = segundo ? null : lente.querySelector(".anel");
  if (anel){
    anel.hidden = false;
    anel.style.left = ((r.left - tx)*k - 3) + "px";
    anel.style.top = ((r.top - ty)*k - 3) + "px";
    anel.style.width = (r.width*k + 6) + "px";
    anel.style.height = (r.height*k + 6) + "px";
  }
  if (it.vista === "celular" && !segundo){
    const borda = lente.querySelector(".borda-tela");
    const x = (390 - tx)*k;
    if (borda && x > 12 && x < lente.clientWidth - 2){
      borda.hidden = false;
      borda.style.left = x + "px";
      borda.querySelector("span").textContent = "borda da tela · 390px";
    }
  }
}

let timerPiscar;
function piscar(){
  clearInterval(timerPiscar);
  const fs = document.querySelectorAll("#par iframe");
  const selo = document.getElementById("seloPiscar");
  if (fs.length < 2) return;
  let mostrandoDepois = false;
  const troca = () => {
    mostrandoDepois = !mostrandoDepois;
    fs[1].style.opacity = mostrandoDepois ? "1" : "0";
    if (selo){
      selo.className = "selo " + (mostrandoDepois ? "d" : "a");
      selo.innerHTML = '<i></i>' + (mostrandoDepois ? "depois" : "antes");
    }
  };
  troca();
  timerPiscar = setInterval(troca, 900);
}

function irPara(i){ clearInterval(timerPiscar); idx = (i + ITENS.length) % ITENS.length; vendoPendentes = false; telaLivre = null; pintar(); }

document.querySelectorAll("[data-i]").forEach((b) => b.onclick = () => irPara(Number(b.dataset.i)));
document.querySelector("[data-pendentes]").onclick = () => { clearInterval(timerPiscar); vendoPendentes = true; telaLivre = null; pintar(); };
document.querySelectorAll("[data-tela]").forEach((b) => b.onclick = () => { clearInterval(timerPiscar); telaLivre = b.dataset.tela; vendoPendentes = false; pintar(); });
document.querySelectorAll("[data-modo]").forEach((b) => b.onclick = () => { clearInterval(timerPiscar); modo = b.dataset.modo; pintar(); });
document.getElementById("anterior").onclick = () => irPara(idx - 1);
document.getElementById("proximo").onclick = () => irPara(idx + 1);
addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") irPara(idx - 1);
  if (e.key === "ArrowRight") irPara(idx + 1);
});
pintar();
</script>
</body>
</html>
`;

writeFileSync(SAIDA, html);
console.log(`${SAIDA} — ${(html.length / 1024 / 1024).toFixed(2)} MB · ${ITENS.length} comparações`);
