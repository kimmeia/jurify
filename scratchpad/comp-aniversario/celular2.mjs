import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
const [OUT, PORTA] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, storageState: "/home/user/jurify/scratchpad/comp-sumulas/sessao-dono.json", deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
// Abre a ficha direto: o formulário de edição usa o MESMO componente do diálogo.
await p.goto(`http://localhost:${PORTA}/clientes?id=6`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(5000);
const alvo = p.locator('label:has-text("Nacionalidade")').first();
if (await alvo.count()) {
  await alvo.scrollIntoViewIfNeeded();
  await p.waitForTimeout(900);
} else {
  console.log("(sem label Nacionalidade — fotografando o topo)");
}
await p.screenshot({ path: `${OUT}/celular.png` });
const m = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
console.log("celular.png ok", JSON.stringify(m));
await b.close();
