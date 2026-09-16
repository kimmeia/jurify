/** Dirige a página: nenhuma foto pode sair em branco, e o "ver como é hoje"
 *  tem que TROCAR a imagem (não só o rótulo). */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto("file:///home/user/jurify/tres-estruturas.html");
await p.waitForTimeout(2500);

const r = await p.evaluate(() => {
  const imgs = [...document.querySelectorAll(".moldura img")];
  return {
    secoes: document.querySelectorAll("section.direcao").length,
    fotos: imgs.length,
    vazias: imgs.filter((i) => !i.naturalWidth).length,
    semSrc: imgs.filter((i) => !i.src || i.src === location.href).length,
  };
});
console.log("direções:", r.secoes, "· fotos:", r.fotos, "· vazias:", r.vazias, "· sem src:", r.semSrc);

const troca = await p.evaluate(() => {
  const botao = document.querySelector(".ver-hoje");
  const img = botao.previousElementSibling.querySelector("img");
  const antes = img.src.slice(0, 120);
  botao.click();
  const depois = img.src.slice(0, 120);
  botao.click();
  const voltou = img.src.slice(0, 120);
  return { trocou: antes !== depois, voltou: antes === voltou };
});
console.log("botão troca a foto:", troca.trocou, "· volta:", troca.voltou);

await p.screenshot({ path: "/home/user/jurify/scratchpad/direcoes/pagina-topo.png" });
await p.evaluate(() => document.querySelector("#d-b-bancada").scrollIntoView());
await p.waitForTimeout(600);
await p.screenshot({ path: "/home/user/jurify/scratchpad/direcoes/pagina-meio.png" });
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(800);
console.log("rola de lado no celular:", await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1));
await b.close();
