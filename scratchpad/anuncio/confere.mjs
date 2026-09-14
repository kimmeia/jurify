import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await p.goto("file:///home/user/jurify/mockup-relatorio-anuncio.html");
await p.waitForTimeout(1200);
let falhas = 0;
for (const e of ["antes", "depois"]) {
  for (const t of ["pc", "cel"]) {
    await p.click(`#estado button[data-e="${e}"]`);
    await p.click(`#tamanho button[data-t="${t}"]`);
    await p.waitForTimeout(700);
    const d = await p.evaluate(() => {
      const i = document.getElementById("foto");
      return { w: i.naturalWidth, h: i.naturalHeight, src: i.src.slice(0, 30) };
    });
    const ok = d.w > 100 && d.h > 100;
    if (!ok) falhas++;
    console.log(`${e}/${t}: ${d.w}x${d.h} ${ok ? "OK" : "*** EM BRANCO ***"}`);
    await p.screenshot({ path: `/tmp/conf-${e}-${t}.png`, fullPage: false });
  }
}
console.log(falhas === 0 ? "TODAS AS 4 COMBINAÇÕES OK" : `${falhas} COMBINAÇÕES FALHARAM`);
await b.close();
