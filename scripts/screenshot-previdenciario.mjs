import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { resolve } from "path";

const outDir = resolve(process.cwd(), "docs");
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1200 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto("http://localhost:3000/__demo/previdenciario", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1500);

await page.screenshot({ path: `${outDir}/previdenciario-ferramentas.png`, fullPage: true });

// Clica em "Quando posso me aposentar?" (Simulador)
await page.locator("button:has-text('Quando posso me aposentar')").click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/previdenciario-simulador-step1.png`, fullPage: true });

await browser.close();
console.log("OK");
