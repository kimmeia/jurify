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
await page.goto("http://localhost:3000/__demo/imobiliario", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1500);

await page.screenshot({ path: `${outDir}/imobiliario-step1-dados.png`, fullPage: true });

await page.fill('input[id="valorImovel"]', "400000");
await page.fill('input[id="valorFinanciado"]', "300000");
await page.fill('input[id="taxaJurosAnual"]', "9");
await page.fill('input[id="idadeComprador"]', "35");
await page.waitForTimeout(300);
await page.locator("button:has-text('Próximo')").click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/imobiliario-step2-enquadramento.png`, fullPage: true });

await browser.close();
console.log("OK");
