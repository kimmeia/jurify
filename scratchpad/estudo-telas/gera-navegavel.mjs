/**
 * Monta o mockup NAVEGÁVEL a partir das telas serializadas do app rodando.
 *
 *   node gera-navegavel.mjs <ser-antes> <ser-depois> <fontes.css> <saida.html>
 *
 * O HTML de saída é auto-contido: fontes em base64, CSS do app embutido,
 * cada tela num iframe alimentado por srcdoc. Nada busca rede.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [ANTES, DEPOIS, FONTES_CSS, SAIDA] = process.argv.slice(2);

const TELAS = [
  ["dashboard", "Dashboard", "O resumo do dia: prazos, atendimentos, dinheiro e produção."],
  ["atendimento", "Atendimento", "A caixa de entrada do WhatsApp: conversas, atendente e robô."],
  ["clientes", "Clientes", "Cadastro, histórico, documentos e financeiro de cada cliente."],
  ["agenda", "Agenda", "Audiências, prazos e compromissos da equipe no dia."],
  ["processos", "Processos", "Os processos vigiados, o Cofre e as novas ações."],
  ["movimentacoes", "Movimentações", "O que andou nos processos, na ordem em que chegou."],
  ["kanban", "Kanban", "A produção das peças, coluna por coluna."],
  ["acordos", "Acordos", "Acordos fechados e as parcelas de cada um."],
  ["financeiro", "Financeiro", "Cobranças, recebimentos, despesas e o painel do mês."],
  ["relatorios", "Relatórios", "Comercial, produtividade e financeiro em números."],
  ["tarefas", "Tarefas", "A lista do que cada um tem para fazer."],
];

/** O que muda em cada tela. Texto para o dono, não para programador. */
const NOTAS = {
  dashboard: [
    ["A régua de abas estourava a tela no celular",
     "“Hoje · Semana · Mês · Trimestre” não cabia em 390px e empurrava a página inteira para o lado — o dedo arrastava o conteúdo junto. Agora a régua rola dentro dela mesma e a página fica parada."],
  ],
  agenda: [
    ["A etiqueta AGORA invadia a grade",
     "Ela media 103px num vão de 48px, então entrava por cima da coluna das horas e cobria o nome do compromisso. Virou duas linhas — AGORA em cima, o horário embaixo — e agora termina exatamente onde a grade começa."],
  ],
  processos: [
    ["Os botões do topo saíam pela borda",
     "Em tela estreita a fileira “Importar · Novo monitoramento · Atualizar” seguia em linha reta e passava da borda. Agora quebra para a linha de baixo."],
  ],
  movimentacoes: [
    ["O nome do cliente era cortado",
     "A coluna tinha 220px fixos e escrevia “Maria Aparecida Nogueir…”. Em notebook e monitor ela cresce até 380px e o nome inteiro cabe; no celular continua enxuta."],
  ],
  acordos: [
    ["Os três cartões de resumo ficavam lado a lado até no celular",
     "Com 110px cada, o número e o rótulo não caíam no mesmo lugar. Agora empilham no celular e voltam a três colunas a partir do notebook."],
  ],
  tarefas: [
    ["Os filtros empurravam a tela no celular",
     "“Todas · Pendente · Em andamento · Concluída” ficavam na mesma linha da busca e estouravam 47px para fora (437px de conteúdo num celular de 390px). Agora a busca fica numa linha e os filtros na seguinte, quebrando quando não cabem."],
    ["O aviso de atraso era desenhado em cima da data",
     "Na linha de apoio de cada tarefa lia-se “10/09/2026⚠” com o triângulo colado no número, porque os itens encolhiam abaixo do próprio texto. Agora eles quebram de linha em vez de se sobrepor."],
  ],
  financeiro: [
    ["O valor do KPI quebrava em duas linhas",
     "“R$ 10.700,00” não cabia na largura do cartão e descia meio valor para a linha de baixo. Agora o número fica inteiro numa linha só."],
    ["A legenda Asaas/manual era cortada",
     "A linha de baixo do cartão mostrava “As…” em vez de “Asaas”. Ganhou folga e os dois rótulos aparecem inteiros."],
    ["Dinheiro abreviado com ponto inglês",
     "O mesmo valor aparecia “R$ 10.700,00” no Dashboard e “R$ 10.7k” aqui — ponto decimal de inglês, num sistema brasileiro. Agora é o formato do país: “R$ 10,7 mil”."],
    ["A régua de abas e as tabelas empurravam a tela",
     "As abas agora rolam dentro da própria régua, e as duas tabelas rolam dentro da moldura delas — a página para de andar de lado."],
  ],
};


/** O que ficou de fora, e por quê. O dono decide cada um destes. */
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
<title>JuridFlow — o que eu mudei, nas telas de verdade</title>
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
const ROTA_TELA = { "/dashboard":"dashboard","/atendimento":"atendimento","/clientes":"clientes",
  "/agenda":"agenda","/processos":"processos","/movimentacoes":"movimentacoes","/kanban":"kanban",
  "/acordos":"acordos","/financeiro":"financeiro","/relatorios":"relatorios","/tarefas":"tarefas" };

let estado = "depois", vp = "desktop", tela = "dashboard", zoom = "fit";

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
