import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
const [OUT, PORTA] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, storageState: "/home/user/jurify/scratchpad/comp-sumulas/sessao-dono.json", deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto(`http://localhost:${PORTA}/clientes`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);
const novo = p.locator('button:has-text("Novo cliente")').first();
if (await novo.count()) {
  await novo.click();
  await p.waitForTimeout(2000);
  // Rola até o bloco de qualificação e fotografa a janela visível.
  const alvo = p.locator('label:has-text("Nacionalidade")').first();
  if (await alvo.count()) await alvo.scrollIntoViewIfNeeded();
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/celular-novo.png` });
  const larg = await p.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
  console.log("celular-novo.png ok", JSON.stringify(larg));
} else console.log("!! botão não encontrado");
await b.close();
