/**
 * Monta o mockup NAVEGÁVEL da fusão Base Jurídica + JurisIA.
 *
 * Cópia do `gera-navegavel.mjs` com as telas e os textos deste assunto —
 * o motor (iframe por srcdoc, chaves Antes/Depois e Computador/Celular) é
 * o mesmo, e é ele que garante que a marcação vem do app rodando.
 *
 *   node gera-navegavel.mjs <ser-antes> <ser-depois> <fontes.css> <saida.html>
 *
 * O HTML de saída é auto-contido: fontes em base64, CSS do app embutido,
 * cada tela num iframe alimentado por srcdoc. Nada busca rede.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [ANTES, DEPOIS, FONTES_CSS, SAIDA] = process.argv.slice(2);

const TELAS = [
  ["jurisia", "JurisIA · o advogado", "A pergunta e a resposta — é aqui que tudo isso vira peça."],
  ["admin-biblioteca", "Painel · Conhecimento jurídico", "De onde vem o material e o que cada tribunal decide."],
  ["admin-acervo", "Painel · o acervo por dentro", "O painel técnico de antes, agora dentro da tela nova."],
];

/** O que muda em cada tela. Texto para o dono, não para programador. */
const NOTAS = {
  jurisia: [
    ["A resposta passou a citar ementa — com link pro tribunal",
     "Antes ela sabia dizer como os processos terminam, mas não tinha uma linha de texto de decisão pra citar: o acervo de hoje (DataJud) traz classe, vara e movimento, e nenhuma ementa. Agora o bloco “O que os tribunais decidiram” traz o acórdão com órgão, data e o endereço oficial — é o que entra na petição, e é o que dá pra conferir antes de assinar."],
    ["A coluna da direita diz as TRÊS fontes, não uma",
     "Era um cartão só, “Acervo público”. Agora são três, na ordem em que valem: Jurisprudência (o que cita), Como costuma terminar (o número) e Seu escritório (os autos e o histórico da casa). O advogado enxerga de onde saiu cada metade da resposta."],
    ["O número continua sendo contado no banco",
     "O painel “Como este tribunal vem decidindo” não mudou de regra: ele é somado em SQL sobre o recorte inteiro e a IA é proibida de reescrevê-lo. O que mudou é que agora ele vem depois da ementa, com a frase que separa os dois — ementa fundamenta, estatística não."],
  ],
  "admin-biblioteca": [
    ["Duas abas viraram uma",
     "“Base Jurídica” e “JurisIA” eram telas separadas porque nasceram em datas diferentes — mas alimentam a MESMA resposta ao advogado. Separadas, ninguém via o buraco do meio: o acervo não tem texto de decisão e a biblioteca só cresce quando alguém sobe arquivo à mão. Agora é uma tela só, “Conhecimento jurídico”."],
    ["Fontes oficiais: o robô volta sozinho, e a tela diz o que cada uma traz",
     "Cada linha mostra se a fonte entrega EMENTA (o que se cita) ou SÓ NÚMERO (o que vira estatística), de quanto em quanto tempo o robô volta, quando foi a última coleta e se ela está em dia, coletando ou bloqueada. O DataJud aparece na lista marcado como “só número” — é a verdade, e é o que explica por que ele sozinho nunca fez jurisprudência."],
    ["Entendimentos por região",
     "Um cartão por tribunal com o que aquele tribunal vem decidindo — quantas decisões, quanto termina a favor, quantas são acórdão (citável). É o que você pediu: o entendimento regional, que é o que muda a peça, em vez de uma média nacional que não ajuda a escolher a tese."],
    ["Sondar antes de ligar uma fonte",
     "O botão bate uma vez em cada endereço e responde três coisas: se existe, se devolve dado estruturado e se vem ementa. Ele roda DO SERVIDOR de propósito — tribunal que bloqueia a faixa de IP do servidor responde normalmente do seu computador, e testar de casa daria um verde falso."],
  ],
  "admin-acervo": [
    ["O painel de antes continua inteiro — virou uma dobra",
     "A tabela dos 59 tribunais, a varredura, a amostra, o zerar e as ferramentas técnicas não saíram: estão em “Tribunais e varredura do DataJud”, no fim da tela nova, fechada por padrão. Nada foi removido; o que mudou é que o dia a dia não começa mais por ela."],
  ],
};


