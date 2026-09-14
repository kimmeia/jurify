/**
 * Comparador ANTES | DEPOIS — súmulas na base e a sondagem em português.
 *
 * Este é de FOTO, não de DOM serializado: o que mudou aqui é o TEXTO de cada
 * linha, e a foto dos dois lados lado a lado no mesmo tamanho mostra isso
 * direto. As duas fotos saíram do app rodando (duas cópias do sistema, uma em
 * cada versão, ligadas no MESMO banco) com os MESMOS dados — que são os dados
 * que a sondagem mediu em produção, não inventados.
 *
 *   node gera-comparador.mjs <pasta-antes> <pasta-depois> <saida.html>
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [ANTES, DEPOIS, SAIDA] = process.argv.slice(2);

const b64 = (p) => (existsSync(p) ? readFileSync(p).toString("base64") : null);

const ACHADOS = [
  {
    id: "sondagem",
    arquivo: "sondagem.png",
    titulo: "O resultado da sondagem, dito em português",
    ondeOlhar:
      "Olhe a coluna do meio. Antes: 403, 404, —, ms. Agora: uma frase por linha, dizendo o que aconteceu e de quem é o conserto.",
    fatos: [
      "As linhas foram REORDENADAS: o que dá pra ligar hoje subiu pro topo (3 fontes), o que não tem jeito desceu.",
      "O resumo de quatro linhas em cima da tabela é novo — responde “e agora?” sem ler linha por linha.",
      "O número técnico continua na tela: virou a terceira linha de cada recado (200 · 612ms · HTML).",
      "“É o IP” virou “O tribunal barrou o nosso servidor, não o nosso pedido”.",
    ],
  },
  {
    id: "fontes",
    arquivo: "fontes.png",
    titulo: "A lista de fontes: súmulas entraram, e cada uma diz se dá pra ler daqui",
    ondeOlhar:
      "Olhe as quatro primeiras linhas — elas não existiam. E a segunda coluna de cada linha, que agora termina com a frase verde ou âmbar.",
    fatos: [
      "STJ · Súmulas, STF · Súmulas, STF · Súmulas vinculantes e LexML são fontes novas.",
      "A etiqueta SÚMULA (verde) separa o que é enunciado do que é ementa (azul) e do que é só número (cinza).",
      "TRF4 entrou na lista — a sondagem mostrou que ele responde do nosso servidor.",
      "TJCE está marcado como endereço errado: o e-SAJ que estava lá é de São Paulo.",
    ],
  },
  {
    id: "colar",
    arquivo: "colar.png",
    soDepois: true,
    titulo: "O caminho de encher a base hoje, sem depender do tribunal liberar",
    ondeOlhar:
      "Esta tela não existia. É o que resolve o STJ: ele publica todas as súmulas aberto e recusa o nosso servidor.",
    fatos: [
      "Abrir a lista oficial no SEU navegador, Ctrl+A, Ctrl+C e colar aqui.",
      "O sistema separa uma por uma pelo número — pelo MESMO leitor que o robô usa quando a porta está aberta.",
      "Súmula marcada como cancelada não entra, e ele avisa quantas ficaram de fora.",
      "Súmula muda poucas vezes por ano: colar uma vez resolve o ano.",
    ],
  },
];

const blocos = ACHADOS.map((a, i) => {
  const antes = a.soDepois ? null : b64(`${ANTES}/${a.arquivo}`);
  const depois = b64(`${DEPOIS}/${a.arquivo}`);
  if (!depois) return "";
  const lados = a.soDepois
    ? `<div class="lado so"><div class="rot">Não existia</div><div class="vazio">Não havia como pôr súmula na base.<br>Nem colando, nem pelo robô.</div></div>
       <div class="lado"><div class="rot dep">Depois</div><img src="data:image/png;base64,${depois}" alt="depois"></div>`
    : `<div class="lado"><div class="rot">Antes</div><img class="a" src="data:image/png;base64,${antes}" alt="antes"></div>
       <div class="lado"><div class="rot dep">Depois</div><img class="d" src="data:image/png;base64,${depois}" alt="depois"></div>`;

  const piscar = a.soDepois
    ? ""
    : `<button class="piscar" data-alvo="${a.id}">Piscar (sobrepõe os dois)</button>`;

  return `
  <section class="achado" id="${a.id}">
    <h2><span class="n">${i + 1}</span> ${a.titulo}</h2>
    <p class="onde"><b>Onde olhar:</b> ${a.ondeOlhar}</p>
    <ul class="fatos">${a.fatos.map((f) => `<li>${f}</li>`).join("")}</ul>
    ${piscar}
    <div class="par" data-par="${a.id}">${lados}</div>
  </section>`;
}).join("");

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Súmulas na base + a sondagem em português — antes e depois</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f6f7f9; color:#16181d;
    font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; }
  header { background:#07060f; color:#fff; padding:22px 20px; }
  header h1 { margin:0 0 6px; font-size:20px; }
  header p { margin:0; max-width:80ch; color:#c9c8d4; font-size:13px; }
  main { padding:18px 20px 60px; }
  .achado { background:#fff; border:1px solid #e3e5ea; border-radius:12px;
    padding:16px 16px 18px; margin-bottom:22px; }
  .achado h2 { margin:0 0 8px; font-size:16px; display:flex; gap:8px; align-items:center; }
  .n { display:inline-grid; place-items:center; width:22px; height:22px; border-radius:999px;
    background:#07060f; color:#fff; font-size:12px; }
  .onde { margin:0 0 8px; background:#fff8e6; border:1px solid #f0dfb0; border-radius:8px;
    padding:8px 10px; font-size:13px; }
  .fatos { margin:0 0 12px; padding-left:18px; font-size:13px; color:#3a3f4a; }
  .fatos li { margin:2px 0; }
  .par { display:grid; grid-template-columns:1fr 1fr; gap:12px; align-items:start; }
  .par.piscando { grid-template-columns:1fr; }
  .par.piscando .lado:first-child { display:none; }
  .lado { border:1px solid #e3e5ea; border-radius:10px; overflow:hidden; background:#fff; }
  .rot { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em;
    padding:6px 9px; background:#f1f2f5; color:#6b7280; }
  .rot.dep { background:#e8f3ec; color:#1d6b3f; }
  .lado img { display:block; width:100%; height:auto; }
  .vazio { padding:40px 16px; text-align:center; color:#9aa0aa; font-size:13px; }
  .piscar { margin:0 0 10px; border:1px solid #cfd3da; background:#fff; border-radius:8px;
    padding:6px 12px; font-size:12px; font-weight:700; cursor:pointer; }
  .piscar.on { background:#07060f; color:#fff; border-color:#07060f; }
  footer { padding:0 20px 40px; color:#6b7280; font-size:12px; max-width:90ch; }
  @media (max-width: 900px) { .par { grid-template-columns:1fr; } }
</style></head>
<body>
<header>
  <h1>Súmulas do STJ/STF na base — e a tela dizendo o que acontece em português</h1>
  <p>As duas fotos saíram do sistema RODANDO, uma versão de cada lado, ligadas no mesmo banco,
     com os mesmos dados: os que a sondagem mediu em produção. Nada aqui é desenho.</p>
</header>
<main>${blocos}</main>
<footer>
  <p><b>O que ainda não dá:</b> o STJ e o diário nacional recusam o endereço de internet do nosso
     servidor — por isso o caminho de colar. O STF trava em certificado, que é conserto do nosso lado.
     TJSP, TJMG e TRF4 respondem, mas ainda não foram ligados: quem confirma que a página de
     resultado traz ementa é a primeira coleta.</p>
</footer>
<script>
  for (const b of document.querySelectorAll(".piscar")) {
    let t = null;
    b.addEventListener("click", () => {
      const par = document.querySelector('[data-par="' + b.dataset.alvo + '"]');
      const ligado = b.classList.toggle("on");
      const a = par.querySelector("img.a"), d = par.querySelector("img.d");
      if (!ligado) { clearInterval(t); par.classList.remove("piscando"); a.style.display=""; d.style.display=""; return; }
      par.classList.add("piscando");
      let mostraDepois = true;
      d.style.display = "";
      t = setInterval(() => {
        mostraDepois = !mostraDepois;
        par.querySelector(".lado:first-child").style.display = mostraDepois ? "none" : "block";
        par.querySelector(".lado:last-child").style.display = mostraDepois ? "block" : "none";
      }, 900);
    });
  }
</script>
</body></html>`;

writeFileSync(SAIDA, html);
console.log("comparador em", SAIDA, "-", Math.round(html.length / 1024), "KB");
