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
await page.goto("http://localhost:3000/__demo/bancario", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1500);

// Step 1: Modalidade
await page.screenshot({ path: `${outDir}/bancario-step1-modalidade.png`, fullPage: true });

// Avança pro Step 2
const btn1 = page.locator("button:has-text('Continuar com')").first();
if (await btn1.count() > 0) {
  await btn1.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/bancario-step2-dados.png`, fullPage: true });
}

await browser.close();
console.log("OK");
