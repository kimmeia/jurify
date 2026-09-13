/**
 * Navegável: troca de tela pelo menu, chave Antes ⟷ Depois e Computador ⟷
 * Celular, tudo num HTML auto-contido.
 *
 *   node gera-navegavel-novo.mjs <pastaAntes> <saida.html>
 *
 * O "antes" é CAPTURA do app rodando (computador e celular). O "depois" é
 * marcação viva dentro do palco — por isso o celular responde de verdade
 * (container query), em vez de ser uma foto encolhida.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CSS, TELAS } from "./nav-telas.mjs";

const [ANTES, SAIDA] = process.argv.slice(2);
const img = (n) => "data:image/jpeg;base64," + readFileSync(`${ANTES}/${n}.jpg`).toString("base64");

const painelAntes = (t) => `
  <div class="palco-conteudo" data-lado="antes" data-tela="${t.id}" hidden>
    <img class="foto comp" src="${img(`${t.id}-antes-comp`)}" alt="${t.nome} hoje, no computador">
    <img class="foto cel" src="${img(`${t.id}-antes-celular`)}" alt="${t.nome} hoje, no celular">
  </div>`;

const painelDepois = (t) => `
  <div class="palco-conteudo" data-lado="depois" data-tela="${t.id}" hidden>${t.html}</div>`;

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JuridFlow — navegável</title>
<style>
 :root{--tinta:#0f1b2d;--tinta2:#4a5b70;--tinta3:#7c8a9c;--linha:#dde3ea;--fundo:#e7ecf3;--papel:#fff;
       --marca:#6d4bd8;--sombra:0 1px 2px rgba(15,27,45,.06),0 10px 30px rgba(15,27,45,.10)}
 *{box-sizing:border-box;margin:0;padding:0}
 body{background:var(--fundo);color:var(--tinta);
      font:14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;
      height:100vh;display:flex;flex-direction:column;overflow:hidden}

 header{display:flex;align-items:center;gap:16px;padding:12px 20px;background:var(--papel);
        border-bottom:1px solid var(--linha);flex-wrap:wrap}
 header h1{font-size:15px;font-weight:700;letter-spacing:-.015em}
 header .leg{font-size:12.5px;color:var(--tinta3)}
 .chaves{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
 .chave{display:flex;background:#eef2f7;border:1px solid var(--linha);border-radius:9px;padding:2px}
 .chave button{border:0;background:transparent;font:inherit;font-size:12.5px;padding:5px 13px;
               border-radius:7px;color:var(--tinta2);cursor:pointer}
 .chave button.on{background:var(--papel);color:var(--tinta);font-weight:650;
                  box-shadow:0 1px 2px rgba(15,27,45,.12)}

 main{flex:1;min-height:0;display:flex}
 nav.telas{width:184px;flex:none;background:var(--papel);border-right:1px solid var(--linha);
           padding:14px 0}
 nav.telas p{padding:0 16px 8px;font-size:10px;font-weight:700;letter-spacing:.13em;
             text-transform:uppercase;color:var(--tinta3)}
 nav.telas button{display:block;width:100%;text-align:left;border:0;background:transparent;font:inherit;
                  padding:8px 16px;color:var(--tinta2);cursor:pointer;font-size:13.5px}
 nav.telas button.on{color:var(--tinta);font-weight:650;background:#f1eefc;
                     box-shadow:inset 3px 0 0 var(--marca)}
 nav.telas .nota{padding:14px 16px 0;margin-top:10px;border-top:1px solid var(--linha);
                 font-size:11.5px;color:var(--tinta3);line-height:1.45}

 .palco-area{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;
       justify-content:flex-start;padding:18px;overflow:auto}
 .moldura{background:var(--papel);border:1px solid var(--linha);border-radius:14px;box-shadow:var(--sombra);
          overflow:hidden;position:relative}
 .palco{position:relative;transform-origin:top left}
 .palco-conteudo{width:100%}
 .palco-conteudo[hidden]{display:none}
 .foto{display:block;width:100%;height:auto}
 body[data-modo="comp"] .foto.cel{display:none}
 body[data-modo="cel"] .foto.comp{display:none}
 .rodape{padding:10px 2px 0;font-size:12px;color:var(--tinta3);max-width:900px;text-align:center}

 ${CSS}
</style></head>
<body data-lado="depois" data-modo="comp" data-tela="hoje">

<header>
  <h1>JuridFlow — proposta navegável</h1>
  <span class="leg">o "antes" é foto do app rodando · o "depois" é tela viva, que responde ao tamanho</span>
  <div class="chaves">
    <div class="chave" id="ch-lado">
      <button data-lado="antes">Antes</button><button data-lado="depois" class="on">Depois</button>
    </div>
    <div class="chave" id="ch-modo">
      <button data-modo="comp" class="on">Computador</button><button data-modo="cel">Celular</button>
    </div>
  </div>
</header>

<main>
  <nav class="telas">
    <p>Telas</p>
    ${TELAS.map((t, i) => `<button data-tela="${t.id}"${i === 0 ? ' class="on"' : ""}>${t.nome}</button>`).join("\n    ")}
    <div class="nota">Troque de tela, de lado e de tamanho. No celular o "depois" recoloca os blocos —
      o que pede resposta sobe para cima do resto do dia.</div>
  </nav>

  <div class="palco-area">
    <div class="moldura" id="moldura">
      <div class="palco" id="palco">
        ${TELAS.map(painelAntes).join("\n")}
        ${TELAS.map(painelDepois).join("\n")}
      </div>
    </div>
    <p class="rodape" id="rodape"></p>
  </div>
</main>

<script>
(function(){
  var LARG = { comp: 1440, cel: 390 };
  var ALT  = { comp: 980,  cel: 844 };
  var palco = document.getElementById("palco");
  var moldura = document.getElementById("moldura");
  var rodape = document.getElementById("rodape");
  var NOTAS = {
    hoje: "Hoje: painéis elevados, cartões de número com minigráfico, prazos como barra de contagem e um mapa de calor de quando o tribunal se mexe.",
    atendimento: "Atendimento: fila por tempo de espera com a fala do cliente inteira e o motivo ao lado — hoje a fala vem cortada em uma linha.",
    financeiro: "Financeiro: gráfico de entradas, quem deve com há quantos dias, e a tabela com avatar e situação em pílula."
  };

  function mostra(){
    var lado = document.body.dataset.lado, tela = document.body.dataset.tela;
    var achou = false;
    palco.querySelectorAll(".palco-conteudo").forEach(function(el){
      var on = el.dataset.lado === lado && el.dataset.tela === tela;
      el.hidden = !on;
      if (on) achou = true;
    });
    rodape.textContent = NOTAS[tela] || "";
    ajusta();
    return achou;
  }

  function ajusta(){
    var modo = document.body.dataset.modo;
    var w = LARG[modo], h = ALT[modo];
    palco.style.width = w + "px";
    palco.style.height = h + "px";
    var disp = moldura.parentElement.clientWidth - 36;
    var dispH = moldura.parentElement.clientHeight - 70;
    var k = Math.min(1, disp / w, dispH / h);
    palco.style.transform = "scale(" + k + ")";
    moldura.style.width = Math.round(w * k) + "px";
    moldura.style.height = Math.round(h * k) + "px";
  }

  document.getElementById("ch-lado").addEventListener("click", function(e){
    if (!e.target.dataset.lado) return;
    document.body.dataset.lado = e.target.dataset.lado;
    this.querySelectorAll("button").forEach(function(b){ b.classList.toggle("on", b === e.target); });
    mostra();
  });
  document.getElementById("ch-modo").addEventListener("click", function(e){
    if (!e.target.dataset.modo) return;
    document.body.dataset.modo = e.target.dataset.modo;
    this.querySelectorAll("button").forEach(function(b){ b.classList.toggle("on", b === e.target); });
    mostra();
  });
  document.querySelector("nav.telas").addEventListener("click", function(e){
    if (!e.target.dataset.tela) return;
    document.body.dataset.tela = e.target.dataset.tela;
    this.querySelectorAll("button").forEach(function(b){ b.classList.toggle("on", b === e.target); });
    mostra();
  });
  window.addEventListener("resize", ajusta);
  mostra();
})();
</script>
</body></html>`;

writeFileSync(SAIDA, html);
console.log(`${SAIDA} — ${(html.length / 1048576).toFixed(2)} MB`);