/** O que ficou de fora, e por quê. O dono decide cada um destes. */
const PENDENTES = [
  ["Ligar a coleta de ementa depende de uma sondagem que só você pode rodar",
   "O botão “Sondar” já existe em produção hoje (Painel → IA → JurisIA → ferramentas técnicas) e nunca foi rodado. Ele diz quais tribunais respondem DO NOSSO SERVIDOR e quais devolvem ementa. Os números de ementa desta tela são exemplo até essa sondagem rodar — o desenho está pronto, o volume real depende do que cada tribunal deixar."],
  ["Busca precisa pede índice de texto, não só semelhança",
   "Hoje a biblioteca carrega todas as fontes na memória e compara uma a uma. Serve pra algumas centenas de súmulas; com dezenas de milhares de ementas não fica de pé. O conserto é somar busca por texto (que o sistema já usa em outro módulo) à busca por significado — é o que faz a resposta achar o acórdão certo em vez do parecido."],
  ["Credencial de tribunal NÃO entra nesta tela, de propósito",
   "Credencial só abre o que é seu: ela dá os processos em que o escritório é advogado, e base de jurisprudência é feita de processo de terceiro. Fora isso, varrer o tribunal em volume com login de advogado arrisca o acesso da OAB de vocês. O acórdão publicado é aberto — é por essa porta que o robô entra. A credencial continua valendo pro que ela faz bem: os autos dos SEUS casos."],
  ["O nome da tela",
   "Chamei de “Conhecimento jurídico”. Se você preferir “Jurisprudência”, “Base de conhecimento” ou o nome do produto (“JurisIA”), é trocar uma palavra — só quis evitar que o painel continuasse dizendo dois nomes para a mesma coisa."],
  ["Cobrança não muda com a fusão",
   "Juntar as duas abas é organização de tela; o add-on continua sendo vendido igual, no mesmo lugar. Se a coleta de ementa crescer o custo (armazenamento e indexação), isso é conversa de preço — separada desta, e com número medido na mão."],
];

const SEM_MUDANCA = "Nada mudou nesta tela. Ela está aqui para você navegar como no dia a dia e conferir que nada quebrou no caminho.";

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

/**
 * JSON dentro de <script> precisa não conter "</" (o parser fecharia o
 * script ali) nem "<!--". `\/` é escape válido de JSON.
 */
const jsonSeguro = (o) =>
  JSON.stringify(o).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\u0021--");

const menu = TELAS.map(([id, rotulo, sub]) => {
  const n = NOTAS[id];
  const selo = n ? `<span class="pin">${n.length}</span>` : "";
  return `<button class="item" data-tela="${id}"><span class="rot">${rotulo}${selo}</span><span class="sub">${sub}</span></button>`;
}).join("\n") +
  `\n<div class="titulo" style="margin-top:14px">Fora da proposta</div>
   <button class="item" data-tela="__pendentes"><span class="rot">O que NÃO entrou <span class="pin" style="background:var(--tinta-2)">${PENDENTES.length}</span></span><span class="sub">Decisões que são suas, e o motivo de cada uma.</span></button>`;

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JuridFlow — Conhecimento jurídico: as duas telas viram uma</title>
<style>
${fontes}
:root{
  --tinta:#0f1b2d; --tinta-2:#4a5b70; --linha:#dde3ea; --fundo:#f1f4f8; --papel:#fff;
  --marinho:#194b86; --marinho-claro:#e8eef7; --verde:#097245; --ambar:#8a5a0b;
  --sombra:0 1px 2px rgba(15,27,45,.06),0 8px 24px rgba(15,27,45,.08);
}
*{box-sizing:border-box}
body{margin:0;background:var(--fundo);color:var(--tinta);
  font-family:Inter,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;
  -webkit-font-smoothing:antialiased}
