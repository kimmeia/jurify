/** Fotografa os três protótipos de ESTRUTURA, computador e celular. */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const raiz = "/home/user/jurify/scratchpad/estrutura";
for (const nome of ["a-pauta", "b-bancada", "c-boletim"]) {
  for (const [rot, vp] of [["pc", { width: 1440, height: 980 }], ["cel", { width: 390, height: 900 }]]) {
    const p = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
    await p.goto(`file://${raiz}/${nome}.html`);
    await p.waitForTimeout(1400);
    await p.screenshot({ path: `${raiz}/fotos/${nome}-${rot}.png`, fullPage: rot === "cel" });
    console.log(`${nome}-${rot}`);
    await p.close();
  }
}
await b.close();
