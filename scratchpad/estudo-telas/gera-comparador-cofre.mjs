/**
 * Comparador do cartão do Cofre: antes | depois, computador ⟷ celular.
 *
 *   node gera-comparador-cofre.mjs <pastaFotos> <saida.html>
 *
 * Mesma regra dos outros comparadores: os dois lados ao MESMO tempo, no MESMO
 * recorte, com "Piscar" pra sobrepor — a chave antes/depois sozinha obriga a
 * guardar a tela anterior na memória, e foi assim que um navegável já foi
 * reprovado ("o antes e depois tá a mesma coisa").
 *
 * As fotos são do app RODANDO, com uma credencial nacional de 40 tribunais × 2
 * graus (78 combinações) — a mesma forma do print que o dono mandou.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [DIR_CARTAO, DIR_PAGINA, SAIDA] = process.argv.slice(2);
const img = (dir, n) => "data:image/jpeg;base64," + readFileSync(`${dir}/${n}.jpg`).toString("base64");
const cartao = (n) => img(DIR_CARTAO, n);
const pagina = (n) => img(DIR_PAGINA, n);

/**
 * Os dois lados são desenhados NA MESMA ESCALA: o cartão de antes tinha 370px
 * de largura e o de depois tem 1132px, então mostrar os dois com a mesma
 * largura na tela mentiria — o de antes pareceria maior do que é. A largura
 * de cada figura é proporcional à largura REAL medida no navegador.
 */
const TAMANHO = {
  comp: { antes: [370, 2566], depois: [1132, 612] },
  cel:  { antes: [366, 5069], depois: [366, 1831] },
};

const MEDIDAS = [
  ["Altura do CARTÃO, no computador", "2.566 px", "612 px", "4,2× menor"],
  ["Altura do CARTÃO, no celular", "5.069 px", "1.831 px", "2,8× menor"],
  ["Altura da página, no computador", "3.211 px", "1.257 px", "de 3,6 telas para 1,4"],
  ["Altura da página, no celular", "6.297 px", "3.059 px", "menos da metade"],
  ["Largura útil da grade de estados", "335 px", "1.098 px", "eram 800 px vazios ao lado"],
  ["Altura só da grade de estados", "2.143 px", "248 px", "mesma informação, 8× menor"],
  ["Colunas da grade no computador", "3 de 106 px", "6 de 186 px", "cabem sete fileiras"],
];

const MUDOU = [
  [
    "Cada estado era uma caixa com <b>duas caixas dentro</b>",
    "Uma caixa por grau, cada uma com rótulo, bolinha, texto e botão — 78 blocos empilhados. Agora cada estado é <b>uma linha só</b>: a sigla à esquerda e os dois graus como selos à direita, no mesmo eixo.",
  ],
  [
    "O cartão da credencial ocupava <b>um terço</b> da largura",
    "A grade dos 40 tribunais morava dentro de um cartão feito para caber três lado a lado. Agora a credencial nacional ocupa a <b>fileira inteira</b> — a de um tribunal só continua no cartão pequeno.",
  ],
  [
    "O erro do Keycloak era repetido <b>embaixo de cada estado</b>",
    "Um bloco vermelho por estado, com o mesmo texto do Keycloak. Agora é uma linha <b>“Por que N falharam”</b> que abre a lista — um parágrafo por estado, com o «detalhe técnico» de sempre dentro.",
  ],
  [
    "A contagem ficava <b>no rodapé</b>, depois de rolar tudo",
    "Validados, falharam e nunca usados agora ficam <b>ao lado do botão “Testar tudo”</b>: o estado da credencial se lê sem descer a página.",
  ],
  [
    "Testar um grau era um <b>ícone separado</b> na linha",
    "O selo do grau <b>é</b> o botão: clicar em «1º» testa aquele login. A setinha aparece ao passar o mouse, e o texto completo (validado · N processos) está no balão.",
  ],
];

