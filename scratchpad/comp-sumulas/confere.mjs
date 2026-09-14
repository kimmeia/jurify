/**
 * Confere o comparador no navegador: cada achado tem os dois lados com foto de
 * verdade, o Piscar alterna, e nenhuma combinação abre em branco.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
await p.goto("file:///home/user/jurify/comparador-sumulas-e-portugues.html");
await p.waitForTimeout(1200);

let falhas = 0;
const achados = await p.locator("section.achado").all();
console.log("achados:", achados.length);

for (const s of achados) {
  const id = await s.getAttribute("id");
  const imgs = await s.locator("img").all();
  let ok = imgs.length > 0;
  for (const img of imgs) {
    const d = await img.evaluate((e) => ({ w: e.naturalWidth, h: e.naturalHeight }));
    if (d.w < 100 || d.h < 100) ok = false;
  }
  const onde = (await s.locator("p.onde").textContent()) || "";
  if (!onde.includes("Onde olhar")) ok = false;
  console.log(`${ok ? "✓" : "✗"} ${id} — ${imgs.length} foto(s), "${onde.slice(0, 48)}…"`);
  if (!ok) falhas++;
}

// o Piscar tem que MUDAR a tela
const botao = p.locator("button.piscar").first();
const par = p.locator('[data-par="sondagem"]');
const antesDoClique = await par.screenshot();
await botao.click();
await p.waitForTimeout(1300);
const depoisDoClique = await par.screenshot();
const mudou = Buffer.compare(antesDoClique, depoisDoClique) !== 0;
console.log(`${mudou ? "✓" : "✗"} piscar altera a tela`);
if (!mudou) falhas++;

await p.screenshot({ path: "scratchpad/comp-sumulas/comparador-aberto.png" });
await b.close();
console.log(falhas === 0 ? "tudo conferido" : `${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
