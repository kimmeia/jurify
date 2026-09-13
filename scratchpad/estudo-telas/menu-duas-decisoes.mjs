/**
 * As DUAS cores de menu que você aprovou em 13/09, lado a lado, no app rodando.
 *
 * Por que existe: duas sessões receberam pedidos diferentes sobre o mesmo
 * token no mesmo dia. Uma entregou o roxo da LOGO (está no ar); a outra, o
 * `#07060f` do header do Devular (não subiu). Nenhum mockup comparou as duas
 * entre si — o desta sessão fotografou o "hoje" ainda no azul-ardósia antigo.
 *
 *   node menu-duas-decisoes.mjs <sessao.json> <pasta> <saida.html>
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [SESSAO, PASTA, SAIDA] = process.argv.slice(2);

const OPCOES = [
  {
    id: "logo",
    css: "",
    rotulo: "No ar hoje · a cor da LOGO",
    pedido: "«Vamos deixar a cor desse menu mais alinhado com a logo real?»",
    nota:
      "Roxo-quase-preto, do mesmo matiz do violeta da marca. «Jurid» em branco puro, " +
      "«Flow» e o item aberto em violeta. Foi mergeada em develop e main hoje de tarde.",
  },
  {
    id: "devular",
    css: ":root, .dark { --sidebar: #07060f; }",
    rotulo: "A que você me pediu · a cor do header do Devular",
    pedido: "«vamos usar essa cor do header ... para o menu de juridflow e também para o menu de devular»",
    nota:
      "Quase-preto neutro (azulado), o mesmo valor do header do Devular. Junto do violeta " +
      "da marca ele fica mais frio: o menu deixa de puxar pro tom da logo e vira preto.",
  },
];

mkdirSync(PASTA, { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const medidos = {};

for (const op of OPCOES) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: SESSAO, deviceScaleFactor: 2 });
  await ctx.addInitScript(([extra]) => {
    const por = () => {
      const st = document.createElement("style");
      st.textContent = ".bg-warning.text-center.select-none{display:none !important}" + extra;
      document.head && document.head.appendChild(st);
    };
    if (document.head) por(); else addEventListener("DOMContentLoaded", por);
  }, [op.css]);

  const p = await ctx.newPage();
  await p.goto("http://localhost:3000/dashboard", { waitUntil: "domcontentloaded", timeout: 40000 });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `${PASTA}/menu-${op.id}.png`, clip: { x: 0, y: 0, width: 300, height: 760 } });
  await p.screenshot({ path: `${PASTA}/tela-${op.id}.png` });

  // Cor REAL do pixel: `getComputedStyle().color` hoje devolve oklch(...) como
  // texto, então a conversão tem que passar pelo canvas.
  medidos[op.id] = await p.evaluate(() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--sidebar").trim();
    cx.fillRect(0, 0, 1, 1);
    const [r, g, bl] = cx.getImageData(0, 0, 1, 1).data;
    return "#" + [r, g, bl].map((n) => n.toString(16).padStart(2, "0")).join("");
  });
  console.log(`${op.id.padEnd(10)} menu renderiza ${medidos[op.id]}`);
  await ctx.close();
}
await b.close();

const b64 = (arq) => "data:image/png;base64," + readFileSync(`${PASTA}/${arq}`).toString("base64");

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>As duas cores de menu — qual fica?</title>
<style>
 :root{--tinta:#0f1b2d;--tinta2:#4a5b70;--tinta3:#7c8a9c;--linha:#dde3ea;--fundo:#eef2f7;--papel:#fff;
       --sombra:0 1px 2px rgba(15,27,45,.06),0 8px 24px rgba(15,27,45,.07)}
 *{box-sizing:border-box}
 body{margin:0;background:var(--fundo);color:var(--tinta);
      font:15px/1.6 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
 .folha{max-width:1100px;margin:0 auto;padding:30px 20px 70px}
 h1{font-size:26px;letter-spacing:-.02em;margin:0 0 4px}
 .sub{color:var(--tinta2);margin:0 0 24px}
 .aviso{background:var(--papel);border:1px solid var(--linha);border-left:3px solid #8a5a0b;
        border-radius:11px;padding:14px 17px;box-shadow:var(--sombra);margin:0 0 22px}
 .par{display:flex;gap:18px;flex-wrap:wrap}
 .op{flex:1 1 330px;min-width:0;background:var(--papel);border:1px solid var(--linha);
     border-radius:14px;padding:15px;box-shadow:var(--sombra)}
 .op h2{font-size:16px;margin:0 0 2px}
 .op .pedido{font-size:13px;color:var(--tinta2);font-style:italic;margin:0 0 10px}
 .op img{display:block;width:100%;height:auto;border-radius:10px;border:1px solid var(--linha)}
 .op p{font-size:13px;color:var(--tinta2);margin:10px 0 0}
 .hex{display:inline-flex;align-items:center;gap:7px;font-size:13px;margin:0 0 10px}
 .chip{width:17px;height:17px;border-radius:5px;border:1px solid rgba(15,27,45,.2)}
 code{background:#e9eef4;padding:1px 6px;border-radius:5px;font-size:12.5px}
 h3{font-size:15px;margin:30px 0 8px}
 ul{margin:0;padding-left:20px}li{margin-bottom:6px;font-size:14px}
</style></head><body><div class="folha">

<h1>As duas cores de menu que você aprovou hoje</h1>
<p class="sub">Fotografadas agora, no app rodando, na mesma tela e no mesmo tamanho — 13/09/2026.</p>

<div class="aviso">
  <b>O que aconteceu:</b> duas conversas suas, no mesmo dia, pediram coisas diferentes para o mesmo
  menu — e eu aprovei e entreguei as duas em sessões separadas, sem uma saber da outra. A da tarde
  (cor da logo) <b>está no ar</b>. A que você me pediu aqui (cor do Devular) <b>eu segurei</b>, porque
  o mockup que você aprovou comparava contra o menu AZUL antigo, que já não existia mais — ou seja,
  você nunca viu estas duas juntas. É o que está abaixo. <b>Me diz qual fica.</b>
</div>

<div class="par">
${OPCOES.map((op) => `
  <div class="op">
    <h2>${op.rotulo}</h2>
    <p class="pedido">${op.pedido}</p>
    <div class="hex"><span class="chip" style="background:${medidos[op.id]}"></span>
      <code>${medidos[op.id]}</code></div>
    <img src="${b64(`menu-${op.id}.png`)}" alt="menu ${op.id}">
    <p>${op.nota}</p>
  </div>`).join("")}
</div>

<h3>O que eu recomendo, e por quê</h3>
<ul>
  <li><b>JuridFlow fica com o roxo da logo</b> (o que está no ar). O menu é onde a marca aparece:
      com o quase-preto neutro, o «Flow» violeta ao lado passa a parecer de outra marca — que é
      exatamente o problema que a mudança da tarde consertou.</li>
  <li><b>Devular fica com o <code>#07060f</code></b>, que é a cor da marca DELE. Cada produto veste a
      própria logo; de longe os dois continuam sendo "menu escuro", que é a leitura de irmandade que
      você queria.</li>
  <li>Se você preferir a mesma cor literal nos dois, é uma linha — o código já está pronto no commit
      <code>48e8236</code>, com o teste que trava a cor.</li>
</ul>

<h3>Tela inteira, para conferir o contraste do conteúdo</h3>
<div class="par">
${OPCOES.map((op) => `<div class="op"><h2>${op.rotulo}</h2>
  <img src="${b64(`tela-${op.id}.png`)}" alt="tela ${op.id}"></div>`).join("")}
</div>

</div></body></html>`;

writeFileSync(SAIDA, html);
console.log(`${SAIDA} — ${(html.length / 1024 / 1024).toFixed(2)} MB`);