const NADA_SAIU = [
  "os dois graus de cada estado, separados",
  "os três estados possíveis: validado, falhou, nunca usado",
  "a contagem de processos de quem está validado",
  "«2º sem endereço» para o grau sem portal mapeado",
  "o botão de testar um grau isolado",
  "o texto cru do erro, dentro de «detalhe técnico»",
  "o aviso de que “não testado” é honesto, não promessa",
  "«Testar tudo», a fila e a barra de progresso",
];

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cofre — o cartão das credenciais, antes e depois</title>
<style>
 :root{--tinta:#0f1b2d;--tinta2:#4a5b70;--tinta3:#7c8a9c;--linha:#dde3ea;--fundo:#eef2f7;
       --papel:#fff;--vermelho:#b4271f;--verde:#097245;
       --sombra:0 1px 2px rgba(15,27,45,.06),0 8px 24px rgba(15,27,45,.07)}
 *{box-sizing:border-box}
 body{margin:0;background:var(--fundo);color:var(--tinta);
   font:15px/1.62 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
 .folha{max-width:1320px;margin:0 auto;padding:28px 18px 90px}
 h1{font-size:27px;letter-spacing:-.022em;margin:0 0 6px;font-weight:700}
 .sub{color:var(--tinta2);margin:0 0 20px}
 h2{font-size:18px;margin:34px 0 10px;padding-top:16px;border-top:2px solid var(--linha);
    letter-spacing:-.015em;font-weight:680}
 p{margin:0 0 11px}
 .cx{background:var(--papel);border:1px solid var(--linha);border-radius:12px;padding:14px 17px;
     box-shadow:var(--sombra);margin:12px 0}
 .cx.mea{border-left:3px solid var(--vermelho)}
 .cx.ok{border-left:3px solid var(--verde)}
 .barra{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0 10px}
 .barra button{font:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:9px;
   border:1px solid var(--linha);background:var(--papel);color:var(--tinta2);cursor:pointer}
 .barra button[aria-pressed="true"]{background:var(--tinta);color:#fff;border-color:var(--tinta)}
 .barra .sep{width:1px;height:24px;background:var(--linha);margin:0 4px}
 .par{display:grid;grid-template-columns:1fr 1fr;gap:14px}
 @media (max-width:860px){.par{grid-template-columns:1fr}}
 figure{margin:0}
 figcaption{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
   color:var(--tinta3);margin:0 0 6px}
 figcaption .alt{font-weight:600;letter-spacing:0;text-transform:none;color:var(--tinta2)}
 .q{border:1px solid var(--linha);border-radius:12px;overflow:hidden;box-shadow:var(--sombra);
    background:var(--papel);position:relative}
 .q img{display:block;width:100%;height:auto}
 /* No celular a foto de "antes" tem 6.297px de altura: em tamanho real ela
    engole a página do comparador. Cada lado vira uma janela de 820px que rola
    por dentro — a altura verdadeira está escrita na legenda e na tabela. */
 .q{max-height:760px;overflow:auto}
 .q.natural{max-height:none;overflow:visible}
 .q.rolavel{max-height:620px;overflow:auto}
 .nota{font-size:13px;color:var(--tinta3);margin:0 0 8px}
 .pisca .q{position:relative}
 table{border-collapse:collapse;background:var(--papel);border:1px solid var(--linha);
       border-radius:12px;overflow:hidden;box-shadow:var(--sombra);width:100%;margin:10px 0 16px}
 th,td{padding:10px 13px;text-align:left;border-bottom:1px solid var(--linha);font-size:14px;
       vertical-align:top}
 th{background:#f6f8fb;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
    color:var(--tinta3)}
 tr:last-child td{border-bottom:0}
 td.a{color:var(--tinta2)} td.n{font-variant-numeric:tabular-nums;font-weight:700}
 td.antes{color:var(--vermelho)} td.depois{color:var(--verde)}
 ul{margin:0 0 10px;padding-left:20px} li{margin-bottom:6px;font-size:14px}
 .pilha{position:relative}
 .pilha img{display:block;width:100%}
 .pilha .topo{position:absolute;inset:0;opacity:0}
 .pilha.on .topo{animation:pisca 1.1s steps(1,end) infinite}
 @keyframes pisca{0%,49%{opacity:0}50%,100%{opacity:1}}
</style></head><body><div class="folha">

<h1>Cofre — o cartão das credenciais</h1>
<p class="sub">Você disse: <i>“esse card das credenciais está muito comprido, quero que redesenhe
para ficar mais bonito.”</i> As fotos abaixo são do sistema rodando, com uma credencial nacional
de <b>40 tribunais × 2 graus = 78 combinações</b> (o seu print mostrava 30; a conta depende de
quantos portais o sistema já conhece).</p>

<div class="cx mea"><b>O que eu medi antes de mexer:</b> a grade das 78 combinações tinha
<b>335 px de largura</b> dentro de um cartão de um terço da tela — com <b>800 px vazios</b> ao lado
— e <b>2.143 px de altura</b>. A página do Cofre pedia 3,6 telas de rolagem. Não era “feio”: era
uma grade espremida num cartão que foi feito pra caber três lado a lado.</div>

<div class="barra">
  <b style="font-size:13px">Ver em:</b>
  <button data-modo="comp" aria-pressed="true">Computador</button>
  <button data-modo="cel" aria-pressed="false">Celular</button>
  <span class="sep"></span>
  <button id="btn-pisca" aria-pressed="false">Piscar (sobrepõe os dois)</button>
</div>

<p class="nota">Os dois lados estão na <b>mesma escala</b>: o cartão de antes media 370 px de
largura e o de depois mede 1.132 px, então desenhá-los com a mesma largura mentiria.</p>

<div id="lado-a-lado" class="par">
  <figure>
    <figcaption>Antes <span class="alt" data-alt="antes"></span></figcaption>
    <div class="q" id="q-antes"><img id="im-antes" src="${cartao("antes-comp")}" alt="antes"></div>
  </figure>
  <figure>
    <figcaption>Depois <span class="alt" data-alt="depois"></span></figcaption>
    <div class="q" id="q-depois"><img id="im-depois" src="${cartao("depois-comp")}" alt="depois"></div>
  </figure>
</div>

<div id="sobreposto" class="par" hidden style="grid-template-columns:1fr">
  <figure>
    <figcaption>Piscando — antes ⟷ depois no mesmo lugar</figcaption>
    <div class="q pilha on" id="pilha">
      <img id="p-antes" src="${cartao("antes-comp")}" alt="antes">
      <img class="topo" id="p-depois" src="${cartao("depois-comp")}" alt="depois">
    </div>
  </figure>
</div>

<h2>O que foi medido no navegador</h2>
<table>
  <tr><th>medida</th><th>antes</th><th>depois</th><th>leitura</th></tr>
  ${MEDIDAS.map(([m, a, d, l]) =>
    `<tr><td class="a">${m}</td><td class="n antes">${a}</td><td class="n depois">${d}</td><td class="a">${l}</td></tr>`,
  ).join("\n  ")}
</table>

<h2>O que mudou de desenho</h2>
<table>
  <tr><th>antes</th><th>depois</th></tr>
  ${MUDOU.map(([a, d]) => `<tr><td class="a">${a}</td><td>${d}</td></tr>`).join("\n  ")}
</table>

<h2>Nada de informação saiu</h2>
<div class="cx ok">
<p>Continua tudo na tela — o que encolheu foi moldura repetida:</p>
<ul>${NADA_SAIU.map((x) => `<li>${x}</li>`).join("")}</ul>
</div>

<h2>A página inteira do Cofre, para contexto</h2>
<p class="nota">Mesma escala dos dois lados; role dentro do quadro.</p>
<div class="par">
  <figure><figcaption>Antes · 3.211 px</figcaption>
    <div class="q rolavel"><img src="${pagina("antes-comp")}" alt="página antes"></div></figure>
  <figure><figcaption>Depois · 1.257 px</figcaption>
    <div class="q rolavel"><img src="${pagina("depois-comp")}" alt="página depois"></div></figure>
</div>

<h2>Duas coisas ditas antes de você aprovar</h2>
<div class="cx">
<p><b>1. O “Por que N falharam” começa fechado.</b> Os seis blocos vermelhos com o mesmo texto do
Keycloak eram metade da altura da tela. O contador de falhas fica sempre à vista, em vermelho, ao
lado do “Testar tudo”; o motivo abre em um clique. Se você preferir que já abra aberto, é uma
palavra e eu mudo.</p>
<p><b>2. Achei um defeito antigo e NÃO mexi nele.</b> No celular a página do Cofre rola de lado
1 px: é a bolinha que pulsa no selo “Ativa” — ela cresce ao dobro e escapa do cartão. Já era assim
antes desta mudança. Consertar significa cortar o pulso ou trocar a animação, e isso muda uma coisa
que você não pediu; me diga se quer que eu conserte.</p>
</div>

<script>
 const FOTO = {
   comp: { antes: document.getElementById("im-antes").src, depois: document.getElementById("im-depois").src },
   cel: { antes: "${cartao("antes-cel")}", depois: "${cartao("depois-cel")}" },
 };
 const TAM = ${JSON.stringify(TAMANHO)};
 let modo = "comp";
 function pintar(){
   for (const id of ["im-antes","p-antes"]) document.getElementById(id).src = FOTO[modo].antes;
   for (const id of ["im-depois","p-depois"]) document.getElementById(id).src = FOTO[modo].depois;
   // Mesma escala: a largura de cada figura é proporcional à largura real.
   const maior = Math.max(TAM[modo].antes[0], TAM[modo].depois[0]);
   for (const lado of ["antes", "depois"]) {
     const pct = (TAM[modo][lado][0] / maior) * 100;
     const fig = document.getElementById("q-" + lado);
     fig.style.width = pct.toFixed(1) + "%";
     fig.style.marginRight = "auto";
   }
   const ALTURA = { comp: { antes: "2.566 px de altura · 370 px de largura", depois: "612 px de altura · 1.132 px de largura" },
                    cel:  { antes: "5.069 px — role dentro do quadro", depois: "1.831 px" } };
   for (const s of document.querySelectorAll(".alt")) s.textContent = "· " + ALTURA[modo][s.dataset.alt];
 }
 for (const b of document.querySelectorAll("[data-modo]")) {
   b.onclick = () => {
     modo = b.dataset.modo;
     for (const o of document.querySelectorAll("[data-modo]")) o.setAttribute("aria-pressed", String(o === b));
     pintar();
   };
 }
 const btn = document.getElementById("btn-pisca");
 btn.onclick = () => {
   const ligado = btn.getAttribute("aria-pressed") === "true";
   btn.setAttribute("aria-pressed", String(!ligado));
   document.getElementById("lado-a-lado").hidden = !ligado;
   document.getElementById("sobreposto").hidden = ligado;
 };
 pintar();
</script>
</div></body></html>`;

writeFileSync(SAIDA, html);
console.log(`${SAIDA} — ${(html.length / 1048576).toFixed(2)} MB`);
