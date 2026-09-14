/**
 * Comparador do cabeçalho dos painéis: antes | depois, computador ⟷ celular.
 *
 *   node gera-comparador-dashboard.mjs <pastaFotos> <saida.html>
 *
 * As duas mudanças do pedido de 13/09: os cartões de ação saem do topo dos
 * painéis Comercial, Operacional e Financeiro, e a busca sobe pra linha das
 * quatro abas, na ponta direita.
 *
 * Fotos do app rodando, MESMA aba (Financeiro) e MESMO recorte dos dois lados
 * — é o que permite comparar sem guardar a tela anterior na memória.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [DIR, SAIDA] = process.argv.slice(2);
const img = (n) => "data:image/jpeg;base64," + readFileSync(`${DIR}/${n}.jpg`).toString("base64");

const MUDOU = [
  [
    "Dois cartões de ação ocupavam a primeira dobra",
    "<b>Saíram.</b> No Financeiro eram “N clientes com cobrança vencida” e “N cobranças vencidas no período”; no Comercial e no Operacional, os equivalentes. O painel abre direto no bloco principal.",
  ],
  [
    "A busca ficava dentro do painel, ao lado do título",
    "<b>Subiu pra linha das abas</b>, encostada na ponta direita — o mesmo lugar em qualquer uma das quatro.",
  ],
  [
    "A linha cinza terminava onde as abas terminavam",
    "<b>Agora ela atravessa a fileira inteira</b>, por baixo das abas e da busca. Foi você que apontou isso da outra vez.",
  ],
  [
    "No celular a busca ficava espremida ao lado do título",
    "<b>Ela ocupa a linha inteira</b> e cai abaixo das abas, em vez de espremer “Geral · Comercial · Operacional · Financeiro” em 190px.",
  ],
];

const NAO_SUMIU = [
  ["clientes com cobrança vencida", "Financeiro → aba Clientes, filtro “inadimplentes”; e “Vencido no período”, em dinheiro, segue no bloco principal logo abaixo"],
  ["cobranças vencidas no período", "a mesma tela do Financeiro"],
  ["abaixo da meta / sem meta (Comercial)", "o ranking do próprio painel e Configurações → Equipe"],
  ["contratos fechados sem pagamento", "Financeiro"],
  ["tarefas e compromissos atrasados (Operacional)", "Tarefas e Agenda, que já mostram o atraso na lista"],
];

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painéis — cartões do topo fora, busca na linha das abas</title>
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
 .q{border:1px solid var(--linha);border-radius:12px;overflow:hidden;box-shadow:var(--sombra);
    background:var(--papel)}
 .q img{display:block;width:100%;height:auto}
 .q.cel{max-width:400px;margin:0 auto}
 table{border-collapse:collapse;background:var(--papel);border:1px solid var(--linha);
       border-radius:12px;overflow:hidden;box-shadow:var(--sombra);width:100%;margin:10px 0 16px}
 th,td{padding:10px 13px;text-align:left;border-bottom:1px solid var(--linha);font-size:14px;
       vertical-align:top}
 th{background:#f6f8fb;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
    color:var(--tinta3)}
 tr:last-child td{border-bottom:0}
 td.a{color:var(--tinta2);width:42%}
 .pilha{position:relative} .pilha img{display:block;width:100%}
 .pilha .topo{position:absolute;inset:0;opacity:0}
 .pilha.on .topo{animation:pisca 1.1s steps(1,end) infinite}
 @keyframes pisca{0%,49%{opacity:0}50%,100%{opacity:1}}
</style></head><body><div class="folha">

<h1>Painéis — cartões do topo fora, busca na linha das abas</h1>
<p class="sub">Você pediu: <i>“vamos remover esses cards superiores dos dashboards comercial,
operacional e financeiro. Opção de buscar vamos alinhar junto do menu com as quatro opções na
extremidade da direita.”</i> Fotos do sistema rodando, na aba <b>Financeiro</b> dos dois lados.</p>

<div class="barra">
  <b style="font-size:13px">Ver em:</b>
  <button data-modo="comp" aria-pressed="true">Computador</button>
  <button data-modo="cel" aria-pressed="false">Celular</button>
  <span class="sep"></span>
  <button id="btn-pisca" aria-pressed="false">Piscar (sobrepõe os dois)</button>
</div>

<div id="lado-a-lado" class="par">
  <figure>
    <figcaption>Antes</figcaption>
    <div class="q" id="q-antes"><img id="im-antes" src="${img("antes-comp")}" alt="antes"></div>
  </figure>
  <figure>
    <figcaption>Depois</figcaption>
    <div class="q" id="q-depois"><img id="im-depois" src="${img("depois-comp")}" alt="depois"></div>
  </figure>
</div>

<div id="sobreposto" class="par" hidden style="grid-template-columns:1fr">
  <figure>
    <figcaption>Piscando — antes ⟷ depois no mesmo lugar</figcaption>
    <div class="q pilha on" id="pilha">
      <img id="p-antes" src="${img("antes-comp")}" alt="antes">
      <img class="topo" id="p-depois" src="${img("depois-comp")}" alt="depois">
    </div>
  </figure>
</div>

<h2>O que mudou</h2>
<table>
  <tr><th>antes</th><th>depois</th></tr>
  ${MUDOU.map(([a, d]) => `<tr><td class="a">${a}</td><td>${d}</td></tr>`).join("\n  ")}
</table>

<h2>Para onde foi cada número que saiu do topo</h2>
<div class="cx ok">
<p>Nenhum dado foi apagado — os cartões eram atalhos para telas que continuam lá:</p>
<table style="margin-top:8px">
  <tr><th>o cartão dizia</th><th>onde o número está agora</th></tr>
  ${NAO_SUMIU.map(([a, d]) => `<tr><td class="a">${a}</td><td>${d}</td></tr>`).join("\n  ")}
</table>
</div>

<h2>Dito antes de você aprovar</h2>
<div class="cx">
<p><b>O que os cartões faziam de útil</b> era avisar sem você procurar: “tem 341 cliente vencido”
aparecia mesmo que você não abrisse o Financeiro. Sem eles, o aviso só existe dentro de cada tela.
Se sentir falta, o caminho que eu recomendo não é trazer os cartões de volta — é o sino de
notificações, que já existe e é o lugar certo pra “alguém precisa de você”.</p>
<p><b>Os componentes continuam no código</b>, sem ninguém usando. Apagar de vez eu não fiz porque
você não pediu; é uma linha quando mandar.</p>
<p><b>Um defeito antigo que eu NÃO mexi:</b> no celular o painel Financeiro rola 8px de lado.
Medi nas duas versões — 398px antes e 398px depois —, então não veio daqui. É do bloco do gráfico.
Conserto quando você mandar.</p>
</div>

<script>
 const FOTO = {
   comp: { antes: document.getElementById("im-antes").src, depois: document.getElementById("im-depois").src },
   cel: { antes: "${img("antes-cel")}", depois: "${img("depois-cel")}" },
 };
 let modo = "comp";
 function pintar(){
   for (const id of ["im-antes","p-antes"]) document.getElementById(id).src = FOTO[modo].antes;
   for (const id of ["im-depois","p-depois"]) document.getElementById(id).src = FOTO[modo].depois;
   for (const q of document.querySelectorAll(".q")) q.classList.toggle("cel", modo === "cel");
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
