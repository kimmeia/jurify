import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await (await b.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
await p.goto("file:///home/user/jurify/mockup-relatorio-anuncio.html");
await p.waitForTimeout(1500);
let falhas = 0;
for (const t of ["pc", "cel"]) for (const e of ["antes", "depois"]) {
  await p.click(`#tamanho button[data-t="${t}"]`);
  await p.click(`#estado button[data-e="${e}"]`);
  await p.waitForTimeout(800);
  const d = await p.evaluate(() => {
    const f = document.getElementById("foco"), c = document.getElementById("ctx");
    return { fw: f.naturalWidth, fh: f.naturalHeight, cw: c.naturalWidth, ch: c.naturalHeight };
  });
  const ok = d.fw > 100 && d.fh > 100 && d.cw > 100 && d.ch > 100;
  if (!ok) falhas++;
  console.log(`${t}/${e}: foco ${d.fw}x${d.fh} · contexto ${d.cw}x${d.ch} ${ok ? "OK" : "*** BRANCO ***"}`);
  await p.screenshot({ path: `/tmp/v2-${t}-${e}.png` });
}
console.log(falhas === 0 ? "4/4 COMBINAÇÕES OK" : `${falhas} FALHARAM`);
await b.close();