header{position:sticky;top:0;z-index:20;background:var(--papel);border-bottom:1px solid var(--linha);
  padding:12px 20px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.marca{display:flex;align-items:center;gap:10px;min-width:0}
.marca .j{width:34px;height:34px;border-radius:9px;background:var(--marinho);color:#fff;
  font-family:Poppins,Inter,sans-serif;font-weight:800;font-size:19px;
  display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.marca b{font-size:15px;font-weight:700;letter-spacing:-.01em;display:block}
.marca small{color:var(--tinta-2);font-size:12px;display:block}
.chaves{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-left:auto}
.chave{display:inline-flex;background:var(--fundo);border:1px solid var(--linha);border-radius:9px;padding:3px;gap:2px}
.chave button{appearance:none;border:0;background:transparent;color:var(--tinta-2);font:inherit;
  font-weight:600;font-size:12.5px;padding:6px 13px;border-radius:7px;cursor:pointer;white-space:nowrap}
.chave button[aria-pressed=true]{background:var(--papel);color:var(--tinta);box-shadow:var(--sombra)}
.chave.estado button[aria-pressed=true][data-estado=antes]{background:#fdeceb;color:#8f1d16}
.chave.estado button[aria-pressed=true][data-estado=depois]{background:#e6f4ec;color:#0a5c39}
.rotulo{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--tinta-2)}
.corpo{display:grid;grid-template-columns:268px minmax(0,1fr);gap:0;align-items:start}
nav{border-right:1px solid var(--linha);background:var(--papel);min-height:calc(100vh - 60px);padding:14px 12px}
nav .titulo{padding:4px 10px 10px;font-size:11px;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;color:var(--tinta-2)}
.item{display:block;width:100%;text-align:left;appearance:none;border:0;background:transparent;
  padding:9px 11px;border-radius:9px;cursor:pointer;font:inherit;margin-bottom:2px}
.item:hover{background:var(--fundo)}
.item[aria-current=true]{background:var(--marinho-claro)}
.item[aria-current=true] .rot{color:var(--marinho)}
.rot{display:flex;align-items:center;gap:7px;font-weight:600;font-size:13.5px}
.sub{display:block;color:var(--tinta-2);font-size:11.5px;line-height:1.35;margin-top:2px}
.pin{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;
  padding:0 5px;border-radius:99px;background:var(--ambar);color:#fff;font-size:10.5px;font-weight:700}
main{padding:18px 20px 60px;min-width:0}
.cabeca{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:12px}
.cabeca h1{margin:0;font-size:23px;font-weight:700;letter-spacing:-.02em}
.cabeca p{margin:0;color:var(--tinta-2);font-size:13px}
.aviso{background:var(--papel);border:1px solid var(--linha);border-left:3px solid var(--ambar);
  border-radius:11px;padding:13px 15px;margin-bottom:14px;box-shadow:var(--sombra)}
.aviso.neutro{border-left-color:var(--linha)}
.aviso h2{margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--tinta-2)}
.aviso ol{margin:0;padding-left:20px}
.aviso li{margin-bottom:7px}
.aviso li:last-child{margin-bottom:0}
.aviso li b{font-weight:650}
.aviso li span{display:block;color:var(--tinta-2);font-size:13px}
.aviso p{margin:0;color:var(--tinta-2)}
.palco{background:var(--papel);border:1px solid var(--linha);border-radius:14px;padding:16px;
  box-shadow:var(--sombra);overflow:auto}
.moldura{position:relative;margin:0 auto;transition:width .15s,height .15s}
.moldura iframe{border:0;display:block;background:#fff;transform-origin:0 0}
.moldura.cel{padding:12px 10px 14px;border-radius:30px;background:#0f1b2d;width:max-content}
.moldura.cel .tela{border-radius:20px;overflow:hidden;background:#fff}
.moldura.cel .barrinha{height:4px;width:34%;margin:7px auto 0;border-radius:99px;background:#3b4a60}
.legenda[hidden]{display:none}
.legenda{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:10px;color:var(--tinta-2);font-size:12px}
.tag{display:inline-flex;align-items:center;gap:6px}
.tag i{width:9px;height:9px;border-radius:3px;display:inline-block}
.vazio{padding:60px 20px;text-align:center;color:var(--tinta-2)}
.pendentes{background:var(--papel);border:1px solid var(--linha);border-radius:14px;
  padding:6px 20px 18px;box-shadow:var(--sombra);max-width:860px}
.pendentes h3{font-size:14.5px;font-weight:650;margin:18px 0 4px}
.pendentes p{margin:0;color:var(--tinta-2)}
.pendentes code{background:var(--fundo);padding:1px 5px;border-radius:5px;font-size:12.5px}
.recado{position:fixed;left:50%;bottom:26px;transform:translate(-50%,14px);opacity:0;
  background:var(--tinta);color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;
  pointer-events:none;transition:.18s;z-index:40;max-width:86vw;text-align:center}
.recado.ver{opacity:1;transform:translate(-50%,0)}
@media (max-width:900px){
  .corpo{grid-template-columns:1fr}
  nav{border-right:0;border-bottom:1px solid var(--linha);min-height:0;
    display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px}
  nav .titulo{grid-column:1/-1}
  .sub{display:none}
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
      <small>as telas do sistema rodando, serializadas em 12/09/2026</small>
    </div>
  </div>
  <div class="chaves">
    <span class="rotulo">Versão</span>
    <div class="chave estado" id="chave-estado">
      <button data-estado="antes" aria-pressed="false">Antes</button>
      <button data-estado="depois" aria-pressed="true">Depois</button>
    </div>
    <span class="rotulo">Tela</span>
    <div class="chave" id="chave-vp">
      <button data-vp="desktop" aria-pressed="true">Computador</button>
      <button data-vp="celular" aria-pressed="false">Celular</button>
    </div>
    <span class="rotulo">Zoom</span>
    <div class="chave" id="chave-zoom">
      <button data-zoom="fit" aria-pressed="true">Cabe na tela</button>
      <button data-zoom="1" aria-pressed="false">Tamanho real</button>
    </div>
  </div>
</header>

<div class="corpo">
  <nav>
    <div class="titulo">Telas</div>
    ${menu}
  </nav>
  <main>
    <div class="cabeca">
      <h1 id="tituloTela">Dashboard</h1>
      <p id="subTela"></p>
    </div>
    <div id="notas"></div>
    <div class="pendentes" id="pendentes" hidden></div>
    <div class="palco" id="palco">
      <div class="moldura" id="moldura">
        <div class="tela"><iframe id="quadro" title="tela do JuridFlow"></iframe></div>
        <div class="barrinha" hidden></div>
      </div>
    </div>
    <div class="legenda">
      <span class="tag"><i style="background:var(--marinho)"></i> marcação e estilos vindos do app rodando — nada foi redesenhado à mão</span>
      <span class="tag"><i style="background:var(--ambar)"></i> o número ao lado do nome da tela é quantas mudanças ela tem</span>
    </div>
  </main>
</div>

<div class="recado" id="recado"></div>

<script type="application/json" id="dados">${jsonSeguro(dados)}</script>
<script type="application/json" id="notas-json">${jsonSeguro(NOTAS)}</script>
<script type="application/json" id="telas-json">${jsonSeguro(TELAS)}</script>
<script type="application/json" id="pendentes-json">${jsonSeguro(PENDENTES)}</script>
<script>
const D = JSON.parse(document.getElementById("dados").textContent);
const NOTAS = JSON.parse(document.getElementById("notas-json").textContent);
const TELAS = JSON.parse(document.getElementById("telas-json").textContent);

const SEM_MUDANCA = ${JSON.stringify(SEM_MUDANCA)};
const PENDENTES = JSON.parse(document.getElementById("pendentes-json").textContent);
const MEDIDA = { desktop:[1440,900], celular:[390,844] };
const ROTA_TELA = { "/jurisia":"jurisia", "/admin/ia":"admin-biblioteca" };

let estado = "depois", vp = "desktop", tela = "jurisia", zoom = "fit";

const quadro = document.getElementById("quadro");
const moldura = document.getElementById("moldura");
const recado = document.getElementById("recado");
let avisoTimer;
function falar(t){
  recado.textContent = t; recado.classList.add("ver");
  clearTimeout(avisoTimer); avisoTimer = setTimeout(()=>recado.classList.remove("ver"), 2600);
}

function pintarNotas(){
  const alvo = document.getElementById("notas");
  const n = NOTAS[tela];
  if (!n) { alvo.innerHTML = '<div class="aviso neutro"><p>' + SEM_MUDANCA + '</p></div>'; return; }
  alvo.innerHTML = '<div class="aviso"><h2>' + (n.length===1 ? "O que muda nesta tela" : "O que muda nesta tela (" + n.length + ")") + '</h2><ol>' +
    n.map(([t,d]) => '<li><b>' + t + '</b><span>' + d + '</span></li>').join("") + '</ol></div>';
}

function pintar(){
  if (tela === "__pendentes") return pintarPendentes();
  document.getElementById("pendentes").hidden = true;
  document.getElementById("palco").hidden = false;
  document.querySelector(".legenda").hidden = false;
  const [L,A] = MEDIDA[vp];
  const corpo = (D.telas[estado][vp]||{})[tela];
  document.querySelectorAll("[data-tela]").forEach(b => b.setAttribute("aria-current", String(b.dataset.tela===tela)));
  document.querySelectorAll("[data-estado]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.estado===estado)));
  document.querySelectorAll("[data-vp]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.vp===vp)));
  document.querySelectorAll("[data-zoom]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.zoom===zoom)));
  const meta = TELAS.find(t => t[0]===tela) || [tela,tela,""];
  document.getElementById("tituloTela").textContent = meta[1];
  document.getElementById("subTela").textContent = meta[2];
  pintarNotas();

  moldura.classList.toggle("cel", vp==="celular");
  moldura.querySelector(".barrinha").hidden = vp!=="celular";

  // "Cabe na tela" encolhe a foto até caber na largura disponível; o iframe
  // continua com a medida real, então as media queries do app não mudam.
  const folga = vp==="celular" ? 40 : 4;
  const disp = document.querySelector(".palco").clientWidth - 34 - folga;
  const k = zoom==="1" ? 1 : Math.min(1, disp / L);
  quadro.style.width = L + "px";
  quadro.style.height = A + "px";
  quadro.style.transform = "scale(" + k + ")";
  const tl = moldura.querySelector(".tela");
  tl.style.width = Math.round(L*k) + "px";
  tl.style.height = Math.round(A*k) + "px";
  if (vp!=="celular") { moldura.style.width = Math.round(L*k) + "px"; }
  else { moldura.style.width = ""; }

  if (!corpo) { quadro.srcdoc = '<body style="font:15px Inter,sans-serif;color:#4a5b70;padding:40px;text-align:center">Esta tela não foi capturada neste tamanho.</body>'; return; }
  quadro.srcdoc = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>' +
    D.css[estado] + '</style></head>' + corpo + '</html>';
}

function pintarPendentes(){
  document.querySelectorAll("[data-tela]").forEach(b => b.setAttribute("aria-current", String(b.dataset.tela===tela)));
  document.getElementById("tituloTela").textContent = "O que NÃO entrou nesta proposta";
  document.getElementById("subTela").textContent = "Cada item aqui é uma decisão sua — está escrito por que eu não mexi.";
  document.getElementById("notas").innerHTML = "";
  document.getElementById("palco").hidden = true;
  document.querySelector(".legenda").hidden = true;
  const alvo = document.getElementById("pendentes");
  alvo.hidden = false;
  // \x60 é a crase: escrita crua ela fecharia o template literal do gerador.
  const emCodigo = (txt) => txt.replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>");
  alvo.innerHTML = PENDENTES.map(([t,d]) => "<h3>" + t + "</h3><p>" + emCodigo(d) + "</p>").join("");
}

// O menu do PRÓPRIO app navega: clique num link vira troca de tela aqui.
quadro.addEventListener("load", () => {
  const doc = quadro.contentDocument;
  if (!doc) return;
  doc.addEventListener("click", (ev) => {
    const a = ev.target.closest && ev.target.closest("a[href]");
    ev.preventDefault();
    if (!a) return;
    const rota = (a.getAttribute("href")||"").split("?")[0].replace(/\\/$/, "");
    const destino = ROTA_TELA[rota];
    if (destino) { tela = destino; pintar(); }
    else falar("Esta tela não entrou no mockup — use o menu da esquerda.");
  }, true);
  doc.addEventListener("submit", (ev) => ev.preventDefault(), true);
});

document.querySelectorAll("[data-tela]").forEach(b => b.onclick = () => { tela = b.dataset.tela; pintar(); });
document.querySelectorAll("[data-estado]").forEach(b => b.onclick = () => { estado = b.dataset.estado; pintar(); });
document.querySelectorAll("[data-vp]").forEach(b => b.onclick = () => { vp = b.dataset.vp; pintar(); });
document.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => { zoom = b.dataset.zoom; pintar(); });
addEventListener("resize", () => { if (zoom==="fit") pintar(); });
addEventListener("keydown", (e) => {
  if (e.key==="a"||e.key==="A") { estado = estado==="antes" ? "depois" : "antes"; pintar(); }
  if (e.key==="c"||e.key==="C") { vp = vp==="celular" ? "desktop" : "celular"; pintar(); }
});
pintar();
</script>
</body>
</html>
`;

writeFileSync(SAIDA, html);
console.log(`${SAIDA} — ${(html.length / 1024 / 1024).toFixed(2)} MB`);
